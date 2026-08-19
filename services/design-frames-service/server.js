#!/usr/bin/env node
'use strict';

/**
 * design-frames-service — REST API for the standalone product-design phase.
 *
 * Ports the navigable-HTML-frames workflow FuzeFront pioneered under
 * design/frames/** (see docs/EXTRACTION.md) into its own network-reachable
 * service, so any consuming product (starting with FuzeFront) drives design
 * review over API/MCP/A2A instead of hand-authoring files + a GitHub Issue
 * approval flow in its own repo.
 *
 * Deliberately plain node:http, no framework — matches this repo's existing
 * bridge-server.js style. UNLIKE bridge-server.js this service is meant to be
 * network-reachable (not loopback-only): auth is a bearer token from
 * DESIGN_FRAMES_API_TOKENS (comma-separated, supports multiple callers e.g.
 * a CI token for FuzeFront + an interactive token for product-designer).
 * Reads of already-created features/frames are intentionally UNAUTHENTICATED
 * (GET /api/v1/features, GET .../frames/:file, GET /site/**) — this mirrors
 * the FuzeFront precedent of publishing frames to GitHub Pages for public
 * review on an oss-public repo. All writes (POST/PUT/DELETE and the approve/
 * reject actions) require a valid bearer token.
 */

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const store = require('./lib/store');
const { validateManifest } = require('./lib/schema');
const { computeStamp } = require('./lib/stamp');

const FRONTEND_DIR = path.join(__dirname, 'frontend');
const STATIC_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'application/javascript; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
};

// ─── Module-Federation remote: webapp/'s built assets, served same-origin ───
// webapp/ (vite.config.ts) builds to dist/ with `base: '/apps/fuzex/'` and
// `assetsDir: ''`, so remoteEntry.js and every chunk land flat in dist/ and
// are expected at .../apps/fuzex/<file>. The Dockerfile builds webapp/ in a
// separate stage and copies dist/ to /app/webapp-dist by default;
// DESIGN_FRAMES_WEBAPP_DIR overrides that (e.g. for a local `npm run build`
// in webapp/ without rebuilding the image, or a chart-level override).
const WEBAPP_DIR = process.env.DESIGN_FRAMES_WEBAPP_DIR || path.join(__dirname, 'webapp-dist');
const WEBAPP_MOUNT_PREFIX = '/apps/fuzex/';
const WEBAPP_MIME_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function serveWebappAsset(res, relPath) {
  // Empty (mount root, e.g. GET /apps/fuzex/) serves the SPA entry document.
  const rel = relPath === '' ? 'index.html' : relPath;
  const webappRoot = path.normalize(WEBAPP_DIR + path.sep);
  const resolved = path.normalize(path.join(WEBAPP_DIR, rel));
  // Defense in depth against a decoded `..` escaping WEBAPP_DIR: the router
  // match below already requires the RAW (still percent-encoded) pathname to
  // start with /apps/fuzex/, but relPath is decodeURIComponent'd after that
  // match, so an encoded traversal segment (`%2e%2e%2f`) only reveals itself
  // here.
  if (resolved !== path.normalize(WEBAPP_DIR) && !resolved.startsWith(webappRoot)) {
    return sendJson(res, 400, { error: 'invalid path' });
  }
  let data;
  try {
    data = await fs.readFile(resolved);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      return sendJson(res, 404, { error: 'not found' });
    }
    throw err;
  }
  const ext = path.extname(resolved).toLowerCase();
  const type = WEBAPP_MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length });
  res.end(data);
}

const BIND_HOST = process.env.DESIGN_FRAMES_HOST || '0.0.0.0';
const PORT = parseInt(process.env.DESIGN_FRAMES_PORT, 10) || 4400;
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB — frame HTML is bigger than an MCP tool call

const TOKENS = new Set(
  (process.env.DESIGN_FRAMES_API_TOKENS || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
);

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function extractBearer(req) {
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

function isAuthorized(req) {
  if (TOKENS.size === 0) return true; // local dev with no token configured
  const provided = extractBearer(req);
  if (!provided) return false;
  for (const t of TOKENS) if (safeCompare(provided, t)) return true;
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES && !tooLarge) {
        tooLarge = true;
        req.resume();
        reject(Object.assign(new Error('body too large'), { code: 'BODY_TOO_LARGE' }));
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => { if (!tooLarge) resolve(Buffer.concat(chunks)); });
    req.on('error', (err) => { if (!tooLarge) reject(err); });
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function readJsonBody(req) {
  const buf = await readBody(req);
  if (buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch (_err) {
    const e = new Error('invalid JSON body');
    e.code = 'BAD_JSON';
    throw e;
  }
}

function errorStatus(err) {
  if (err.code === 'NOT_FOUND') return 404;
  if (err.code === 'CONFLICT') return 409;
  if (err.code === 'VALIDATION' || err.code === 'BAD_JSON') return 400;
  if (err.code === 'BODY_TOO_LARGE') return 413;
  return 500;
}

function renderSiteIndex(slug, manifest) {
  const frames = manifest.frames || [];
  const flows = (manifest.build && manifest.build.flows) || [];
  const flowState = new Map(flows.map((f) => [f.id, f]));
  const rows = frames
    .map((f) => {
      const flow = f.flow ? flowState.get(f.flow) : null;
      const approved = flow ? (flow.approved ? 'approved' : 'pending') : 'n/a';
      return `<li><a href="./${encodeURIComponent(slug)}/${encodeURIComponent(f.file)}">${escapeHtml(f.label)}</a> — <span class="summary">${escapeHtml(f.summary)}</span> <span class="flow-state flow-state--${approved}">${approved}</span></li>`;
    })
    .join('\n      ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(manifest.name)} — design-frames-service</title>
<style>
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; max-width: 720px; margin: 3rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  .flow-state { font-size: .75rem; padding: .1rem .4rem; border-radius: .25rem; margin-left: .5rem; }
  .flow-state--approved { background: #d7f5dd; color: #0a6b2a; }
  .flow-state--pending { background: #fff2cc; color: #8a6300; }
  .flow-state--n\\/a { background: #eee; color: #666; }
  .summary { color: #555; }
</style>
</head>
<body>
  <h1>${escapeHtml(manifest.name)}</h1>
  <p>${escapeHtml(manifest.description)}</p>
  <ol>
      ${rows || '<li>(no frames)</li>'}
  </ol>
</body>
</html>`;
}

async function handleRequest(req, res) {
  const origin = req.headers['origin'];
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    if (url.pathname === '/health') return sendJson(res, 200, { status: 'healthy', timestamp: Date.now() });

    // ─── The contract, served by the thing that implements it ───
    // openapi.yaml was committed next to this file and reachable over HTTP from
    // NOWHERE, so the only way to see what this service accepts was to open the
    // repository. A contract nobody can fetch cannot be checked against a running
    // instance, which is most of the point of publishing one — a client generated
    // from a stale copy fails at runtime with nothing to notice it sooner.
    //
    // Read per request rather than cached at startup: the file is a few KB, this
    // is not a hot path, and a cached copy would go stale against a mounted spec
    // with no signal that it had.
    if (req.method === 'GET' && (url.pathname === '/openapi.yaml' || url.pathname === '/openapi.json')) {
      const spec = await fs.readFile(path.join(__dirname, 'openapi.yaml'), 'utf8');
      // The source of truth is YAML. `/openapi.json` is accepted because tooling
      // asks for it by convention, and answers with the SAME bytes under the YAML
      // content type rather than a half-converted document: every OpenAPI parser
      // reads YAML, and no consumer is handed something that claims to be JSON and
      // is not.
      res.writeHead(200, { 'Content-Type': 'application/yaml; charset=utf-8' });
      res.end(spec);
      return;
    }

    // ─── Static frontend (vanilla HTML/JS/CSS, no build step) ───
    if (req.method === 'GET' && STATIC_FILES[url.pathname]) {
      const spec = STATIC_FILES[url.pathname];
      const contents = await fs.readFile(path.join(FRONTEND_DIR, spec.file), 'utf8');
      res.writeHead(200, { 'Content-Type': spec.type });
      res.end(contents);
      return;
    }

    // ─── Module-Federation remote (webapp/'s built dist/), public/no auth ───
    // Mirrors the /site read surface: this is a review-time app tile, not a
    // write path, so it needs no bearer token. Matched on the RAW (still
    // percent-encoded) pathname so a `..` segment can't be smuggled past this
    // prefix check via encoding (see serveWebappAsset's second check).
    if (req.method === 'GET' && (url.pathname === '/apps/fuzex' || url.pathname.startsWith(WEBAPP_MOUNT_PREFIX))) {
      const rel = url.pathname === '/apps/fuzex' ? '' : url.pathname.slice(WEBAPP_MOUNT_PREFIX.length);
      return serveWebappAsset(res, decodeURIComponent(rel));
    }

    // ─── Public read-only "site" (design-review surface, no auth — see header note) ───
    if (parts[0] === 'site' && parts.length === 2) {
      const [, slug] = parts;
      const manifest = await store.getManifest(slug);
      return sendHtml(res, 200, renderSiteIndex(slug, manifest));
    }
    if (parts[0] === 'site' && parts.length === 3) {
      const [, slug, file] = parts;
      const html = await store.getFrame(slug, file);
      return sendHtml(res, 200, html);
    }

    if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'features') {
      return sendJson(res, 404, { error: 'not found' });
    }

    const isWrite = ['POST', 'PUT', 'DELETE'].includes(req.method);
    if (isWrite && !isAuthorized(req)) {
      return sendJson(res, 401, { error: 'Unauthorized — Bearer token required for write operations' });
    }

    // GET /api/v1/features
    if (parts.length === 3 && req.method === 'GET') {
      return sendJson(res, 200, { features: await store.listFeatures() });
    }

    // POST /api/v1/features
    if (parts.length === 3 && req.method === 'POST') {
      const body = await readJsonBody(req);
      const { slug, name, description, designSystem, entry, sourceRepo } = body;
      if (!slug) return sendJson(res, 400, { error: 'slug is required' });
      const manifest = {
        name: name || slug,
        description: description || '',
        designSystem: designSystem || 'fuse-seam (@fuzefront/design-system)',
        entry: entry || 'index.html',
        sourceRepo: sourceRepo || null,
        frames: [],
        build: { flows: [] },
      };
      const errors = validateManifest(manifest);
      if (errors.length) return sendJson(res, 400, { error: 'manifest validation failed', details: errors });
      const feature = await store.createFeature(slug, manifest);
      return sendJson(res, 201, { slug: feature.slug, manifest: feature.manifest });
    }

    const slug = parts[3];
    if (!slug) return sendJson(res, 404, { error: 'not found' });

    // GET /api/v1/features/:slug  (manifest + frame contents)
    if (parts.length === 4 && req.method === 'GET') {
      const feature = await store.getFeature(slug);
      return sendJson(res, 200, { slug, manifest: feature.manifest, frames: Object.fromEntries(feature.frames) });
    }

    // PUT /api/v1/features/:slug/manifest
    if (parts.length === 5 && parts[4] === 'manifest' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      const errors = validateManifest(body);
      if (errors.length) return sendJson(res, 400, { error: 'manifest validation failed', details: errors });
      const feature = await store.putManifest(slug, body);
      return sendJson(res, 200, { slug, manifest: feature.manifest });
    }

    // GET /api/v1/features/:slug/stamp — read-only: compute and compare, never writes.
    if (parts.length === 5 && parts[4] === 'stamp' && req.method === 'GET') {
      const feature = await store.getFeature(slug);
      const stamp = computeStamp(feature);
      return sendJson(res, 200, { slug, stamp, manifestStamp: feature.manifest.stamp || null, current: stamp === feature.manifest.stamp });
    }

    // POST /api/v1/features/:slug/stamp — compute AND persist into manifest.stamp
    // (the --write equivalent of FuzeFront's stamp-frames.mjs; requires auth since it mutates).
    if (parts.length === 5 && parts[4] === 'stamp' && req.method === 'POST') {
      const feature = await store.getFeature(slug);
      const stamp = computeStamp(feature);
      await store.setStamp(slug, stamp);
      return sendJson(res, 200, { slug, stamp });
    }

    // POST /api/v1/features/:slug/verify-stamp
    if (parts.length === 5 && parts[4] === 'verify-stamp' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const feature = await store.getFeature(slug);
      const expected = computeStamp(feature);
      return sendJson(res, 200, { slug, valid: body.stamp === expected, expected });
    }

    // .../frames/:file
    if (parts.length === 6 && parts[4] === 'frames') {
      const file = decodeURIComponent(parts[5]);
      if (req.method === 'GET') {
        const html = await store.getFrame(slug, file);
        return sendJson(res, 200, { slug, file, html });
      }
      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        if (typeof body.html !== 'string') return sendJson(res, 400, { error: 'html (string) is required' });
        await store.putFrame(slug, file, body.html);
        return sendJson(res, 200, { slug, file, bytes: Buffer.byteLength(body.html, 'utf8') });
      }
      if (req.method === 'DELETE') {
        await store.deleteFrame(slug, file);
        return sendJson(res, 204, {});
      }
    }

    // .../flows/:flowId/approve|reject
    if (parts.length === 7 && parts[4] === 'flows' && req.method === 'POST') {
      const flowId = decodeURIComponent(parts[5]);
      const action = parts[6];
      const body = await readJsonBody(req);
      if (action === 'approve') {
        if (!body.approvedBy) return sendJson(res, 400, { error: 'approvedBy is required' });
        const flow = await store.setFlowApproval(slug, flowId, {
          approved: true,
          approvedBy: body.approvedBy,
          approvedAt: new Date().toISOString(),
        });
        return sendJson(res, 200, { slug, flow });
      }
      if (action === 'reject') {
        const flow = await store.setFlowApproval(slug, flowId, {
          approved: false,
          approvedBy: null,
          approvedAt: null,
          rejectionReason: body.reason || null,
        });
        return sendJson(res, 200, { slug, flow });
      }
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    if (err.code === 'BODY_TOO_LARGE') return sendJson(res, 413, { error: err.message });
    if (err.code) return sendJson(res, errorStatus(err), { error: err.message, details: err.details });
    console.error('unhandled error:', err);
    return sendJson(res, 500, { error: 'internal server error' });
  }
}

function start() {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('handleRequest crashed:', err);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal server error' });
    });
  });
  server.listen(PORT, BIND_HOST, () => {
    console.log(`design-frames-service listening on http://${BIND_HOST}:${PORT}`);
    console.log(`data dir: ${store.DATA_DIR}`);
    if (TOKENS.size === 0) {
      console.warn('WARNING: DESIGN_FRAMES_API_TOKENS is unset — writes are UNAUTHENTICATED. Set it before deploying.');
    }
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { start, handleRequest, isAuthorized, safeCompare };
