'use strict';

/**
 * integration.test.cjs — exercises the real Express app against a REAL,
 * throwaway local Postgres 16 instance (migrated via ../../db/migrate.sh)
 * and a temp on-disk data dir (../../lib/store.js's file-content tier).
 *
 * Requires DATABASE_URL to point at an already-migrated scratch database —
 * see the PR body / verification report for exactly how this was run. This
 * is NOT a mock: it is the same code path server.js's own tests exercise,
 * just against the new tier.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.warn('integration.test.cjs: DATABASE_URL not set — skipping (see .env.example).');
  test('skipped: no DATABASE_URL', { skip: true }, () => {});
  return;
}

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfx-test-data-'));
process.env.DESIGN_FRAMES_DATA_DIR = tmpDataDir;
process.env.DESIGN_FRAMES_API_TOKENS = ''; // writes unauthenticated in this suite; auth is covered by auth.test.cjs
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

// Truncate every lifecycle table so repeated runs start clean.
execSync(
  `psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -q -c ` +
    `"TRUNCATE design_frames.comment, design_frames.discussion, design_frames.approval, design_frames.frame_ref, design_frames.flow, design_frames.feature, design_frames.project RESTART IDENTITY CASCADE;"`,
  { stdio: 'inherit' }
);

const { createApp } = require('../dist/app.js');

let server;
let base;

test.before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
});

async function j(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

test('GET /health is a public liveness check', async () => {
  const { status, body } = await j('GET', '/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'healthy');
});

// ---------------------------------------------------------------------------
// Projects CRUD
// ---------------------------------------------------------------------------

let projectId;

test('POST /api/v1/projects mints a server-owned fxdf_prj_* id and rejects a client-supplied one', async () => {
  const rejected = await j('POST', '/api/v1/projects', { name: 'x', id: 'fxdf_prj_client_supplied' });
  assert.equal(rejected.status, 400);

  const { status, body } = await j('POST', '/api/v1/projects', { name: 'Acme Product', sourceRepo: 'FuzeFront' });
  assert.equal(status, 201);
  assert.match(body.id, /^fxdf_prj_[0-9a-hjkmnp-tv-z]+$/);
  assert.equal(body.name, 'Acme Product');
  projectId = body.id;
});

test('GET /api/v1/projects/:id round-trips the created project', async () => {
  const { status, body } = await j('GET', `/api/v1/projects/${projectId}`);
  assert.equal(status, 200);
  assert.equal(body.id, projectId);
});

test('GET /api/v1/projects/:id 404s for a well-formed but nonexistent id', async () => {
  const { status } = await j('GET', '/api/v1/projects/fxdf_prj_01h455vb4pex5vsknk084sn02q');
  assert.equal(status, 404);
});

test('GET /api/v1/projects/:id 400s for a wrong-type id (identifier-standard §2)', async () => {
  const { status } = await j('GET', '/api/v1/projects/fxdf_ftr_01h455vb4pex5vsknk084sn02q');
  assert.equal(status, 400);
});

test('PATCH /api/v1/projects/:id updates mutable fields only', async () => {
  const { status, body } = await j('PATCH', `/api/v1/projects/${projectId}`, { description: 'updated' });
  assert.equal(status, 200);
  assert.equal(body.description, 'updated');
  assert.equal(body.name, 'Acme Product');
});

test('GET /api/v1/projects returns the pagination envelope', async () => {
  const { status, body } = await j('GET', '/api/v1/projects');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.items));
  assert.ok('nextCursor' in body.page && 'hasMore' in body.page);
});

// ---------------------------------------------------------------------------
// Feature create (v0.1.0 shape + optional projectId reference)
// ---------------------------------------------------------------------------

test('POST /api/v1/features accepts an optional projectId reference and stays byte-shaped like v0.1.0', async () => {
  const { status, body } = await j('POST', '/api/v1/features', {
    slug: 'checkout-redesign',
    name: 'Checkout Redesign',
    description: 'd',
    designSystem: 'fuse-seam',
    entry: 'index.html',
    projectId,
  });
  assert.equal(status, 201);
  assert.equal(body.slug, 'checkout-redesign');
  assert.ok(body.manifest);
  assert.deepEqual(Object.keys(body).sort(), ['manifest', 'slug']);
});

test('POST /api/v1/features rejects an unresolvable projectId reference with 404', async () => {
  const { status } = await j('POST', '/api/v1/features', {
    slug: 'orphan-feature',
    name: 'x',
    description: 'd',
    designSystem: 's',
    entry: 'index.html',
    projectId: 'fxdf_prj_01h455vb4pex5vsknk084sn02q',
  });
  assert.equal(status, 404);
});

test('GET /api/v1/projects/:id/features lists the assigned feature, paginated', async () => {
  const { status, body } = await j('GET', `/api/v1/projects/${projectId}/features`);
  assert.equal(status, 200);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].slug, 'checkout-redesign');
});

test('GET /api/v1/features (v0.1.0 list) is unpaginated {features:[...]}', async () => {
  const { status, body } = await j('GET', '/api/v1/features');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.features));
  assert.deepEqual(Object.keys(body), ['features']);
});

// ---------------------------------------------------------------------------
// Manifest + flows + stamp-bound append-only approvals
// ---------------------------------------------------------------------------

test('PUT manifest declares a flow; GET feature reflects it unapproved', async () => {
  const put = await j('PUT', '/api/v1/features/checkout-redesign/manifest', {
    name: 'Checkout Redesign',
    description: 'd',
    designSystem: 'fuse-seam',
    entry: 'index.html',
    frames: [],
    build: { flows: [{ id: 'primary', orchestrator: 'o', route: '/primary' }] },
  });
  assert.equal(put.status, 200);

  const get = await j('GET', '/api/v1/features/checkout-redesign');
  assert.equal(get.status, 200);
  assert.equal(get.body.manifest.build.flows[0].approved, undefined); // not yet approved, no bookkeeping written
});

test('legacy {approvedBy}-only approve still succeeds and projects onto the manifest read', async () => {
  const approve = await j('POST', '/api/v1/features/checkout-redesign/flows/primary/approve', {
    approvedBy: 'alice@example.com',
  });
  assert.equal(approve.status, 200);
  assert.match(approve.body.id, /^fxdf_apr_/);
  assert.equal(approve.body.contentStamp, null);

  const get = await j('GET', '/api/v1/features/checkout-redesign');
  assert.equal(get.body.manifest.build.flows[0].approved, true);
  assert.equal(get.body.manifest.build.flows[0].approvedBy, 'alice@example.com');
});

test('reject now REQUIRES reason (v0.2.0 tightening)', async () => {
  const missing = await j('POST', '/api/v1/features/checkout-redesign/flows/primary/reject', {});
  assert.equal(missing.status, 400);

  const ok = await j('POST', '/api/v1/features/checkout-redesign/flows/primary/reject', {
    reason: 'needs another pass',
    rejectedBy: 'bob@example.com',
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.decision, 'reject');
  assert.equal(ok.body.reason, 'needs another pass');
});

test('approve with a stale contentStamp is rejected with 409 StampConflict', async () => {
  const { status, body } = await j('POST', '/api/v1/features/checkout-redesign/flows/primary/approve', {
    approvedBy: 'carol@example.com',
    contentStamp: '0'.repeat(64),
  });
  assert.equal(status, 409);
  assert.ok(body.expectedStamp);
  assert.equal(body.suppliedStamp, '0'.repeat(64));
});

test('approve with the CURRENT contentStamp succeeds and binds it to the decision', async () => {
  const stampRes = await j('GET', '/api/v1/features/checkout-redesign/stamp');
  assert.equal(stampRes.status, 200);
  const stamp = stampRes.body.stamp;

  const { status, body } = await j('POST', '/api/v1/features/checkout-redesign/flows/primary/approve', {
    approvedBy: 'carol@example.com',
    contentStamp: stamp,
  });
  assert.equal(status, 200);
  assert.equal(body.contentStamp, stamp);
});

test('approvals history is append-only (3 decisions), newest first, and paginates without gaps/dupes', async () => {
  const page1 = await j('GET', '/api/v1/features/checkout-redesign/flows/primary/approvals?limit=2');
  assert.equal(page1.status, 200);
  assert.equal(page1.body.items.length, 2);
  assert.equal(page1.body.page.hasMore, true);
  assert.ok(page1.body.page.nextCursor);
  assert.equal(page1.body.items[0].decision, 'approve'); // carol's, newest
  assert.equal(page1.body.items[1].decision, 'reject'); // bob's

  const page2 = await j(
    'GET',
    `/api/v1/features/checkout-redesign/flows/primary/approvals?limit=2&cursor=${encodeURIComponent(page1.body.page.nextCursor)}`
  );
  assert.equal(page2.status, 200);
  assert.equal(page2.body.items.length, 1);
  assert.equal(page2.body.page.hasMore, false);
  assert.equal(page2.body.items[0].decision, 'approve'); // alice's, oldest

  const allIds = [...page1.body.items, ...page2.body.items].map((a) => a.id);
  assert.equal(new Set(allIds).size, 3); // no dupes
});

test('approvals history for a flow with no decisions yet is an empty page, not a 404', async () => {
  const { status, body } = await j('GET', '/api/v1/features/checkout-redesign/flows/never-touched/approvals');
  assert.equal(status, 200);
  assert.deepEqual(body.items, []);
  assert.equal(body.page.hasMore, false);
});

test('approvals endpoint clamps an over-max limit rather than erroring', async () => {
  const { status, body } = await j('GET', '/api/v1/features/checkout-redesign/flows/primary/approvals?limit=99999');
  assert.equal(status, 200);
  assert.equal(body.items.length, 3); // all 3 rows fit under the clamped 200 max
  assert.equal(body.page.hasMore, false);
});

// ---------------------------------------------------------------------------
// Discussions + comments
// ---------------------------------------------------------------------------

let featureWireId;
let discussionId;

test('resolve the feature wire id for polymorphic discussion targeting', async () => {
  const { status, body } = await j('GET', `/api/v1/projects/${projectId}/features`);
  assert.equal(status, 200);
  assert.ok(body.items.length >= 1);
  // The feature wire id isn't in FeatureSummary; fetch it straight from the
  // discussions convenience route instead (it resolves slug -> id internally).
  featureWireId = null; // resolved implicitly by the convenience route below
});

test('POST /api/v1/discussions rejects a targetRef of the wrong type', async () => {
  const { status } = await j('POST', '/api/v1/discussions', { targetType: 'feature', targetRef: projectId });
  assert.equal(status, 400);
});

test('POST /api/v1/discussions rejects targetType=element with no targetSelector', async () => {
  const { status } = await j('POST', '/api/v1/discussions', { targetType: 'element', targetRef: projectId });
  assert.equal(status, 400);
});

test('GET /api/v1/features/:slug/discussions convenience route resolves the feature and returns an empty page', async () => {
  const { status, body } = await j('GET', '/api/v1/features/checkout-redesign/discussions');
  assert.equal(status, 200);
  assert.deepEqual(body.items, []);
});

test('POST /api/v1/discussions on a project works end to end, then comments thread onto it', async () => {
  const created = await j('POST', '/api/v1/discussions', {
    targetType: 'project',
    targetRef: projectId,
    title: 'Naming question',
  });
  assert.equal(created.status, 201);
  assert.match(created.body.id, /^fxdf_dsc_/);
  assert.equal(created.body.resolved, false);
  discussionId = created.body.id;

  const comment1 = await j('POST', `/api/v1/discussions/${discussionId}/comments`, {
    body: 'why this name?',
    authorRef: 'dave@example.com',
  });
  assert.equal(comment1.status, 201);
  assert.match(comment1.body.id, /^fxdf_cmt_/);

  const comment2 = await j('POST', `/api/v1/discussions/${discussionId}/comments`, {
    body: 'because reasons',
    authorRef: 'erin@example.com',
    parentCommentId: comment1.body.id,
  });
  assert.equal(comment2.status, 201);
  assert.equal(comment2.body.parentCommentId, comment1.body.id);

  const withComments = await j('GET', `/api/v1/discussions/${discussionId}`);
  assert.equal(withComments.status, 200);
  assert.equal(withComments.body.comments.length, 2);
  assert.equal(withComments.body.comments[0].body, 'why this name?'); // oldest first
});

test('PATCH /api/v1/discussions/:id resolves it', async () => {
  const { status, body } = await j('PATCH', `/api/v1/discussions/${discussionId}`, { resolved: true });
  assert.equal(status, 200);
  assert.equal(body.resolved, true);
});

test('GET /api/v1/discussions?targetType=&targetRef= filters by resolved', async () => {
  const resolved = await j('GET', `/api/v1/discussions?targetType=project&targetRef=${projectId}&resolved=true`);
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.items.length, 1);

  const unresolved = await j('GET', `/api/v1/discussions?targetType=project&targetRef=${projectId}&resolved=false`);
  assert.equal(unresolved.status, 200);
  assert.equal(unresolved.body.items.length, 0);
});

// ---------------------------------------------------------------------------
// v0.1.0 frame + stamp surface, delegated straight to the file-content tier
// ---------------------------------------------------------------------------

test('frame PUT/GET/DELETE round-trip through the same file-content tier as ../server.js', async () => {
  const put = await j('PUT', '/api/v1/features/checkout-redesign/frames/hero.html', { html: '<h1>Hi</h1>' });
  assert.equal(put.status, 200);

  const get = await j('GET', '/api/v1/features/checkout-redesign/frames/hero.html');
  assert.equal(get.status, 200);
  assert.equal(get.body.html, '<h1>Hi</h1>');

  const del = await fetch(`${base}/api/v1/features/checkout-redesign/frames/hero.html`, { method: 'DELETE' });
  assert.equal(del.status, 204);
});
