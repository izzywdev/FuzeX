#!/usr/bin/env node
'use strict';

/**
 * mcp/server.js — MCP stdio server for design-frames-service.
 *
 * Speaks JSON-RPC 2.0 over stdio (one message per line), per the transport
 * declared in tools.json and .fuze/manifest.json. Reads and writes go
 * straight through ../lib/store.js (same process, same DESIGN_FRAMES_DATA_DIR
 * as server.js — run them against the same data dir to share state, or
 * point this at the same volume in production). This keeps the MCP surface
 * usable for local/CI agent orchestration without requiring a network hop
 * or a bearer token; the REST API (server.js) remains the network-facing,
 * authenticated surface for cross-repo callers like FuzeFront's CI.
 */

const readline = require('node:readline');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const store = require('../lib/store');
const { validateManifest } = require('../lib/schema');
const { computeStamp } = require('../lib/stamp');

const TOOLS_MANIFEST = JSON.parse(readFileSync(path.join(__dirname, 'tools.json'), 'utf8'));
const SITE_BASE = process.env.DESIGN_FRAMES_SITE_BASE || `http://localhost:${process.env.DESIGN_FRAMES_PORT || 4400}`;

function toolList() {
  return TOOLS_MANIFEST.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

async function upsertFrameMeta(slug, args) {
  const manifest = await store.getManifest(slug);
  const frames = manifest.frames || [];
  const idx = frames.findIndex((f) => f.id === args.id);
  const entry = {
    id: args.id,
    file: args.file,
    label: args.label,
    summary: args.summary,
    testHooks: args.testHooks,
  };
  if (args.route !== undefined) entry.route = args.route;
  if (args.flow !== undefined) entry.flow = args.flow;
  if (args.acceptanceNotes !== undefined) entry.acceptanceNotes = args.acceptanceNotes;
  if (idx === -1) frames.push(entry);
  else frames[idx] = entry;
  manifest.frames = frames;
  const errors = validateManifest(manifest);
  if (errors.length) {
    const e = new Error(`manifest validation failed: ${errors.join('; ')}`);
    e.code = 'VALIDATION';
    throw e;
  }
  await store.putManifest(slug, manifest);
}

async function upsertFlow(slug, args) {
  const manifest = await store.getManifest(slug);
  manifest.build = manifest.build || { flows: [] };
  manifest.build.flows = manifest.build.flows || [];
  const idx = manifest.build.flows.findIndex((f) => f.id === args.id);
  const entry = { id: args.id, orchestrator: args.orchestrator, route: args.route };
  if (idx === -1) {
    manifest.build.flows.push({ ...entry, approved: false, approvedBy: null, approvedAt: null });
  } else {
    Object.assign(manifest.build.flows[idx], entry);
  }
  await store.putManifest(slug, manifest);
  return manifest.build.flows.find((f) => f.id === args.id);
}

const HANDLERS = {
  async list_features() {
    return { features: await store.listFeatures() };
  },
  async get_feature({ slug }) {
    const feature = await store.getFeature(slug);
    return { slug, manifest: feature.manifest, frames: Object.fromEntries(feature.frames) };
  },
  async create_feature({ slug, name, description, designSystem, entry, sourceRepo }) {
    const manifest = {
      name,
      description,
      designSystem: designSystem || 'fuse-seam (@fuzefront/design-system)',
      entry: entry || 'index.html',
      sourceRepo: sourceRepo || null,
      frames: [],
      build: { flows: [] },
    };
    const errors = validateManifest(manifest);
    if (errors.length) {
      const e = new Error(`manifest validation failed: ${errors.join('; ')}`);
      e.code = 'VALIDATION';
      throw e;
    }
    const feature = await store.createFeature(slug, manifest);
    return { slug: feature.slug, manifest: feature.manifest };
  },
  async propose_frame(args) {
    await upsertFrameMeta(args.slug, args);
    await store.putFrame(args.slug, args.file, args.html);
    return { slug: args.slug, file: args.file, id: args.id };
  },
  async define_flow(args) {
    const flow = await upsertFlow(args.slug, args);
    return { slug: args.slug, flow };
  },
  async compute_stamp({ slug }) {
    const feature = await store.getFeature(slug);
    const stamp = computeStamp(feature);
    return { slug, stamp, manifestStamp: feature.manifest.stamp || null, current: stamp === feature.manifest.stamp };
  },
  async commit_stamp({ slug }) {
    const feature = await store.getFeature(slug);
    const stamp = computeStamp(feature);
    await store.setStamp(slug, stamp);
    return { slug, stamp };
  },
  async approve_flow({ slug, flowId, approvedBy }) {
    const flow = await store.setFlowApproval(slug, flowId, { approved: true, approvedBy, approvedAt: new Date().toISOString() });
    return { slug, flow };
  },
  async reject_flow({ slug, flowId, reason }) {
    const flow = await store.setFlowApproval(slug, flowId, { approved: false, approvedBy: null, approvedAt: null, rejectionReason: reason || null });
    return { slug, flow };
  },
  async get_site_url({ slug, file }) {
    const url = file ? `${SITE_BASE}/site/${encodeURIComponent(slug)}/${encodeURIComponent(file)}` : `${SITE_BASE}/site/${encodeURIComponent(slug)}`;
    return { url };
  },
};

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return replyError(msg && msg.id, -32600, 'Invalid Request');
  }

  if (msg.method === 'initialize') {
    return reply(msg.id, {
      protocolVersion: TOOLS_MANIFEST.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: TOOLS_MANIFEST.server, version: require('../package.json').version },
    });
  }

  if (msg.method === 'tools/list') {
    return reply(msg.id, { tools: toolList() });
  }

  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params || {};
    const handler = HANDLERS[name];
    if (!handler) return replyError(msg.id, -32601, `Unknown tool: ${name}`);
    try {
      const result = await handler(args || {});
      return reply(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (err) {
      const code = err.code === 'NOT_FOUND' ? -32001 : err.code === 'VALIDATION' ? -32002 : err.code === 'CONFLICT' ? -32003 : -32603;
      return replyError(msg.id, code, err.message);
    }
  }

  return replyError(msg.id, -32601, `Unknown method: ${msg.method}`);
}

function start() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (_err) {
      return replyError(null, -32700, 'Parse error');
    }
    handleMessage(msg).catch((err) => {
      console.error('mcp/server.js: unhandled error:', err);
      replyError(msg.id, -32603, 'Internal error');
    });
  });
  process.stderr.write(`design-frames-service MCP server ready (stdio), data dir: ${store.DATA_DIR}\n`);
}

if (require.main === module) {
  start();
}

module.exports = { start, handleMessage, HANDLERS };
