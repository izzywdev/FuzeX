'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootServer, requireDatabase } = require('../../acceptance/lib/server.cjs');
const { client } = require('../../acceptance/lib/http.cjs');
const { Client } = require('pg');
const { toUuid } = require('../dist/lib/identity.js');

try { requireDatabase(); } catch {
  test('native flow integration requires DATABASE_URL', { skip: true }, () => {});
  return;
}

let server;
let http;
test.before(async () => { server = await bootServer(); http = client(server.baseUrl, server.token); });
test.after(async () => { await server?.close(); });

async function project() {
  const result = await http.post('/api/v1/projects', { body: { name: 'Native UX flow app' } });
  assert.equal(result.status, 201);
  return result.body.id;
}
const document = (label) => ({ engine: 'react-flow', nodes: [{ id: 'start', type: 'screen', data: { label } }], edges: [] });

test('a project-owned flow has immutable, append-only UX document revisions without a feature or Git manifest', async () => {
  const projectId = await project();
  const base = `/api/v1/projects/${projectId}/flows`;
  const created = await http.post(base, { body: { key: 'checkout', name: 'Checkout', document: document('Cart'), message: 'Initial flow' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.flow.projectId, projectId);
  assert.equal(created.body.flow.currentRevision, 1);
  assert.equal(created.body.revision.document.nodes[0].data.label, 'Cart');

  const flowId = created.body.flow.id;
  const update = await http.post(`${base}/${flowId}/revisions`, { body: { expectedRevision: 1, document: document('Payment'), message: 'Add payment screen' } });
  assert.equal(update.status, 201);
  assert.equal(update.body.revision, 2);
  const first = await http.get(`${base}/${flowId}/revisions/1`);
  assert.deepEqual(first.body, created.body.revision);
  const listed = await http.get(`${base}/${flowId}/revisions?limit=1`);
  assert.equal(listed.body.items[0].revision, 1);
  assert.equal(listed.body.page.hasMore, true);
  const secondPage = await http.get(`${base}/${flowId}/revisions?limit=1&cursor=${listed.body.page.nextCursor}`);
  assert.equal(secondPage.body.items[0].revision, 2);
  assert.equal((await http.get(`${base}/${flowId}`)).body.currentRevision, 2);
});

test('native flow writers use optimistic concurrency and database snapshots cannot be mutated or deleted', async () => {
  const projectId = await project();
  const base = `/api/v1/projects/${projectId}/flows`;
  const created = await http.post(base, { body: { key: 'onboarding', name: 'Onboarding', document: document('Welcome') } });
  const flowId = created.body.flow.id;
  const writers = await Promise.all([
    http.post(`${base}/${flowId}/revisions`, { body: { expectedRevision: 1, document: document('Profile') } }),
    http.post(`${base}/${flowId}/revisions`, { body: { expectedRevision: 1, document: document('Invite') } }),
  ]);
  assert.deepEqual(writers.map((result) => result.status).sort(), [201, 409]);
  const db = new Client({ connectionString: server.databaseUrl });
  await db.connect();
  try {
    for (const sql of [
      "update design_frames.flow_document_revision set message = 'overwritten' where flow_id = $1",
      'delete from design_frames.flow_document_revision where flow_id = $1',
    ]) await assert.rejects(db.query(sql, [toUuid(flowId)]), /immutable/);
  } finally { await db.end(); }
});

test('native flow records cannot cross App boundaries', async () => {
  const owner = await project();
  const other = await project();
  const created = await http.post(`/api/v1/projects/${owner}/flows`, { body: { key: 'profile', name: 'Profile', document: document('Profile') } });
  const foreignRead = await http.get(`/api/v1/projects/${other}/flows/${created.body.flow.id}`);
  assert.equal(foreignRead.status, 404);
  const foreignRevision = await http.post(`/api/v1/projects/${other}/flows/${created.body.flow.id}/revisions`, { body: { expectedRevision: 1, document: document('Other') } });
  assert.equal(foreignRevision.status, 404);
});
