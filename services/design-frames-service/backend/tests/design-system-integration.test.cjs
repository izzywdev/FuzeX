'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootServer, requireDatabase } = require('../../acceptance/lib/server.cjs');
const { client } = require('../../acceptance/lib/http.cjs');
const { Client } = require('pg');
const { toUuid } = require('../dist/lib/identity.js');

try { requireDatabase(); } catch {
  test('design system integration requires DATABASE_URL', { skip: true }, () => {});
  return;
}

let server;
let http;
test.before(async () => { server = await bootServer(); http = client(server.baseUrl, server.token); });
test.after(async () => { await server?.close(); });

async function project() {
  const created = await http.post('/api/v1/projects', { body: { name: 'Design-system test app' } });
  assert.equal(created.status, 201);
  return created.body.id;
}
const snapshot = (expectedRevision, color = '#06f') => ({ expectedRevision, name: 'Core', tokens: { accent: color }, components: [{ key: 'primary-button', name: 'Primary button' }] });

test('workspace starts empty and design system revisions retain previous token and component decisions', async () => {
  const id = await project();
  const base = `/api/v1/projects/${id}`;
  const empty = await http.get(`${base}/workspace`);
  assert.equal(empty.status, 200);
  assert.equal(empty.body.designSystem, null);
  assert.equal(empty.body.flowCount, 0);
  assert.equal((await http.get(`${base}/design-system`)).status, 404);
  const first = await http.post(`${base}/design-system/revisions`, { body: snapshot(0) });
  assert.equal(first.status, 201);
  assert.equal(first.body.revision, 1);
  assert.equal(first.body.createdBy, 'svc-acceptance');
  const update = snapshot(1, '#fff');
  update.components[0].status = 'rejected';
  update.components[0].reason = 'Insufficient contrast';
  const second = await http.post(`${base}/design-system/revisions`, { body: update });
  assert.equal(second.status, 201);
  assert.equal(second.body.revision, 2);
  const previous = await http.get(`${base}/design-system/revisions/1`);
  assert.deepEqual(previous.body, first.body);
  const current = await http.get(`${base}/design-system`);
  assert.deepEqual(current.body, second.body);
  assert.equal((await http.get(`${base}/workspace`)).body.designSystem.revision, 2);
  const page1 = await http.get(`${base}/design-system/revisions?limit=1`);
  assert.equal(page1.body.items[0].revision, 1);
  assert.equal(page1.body.page.hasMore, true);
  const page2 = await http.get(`${base}/design-system/revisions?limit=1&cursor=${page1.body.page.nextCursor}`);
  assert.equal(page2.body.items[0].revision, 2);
  assert.equal(page2.body.page.hasMore, false);
});

test('concurrent writers cannot lose updates or create duplicate revision numbers', async () => {
  const id = await project();
  const path = `/api/v1/projects/${id}/design-system/revisions`;
  const results = await Promise.all([
    http.post(path, { body: snapshot(0, '#000') }),
    http.post(path, { body: snapshot(0, '#fff') }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const history = await http.get(path);
  assert.equal(history.body.items.length, 1);
  assert.equal(history.body.items[0].revision, 1);
});

test('database blocks direct update and delete of reviewed design-system snapshots', async () => {
  const id = await project();
  assert.equal((await http.post(`/api/v1/projects/${id}/design-system/revisions`, { body: snapshot(0) })).status, 201);
  const db = new Client({ connectionString: server.databaseUrl });
  await db.connect();
  try {
    for (const sql of [
      "update design_frames.design_system_revision set name = 'overwritten' where project_id = $1",
      'delete from design_frames.design_system_revision where project_id = $1',
    ]) await assert.rejects(db.query(sql, [toUuid(id)]), /immutable/);
  } finally { await db.end(); }
});

test('historical snapshots and revision cursors are scoped to their owning project', async () => {
  const a = await project();
  const b = await project();
  const pathA = `/api/v1/projects/${a}/design-system/revisions`;
  const pathB = `/api/v1/projects/${b}/design-system/revisions`;
  await http.post(pathA, { body: snapshot(0) });
  await http.post(pathA, { body: snapshot(1) });
  assert.equal((await http.get(`${pathB}/1`)).status, 404);
  const page = await http.get(`${pathA}?limit=1`);
  assert.equal((await http.get(`${pathB}?cursor=${page.body.page.nextCursor}`)).status, 400);
  assert.equal((await http.get(`${pathA}/0`)).status, 400);
  assert.equal((await http.post(pathA, { body: snapshot(2), auth: false })).status, 401);
});
