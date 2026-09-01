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
 * network-reachable (not loopback-only): writes are authenticated with a
 * FuzeFront-issued MACHINE token, verified per request against FuzeFront's own
 * /api/v1/security/tokens/introspect and required to carry the
 * `fuzex:frames:write` scope (issue #26). This replaced DESIGN_FRAMES_API_TOKENS,
 * a comma-separated list of pre-shared bearers — see the auth block below for
 * why that mechanism was worse than the comments here used to claim.
 * Reads of already-created features/frames are intentionally UNAUTHENTICATED
 * (GET /api/v1/features, GET .../frames/:file, GET /site/**) — this mirrors
 * the FuzeFront precedent of publishing frames to GitHub Pages for public
 * review on an oss-public repo. All writes (POST/PUT/DELETE and the approve/
 * reject actions) require a valid machine token.
 */

const http = require('node:http');
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

// ─── Module-Federation remote ───
// Previously served here (webapp/'s built dist/, mounted at /apps/fuzex/) by
// a hand-rolled static-file route — the Node/Express-style serving stage
// that deviated from the family's nginx-serving-stage standard and left the
// federation gate's layer-4 (nginx conf) extractor unable to read this repo.
// Migrated to the `webapp-mfe` nginx:alpine image (Dockerfile, webapp/nginx.conf,
// deploy/helm/fuzex/templates/webapp-mfe.yaml) — this process no longer
// serves it, so there is exactly one place that can drift from the vite
// `base`/`assetsDir` contract, not two.
const BIND_HOST = process.env.DESIGN_FRAMES_HOST || '0.0.0.0';
const PORT = parseInt(process.env.DESIGN_FRAMES_PORT, 10) || 4400;
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB — frame HTML is bigger than an MCP tool call

// ─── Write auth: FuzeFront machine tokens (issue #26) ───
//
// This REPLACES the DESIGN_FRAMES_API_TOKENS pre-shared bearer list. That
// mechanism had a defect worth naming, because the surrounding comments claimed
// the opposite of what the code did: `isAuthorized` began
//
//     if (TOKENS.size === 0) return true;   // "local dev with no token configured"
//
// so an UNSET secret made every write UNAUTHENTICATED — while this file's header
// and deploy/helm/fuzex/templates/deployment.yaml both asserted that absent the
// secret "EVERY write 401s — a safe default". It was mounted `optional: true`
// precisely so the pod could start without it. Any environment missing the
// secret was therefore serving an open write API, and the documentation said it
// was closed. There is no such mode below: no token is a denial, always.
//
// Callers now present a FuzeFront-issued machine token, verified per request
// against FuzeFront's own /api/v1/security/tokens/introspect.
const {
  createMachineTokenVerifier,
  ServiceAuthError,
} = require('@izzywdev/fuzefront-service-auth');

/**
 * FuzeFront's ORIGIN, e.g. https://app.fuzefront.com — NOT including `/api`.
 * The verifier appends the contract path itself, so a value ending in `/api`
 * yields `/api/api/v1/...` and 404s. A 404 is treated as a denial, so a
 * misconfiguration here fails CLOSED (every write 401s), never open.
 */
const FUZEFRONT_API_URL = process.env.FUZEFRONT_API_URL;

/** Scope a machine token must carry to write. */
const REQUIRED_SCOPE = process.env.DESIGN_FRAMES_REQUIRED_SCOPE || 'fuzex:frames:write';

if (!FUZEFRONT_API_URL) {
  if (process.env.NODE_ENV === 'production') {
    // Fail at startup rather than serve writes we cannot authenticate. The old
    // code's equivalent situation (no secret) silently served them.
    throw new Error('FUZEFRONT_API_URL must be set in production');
  }
  console.warn(
    '[auth] WARNING: FUZEFRONT_API_URL is not set — every write will be rejected (401)'
  );
}

const verifier = createMachineTokenVerifier({
  baseUrl: FUZEFRONT_API_URL || 'http://fuzefront-api.invalid',
  // Resolved at CALL time so tests can install a stub after this module loads.
  fetch: (input, init) => globalThis.fetch(input, init),
  // POSITIVE results only; the package never caches a negative verdict, so a
  // revoked token is denied on the very next request.
  cacheTtlSeconds: Number(process.env.DESIGN_FRAMES_INTROSPECTION_CACHE_SECONDS ?? 5),
});

function extractBearer(req) {
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

/**
 * Decide a write request. Resolves to `{ ok: true, identity }` or a denial
 * `{ ok: false, status, code, error }` — never throws, and never returns ok
 * for a token it could not positively verify.
 *
 * FAIL-CLOSED. Introspection answers HTTP 200 for EVERY token, including
 * unknown/expired/revoked ones (`200 { active: false }`). Branching on the
 * status code would accept every token ever presented. `verifyMachineToken`
 * branches on the body's `active` boolean and THROWS on every ambiguity
 * (network error, timeout, non-200, unparsable body, missing/non-boolean
 * `active`, missing `subject`); the catch below turns each of those into a
 * denial, never a pass.
 */
async function authorizeWrite(req) {
  const token = extractBearer(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: 'NO_TOKEN',
      error: 'Unauthorized — a FuzeFront machine token is required for write operations',
    };
  }

  let identity;
  try {
    identity = await verifier.verifyMachineToken(token);
  } catch (err) {
    return {
      ok: false,
      status: 401,
      code: err instanceof ServiceAuthError ? err.code : 'UNKNOWN',
      error: 'Unauthorized — token could not be verified',
    };
  }

  if (!identity.scopes.includes(REQUIRED_SCOPE)) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      error: `Forbidden — token lacks the ${REQUIRED_SCOPE} scope`,
    };
  }

  return { ok: true, identity };
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
    if (isWrite) {
      const decision = await authorizeWrite(req);
      if (!decision.ok) {
        return sendJson(res, decision.status, { error: decision.error, code: decision.code });
      }
      // Verified caller identity, available to handlers for attribution.
      req.machineIdentity = decision.identity;
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
    if (!FUZEFRONT_API_URL) {
      console.warn(
        'WARNING: FUZEFRONT_API_URL is unset — writes cannot be verified and will all be REJECTED.'
      );
    }
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { start, handleRequest, authorizeWrite, extractBearer, REQUIRED_SCOPE };
