'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const db = require('../dist/lib/db.js');
const { createApp } = require('../dist/app.js');

async function request(t, route) {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`);
  return { status: response.status, body: await response.json() };
}

test('/ready verifies migrated database and readable/writable content storage', async (t) => {
  let query;
  let mode;
  t.mock.method(db, 'getPool', () => ({ query: async (config) => { query = config; return { rows: [] }; } }));
  t.mock.method(fs, 'mkdir', async () => undefined);
  t.mock.method(fs, 'access', async (_path, permissions) => { mode = permissions; });
  const response = await request(t, '/ready');
  assert.deepEqual(response, { status: 200, body: { status: 'ready' } });
  assert.match(query.text, /design_frames\.project/);
  assert.equal(query.query_timeout, 2000);
  assert.equal(mode, require('node:fs').constants.R_OK | require('node:fs').constants.W_OK);
});

test('database outage removes readiness without leaking details or affecting liveness', async (t) => {
  t.mock.method(db, 'getPool', () => ({ query: async () => { throw new Error('postgres://secret-password@private-db'); } }));
  t.mock.method(fs, 'mkdir', async () => undefined);
  t.mock.method(fs, 'access', async () => undefined);
  assert.deepEqual(await request(t, '/ready'), { status: 503, body: { status: 'not ready' } });
  const alive = await request(t, '/health');
  assert.equal(alive.status, 200);
  assert.equal(alive.body.status, 'healthy');
});

test('content volume outage removes readiness even when Postgres is healthy', async (t) => {
  t.mock.method(db, 'getPool', () => ({ query: async () => ({ rows: [] }) }));
  t.mock.method(fs, 'mkdir', async () => undefined);
  t.mock.method(fs, 'access', async () => { throw new Error('/private-volume unavailable'); });
  assert.deepEqual(await request(t, '/ready'), { status: 503, body: { status: 'not ready' } });
});

test('a missing volume that cannot be created is not ready', async (t) => {
  t.mock.method(db, 'getPool', () => ({ query: async () => ({ rows: [] }) }));
  t.mock.method(fs, 'mkdir', async () => { throw new Error('permission denied'); });
  assert.deepEqual(await request(t, '/ready'), { status: 503, body: { status: 'not ready' } });
});
