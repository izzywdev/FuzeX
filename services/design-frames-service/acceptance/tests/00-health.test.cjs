'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootServer, requireDatabase } = require('../lib/server.cjs');
const { client } = require('../lib/http.cjs');

let srv;
let http;

try {
  requireDatabase();
} catch (err) {
  console.warn(`00-health.test.cjs: ${err.message} — skipping.`);
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

test('GET /health is public and returns healthy (no Authorization header sent)', async () => {
  const { status, body } = await http.get('/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'healthy');
  assert.equal(typeof body.timestamp, 'number');
});
