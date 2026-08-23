'use strict';

/**
 * 04-features.test.cjs — the v0.1.0 /api/v1/features/** surface, asserted
 * UNCHANGED (byte-shape parity per docs/postgres-tier.md "Backward
 * compatibility"), PLUS the v0.2.0 `projectId` reference extension on
 * create.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootServer, requireDatabase } = require('../lib/server.cjs');
const { client } = require('../lib/http.cjs');

let srv;
let http;

try {
  requireDatabase();
} catch (err) {
  console.warn(`04-features.test.cjs: ${err.message} — skipping.`);
  test('skipped: no DATABASE_URL', { skip: true }, () => {});
  module.exports = undefined;
  return;
}

test.before(async () => {
  srv = await bootServer();
  http = client(srv.baseUrl, srv.token);
});

test.after(async () => {
  await srv.close();
});

function uniqueSlug(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Every fixture below passes an explicit non-empty `description` — see the
// dedicated BUG test at the end of this file for WHY: the create route's
// default for an OMITTED description ('') fails the service's OWN
// manifestSchema validation (non-empty required), even though
// openapi.yaml's feature-create body does not require `description` at
// all. Working around it here (rather than letting it fail every other
// assertion in this file) while keeping ONE undiluted test that proves it.
function featureBody(overrides = {}) {
  return { description: 'acceptance-suite fixture', ...overrides };
}

// ---- v0.1.0 surface, unchanged --------------------------------------------

test('GET /api/v1/features returns the UNPAGINATED {features:[...]} shape (byte-compatibility)', async () => {
  const { status, body } = await http.get('/api/v1/features', { auth: false });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.features), 'features must stay a bare array, not a {items,page} envelope');
  assert.equal(body.items, undefined, 'must NOT have been migrated to the paginated envelope');
});

test('POST /api/v1/features creates a feature shell; slug required', async () => {
  const slug = uniqueSlug('acc-feature');
  const { status, body } = await http.post('/api/v1/features', {
    body: featureBody({ slug, name: 'Acceptance Feature' }),
  });
  assert.equal(status, 201);
  assert.equal(body.slug, slug);
  assert.equal(body.manifest.name, 'Acceptance Feature');
  assert.deepEqual(body.manifest.frames, []);
});

test('POST /api/v1/features without a slug is 400', async () => {
  const { status } = await http.post('/api/v1/features', { body: featureBody({ name: 'no slug' }) });
  assert.equal(status, 400);
});

test('POST /api/v1/features with a duplicate slug is 409', async () => {
  const slug = uniqueSlug('dup-feature');
  const first = await http.post('/api/v1/features', { body: featureBody({ slug }) });
  assert.equal(first.status, 201);
  const second = await http.post('/api/v1/features', { body: featureBody({ slug }) });
  assert.equal(second.status, 409);
});

test('GET /api/v1/features/:slug returns manifest + frames (empty object when no frames)', async () => {
  const slug = uniqueSlug('get-feature');
  await http.post('/api/v1/features', { body: featureBody({ slug }) });
  const { status, body } = await http.get(`/api/v1/features/${slug}`, { auth: false });
  assert.equal(status, 200);
  assert.equal(body.slug, slug);
  assert.deepEqual(body.frames, {});
});

test('GET /api/v1/features/:slug for a nonexistent slug is 404', async () => {
  const { status } = await http.get('/api/v1/features/does-not-exist-at-all', { auth: false });
  assert.equal(status, 404);
});

test('PUT/GET/DELETE .../frames/:file round-trips raw HTML content', async () => {
  const slug = uniqueSlug('frame-feature');
  await http.post('/api/v1/features', { body: featureBody({ slug }) });

  const put = await http.put(`/api/v1/features/${slug}/frames/01-index.html`, {
    body: { html: '<html><body>hi</body></html>' },
  });
  assert.equal(put.status, 200);

  const get = await http.get(`/api/v1/features/${slug}/frames/01-index.html`, { auth: false });
  assert.equal(get.status, 200);
  assert.equal(get.body.html, '<html><body>hi</body></html>');

  const del = await http.delete(`/api/v1/features/${slug}/frames/01-index.html`);
  assert.equal(del.status, 204);

  const getAfterDelete = await http.get(`/api/v1/features/${slug}/frames/01-index.html`, { auth: false });
  assert.equal(getAfterDelete.status, 404);
});

test('GET/POST .../stamp — GET is read-only (never persists), POST persists onto the manifest', async () => {
  const slug = uniqueSlug('stamp-feature');
  await http.post('/api/v1/features', { body: featureBody({ slug }) });

  const before = await http.get(`/api/v1/features/${slug}/stamp`, { auth: false });
  assert.equal(before.status, 200);
  assert.match(before.body.stamp, /^[0-9a-f]{64}$/);
  assert.equal(before.body.manifestStamp, null);
  assert.equal(before.body.current, false);

  const persisted = await http.post(`/api/v1/features/${slug}/stamp`, {});
  assert.equal(persisted.status, 200);
  assert.equal(persisted.body.stamp, before.body.stamp);

  const after = await http.get(`/api/v1/features/${slug}/stamp`, { auth: false });
  assert.equal(after.body.manifestStamp, before.body.stamp);
});

// ---- v0.2.0 extension: optional projectId reference -----------------------

test('POST /api/v1/features accepts an optional projectId reference to an existing project', async () => {
  const project = await http.post('/api/v1/projects', { body: { name: 'For a feature' } });
  const slug = uniqueSlug('with-project');
  const { status, body } = await http.post('/api/v1/features', {
    body: featureBody({ slug, projectId: project.body.id }),
  });
  assert.equal(status, 201);
  assert.equal(body.slug, slug);

  const listed = await http.get(`/api/v1/projects/${project.body.id}/features`, { auth: false });
  assert.equal(listed.status, 200);
  assert.ok(listed.body.items.some((f) => f.slug === slug), 'feature must show up under its project');
});

test('POST /api/v1/features with a projectId referencing a NONEXISTENT project is 404 (a reference, checked, not identity)', async () => {
  const slug = uniqueSlug('ghost-project');
  const { status } = await http.post('/api/v1/features', {
    body: featureBody({ slug, projectId: 'fxdf_prj_01h455vb4pex5vsknk084sn02q' }),
  });
  assert.equal(status, 404);
});

test('POST /api/v1/features with a WRONG-TYPE id as projectId is rejected (cross-type confusion, not silently accepted)', async () => {
  // A discussion id where a project id is expected.
  const project = await http.post('/api/v1/projects', { body: { name: 'seed-for-wrong-type' } });
  const discussion = await http.post('/api/v1/discussions', {
    body: { targetType: 'project', targetRef: project.body.id },
  });
  const slug = uniqueSlug('wrong-type-project');
  const { status } = await http.post('/api/v1/features', {
    body: featureBody({ slug, projectId: discussion.body.id }),
  });
  assert.equal(status, 400, `expected 400 for a discussion id used as projectId, got ${status}`);
});

test('GET /api/v1/projects/:id/features is paginated ({items,page}) even though GET /api/v1/features is not', async () => {
  const project = await http.post('/api/v1/projects', { body: { name: 'For pagination' } });
  const { status, body } = await http.get(`/api/v1/projects/${project.body.id}/features`, { auth: false });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.items));
  assert.ok('nextCursor' in body.page && 'hasMore' in body.page);
});

// ---- BUG: `description` is optional in openapi.yaml's feature-create body,
// but the route's own default for OMITTING it fails the service's own
// manifest schema validation --------------------------------------------

test(
  "BUG: POST /api/v1/features WITHOUT `description` is rejected 400, even though " +
    'openapi.yaml only requires [slug] on the create body (description is optional)',
  async () => {
    const slug = uniqueSlug('no-description');
    const { status, body } = await http.post('/api/v1/features', { body: { slug } });
    // EXPECTED per openapi.yaml (POST /api/v1/features requestBody.required: [slug] only):
    //   201, feature created with an empty/absent description.
    // ACTUAL: routes/features.ts defaults an omitted `description` to '' (empty
    // string), but lib/schema.js's validateManifest requires `description` to be
    // a non-empty string — so creating ANY feature without explicitly passing a
    // non-empty description fails validation. An "optional" field the contract
    // never requires makes feature creation impossible without it.
    assert.equal(
      status,
      201,
      `DEFECT: expected 201 (description is optional per openapi.yaml), got ${status}: ${JSON.stringify(body)}`
    );
  }
);
