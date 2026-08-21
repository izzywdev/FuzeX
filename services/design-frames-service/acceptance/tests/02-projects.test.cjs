'use strict';

/**
 * 02-projects.test.cjs — /api/v1/projects CRUD against openapi.yaml's
 * Project/ProjectCreate/ProjectPatch schemas, including the mandatory
 * identifier-verification checks (governance/identifier-standard.md) for
 * this create surface.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootServer, requireDatabase } = require('../lib/server.cjs');
const { client } = require('../lib/http.cjs');
const { assertMatchesSchema, assertMatchesPageEnvelope } = require('../lib/openapiSchemas.cjs');

let srv;
let http;

try {
  requireDatabase();
} catch (err) {
  console.warn(`02-projects.test.cjs: ${err.message} — skipping.`);
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

test('POST /api/v1/projects mints an fxdf_prj_* id and matches the Project schema', async () => {
  const { status, body } = await http.post('/api/v1/projects', {
    body: { name: 'Acme Redesign', description: 'Q3 revamp', sourceRepo: 'FuzeFront' },
  });
  assert.equal(status, 201);
  assert.match(body.id, /^fxdf_prj_[0-9a-hjkmnp-tv-z]+$/);
  assert.equal(body.name, 'Acme Redesign');
  assert.equal(body.sourceRepo, 'FuzeFront');
  assertMatchesSchema('Project', body);
});

test('POST /api/v1/projects with a minimal body (name only) succeeds, nullable fields default to null', async () => {
  const { status, body } = await http.post('/api/v1/projects', { body: { name: 'Minimal' } });
  assert.equal(status, 201);
  assert.equal(body.description, null);
  assert.equal(body.sourceRepo, null);
  assertMatchesSchema('Project', body);
});

test('POST /api/v1/projects rejects a missing name — 400', async () => {
  const { status } = await http.post('/api/v1/projects', { body: {} });
  assert.equal(status, 400);
});

test('POST /api/v1/projects rejects an empty-string name — 400', async () => {
  const { status } = await http.post('/api/v1/projects', { body: { name: '   ' } });
  assert.equal(status, 400);
});

// ---- Identifier verification (mandatory, identifier-standard §1) ---------

test('POST /api/v1/projects with a client-supplied `id` is REJECTED (422/400), never echoed', async () => {
  const { status, body } = await http.post('/api/v1/projects', {
    body: { name: 'Client-chosen id', id: 'fxdf_prj_01h455vb4pex5vsknk084sn02q' },
  });
  assert.ok([400, 422].includes(status), `expected 400/422, got ${status}`);
  // Whatever id it minted (if any leaked through), it must NOT be the client-supplied one.
  if (body && body.id) assert.notEqual(body.id, 'fxdf_prj_01h455vb4pex5vsknk084sn02q');
});

test('POST /api/v1/projects rejects any unexpected property (additionalProperties:false)', async () => {
  const { status } = await http.post('/api/v1/projects', {
    body: { name: 'Extra field', notInSchema: 'nope' },
  });
  assert.ok([400, 422].includes(status), `expected 400/422, got ${status}`);
});

test('POST /api/v1/projects rejects a `uuid` field on the create body too', async () => {
  const { status } = await http.post('/api/v1/projects', {
    body: { name: 'uuid attempt', uuid: '00000000-0000-7000-8000-000000000000' },
  });
  assert.ok([400, 422].includes(status), `expected 400/422, got ${status}`);
});

test('GET /api/v1/projects/:id with an id minted for a DIFFERENT entity type is rejected (cross-type confusion)', async () => {
  // A discussion id used where a project id is expected must be rejected —
  // never silently coerced or looked up as if it were a project.
  const discussion = await seedAnyDiscussionId();
  const { status } = await http.get(`/api/v1/projects/${discussion}`, { auth: false });
  assert.ok([400, 404].includes(status), `expected 400/404 for wrong-type id, got ${status}`);
});

test('GET /api/v1/projects/:id with a well-formed but nonexistent id is 404 (an id is never a capability)', async () => {
  const { status } = await http.get('/api/v1/projects/fxdf_prj_01h455vb4pex5vsknk084sn02q', { auth: false });
  assert.equal(status, 404);
});

test('GET /api/v1/projects/:id with a garbage (non-TypeID) id is a client error, not a 500', async () => {
  const { status } = await http.get('/api/v1/projects/not-an-id', { auth: false });
  assert.ok([400, 404].includes(status), `expected 400/404, got ${status}`);
});

async function seedAnyDiscussionId() {
  const project = await http.post('/api/v1/projects', { body: { name: 'for-discussion-seed' } });
  const disc = await http.post('/api/v1/discussions', {
    body: { targetType: 'project', targetRef: project.body.id },
  });
  assert.equal(disc.status, 201, 'seed discussion must succeed');
  return disc.body.id;
}

// ---- PATCH ----------------------------------------------------------------

test('PATCH /api/v1/projects/:id updates mutable fields and leaves id/createdAt unchanged', async () => {
  const created = await http.post('/api/v1/projects', { body: { name: 'Before' } });
  const { status, body } = await http.patch(`/api/v1/projects/${created.body.id}`, {
    body: { name: 'After', description: 'now set' },
  });
  assert.equal(status, 200);
  assert.equal(body.id, created.body.id);
  assert.equal(body.name, 'After');
  assert.equal(body.description, 'now set');
  assert.equal(body.createdAt, created.body.createdAt);
  assertMatchesSchema('Project', body);
});

test('PATCH /api/v1/projects/:id rejects an empty body (minProperties:1)', async () => {
  const created = await http.post('/api/v1/projects', { body: { name: 'Needs one field' } });
  const { status } = await http.patch(`/api/v1/projects/${created.body.id}`, { body: {} });
  assert.equal(status, 400);
});

test('PATCH /api/v1/projects/:id cannot change id (id is not a mutable field)', async () => {
  const created = await http.post('/api/v1/projects', { body: { name: 'Immutable id' } });
  const other = 'fxdf_prj_01h455vb4pex5vsknk084sn02q';
  const { status, body } = await http.patch(`/api/v1/projects/${created.body.id}`, {
    body: { name: 'still same id', id: other },
  });
  // Either rejected outright (additionalProperties:false on ProjectPatch), or
  // accepted but the id field is ignored — either is compliant; silently
  // adopting the client's id would not be.
  if (status === 200) {
    assert.equal(body.id, created.body.id);
  } else {
    assert.ok([400, 422].includes(status));
  }
});

test('PATCH nonexistent project is 404', async () => {
  const { status } = await http.patch('/api/v1/projects/fxdf_prj_01h455vb4pex5vsknk084sn02q', {
    body: { name: 'ghost' },
  });
  assert.equal(status, 404);
});

// ---- Pagination (mandatory) -------------------------------------------------

test('GET /api/v1/projects returns the {items, page:{nextCursor,hasMore}} envelope', async () => {
  const { status, body } = await http.get('/api/v1/projects?limit=5', { auth: false });
  assert.equal(status, 200);
  assertMatchesPageEnvelope('Project', body);
});

test('GET /api/v1/projects: limit is CLAMPED at 200, never returns more even if asked for more', async () => {
  const { status, body } = await http.get('/api/v1/projects?limit=100000', { auth: false });
  assert.equal(status, 200);
  assert.ok(body.items.length <= 200);
});

test('GET /api/v1/projects: the cursor walks the whole set with no gaps or dupes, terminating with hasMore:false', async () => {
  const names = Array.from({ length: 23 }, (_, i) => `walk-project-${i}`);
  const createdIds = [];
  for (const name of names) {
    const res = await http.post('/api/v1/projects', { body: { name } });
    assert.equal(res.status, 201);
    createdIds.push(res.body.id);
  }

  const seen = new Set();
  let cursor;
  let hasMore = true;
  let pages = 0;
  while (hasMore) {
    const qs = new URLSearchParams({ limit: '7' });
    if (cursor) qs.set('cursor', cursor);
    const { status, body } = await http.get(`/api/v1/projects?${qs}`, { auth: false });
    assert.equal(status, 200);
    assert.ok(body.items.length <= 7, 'page must not exceed limit');
    for (const item of body.items) {
      assert.ok(!seen.has(item.id), `duplicate id ${item.id} across pages`);
      seen.add(item.id);
    }
    hasMore = body.page.hasMore;
    cursor = body.page.nextCursor;
    if (hasMore) assert.ok(cursor, 'hasMore:true must carry a nextCursor');
    else assert.equal(cursor, null, 'hasMore:false must carry a null nextCursor');
    pages += 1;
    assert.ok(pages < 100, 'pagination did not terminate — possible infinite loop');
  }

  for (const id of createdIds) {
    assert.ok(seen.has(id), `project ${id} was never visited while walking the cursor`);
  }
});
