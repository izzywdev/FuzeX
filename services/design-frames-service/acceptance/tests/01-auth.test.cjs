'use strict';

/**
 * 01-auth.test.cjs — "writes require bearer token (401/403 without), reads
 * public" (openapi.yaml securitySchemes.bearerAuth: "Required for all write
 * operations (POST/PUT/DELETE except /health). Reads are public.").
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
  console.warn(`01-auth.test.cjs: ${err.message} — skipping.`);
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

test('POST /api/v1/projects with NO Authorization header is rejected', async () => {
  const { status } = await http.post('/api/v1/projects', { body: { name: 'no-auth' }, auth: false });
  assert.equal(status, 401);
});

test('POST /api/v1/projects with an INVALID bearer token is rejected', async () => {
  const { status } = await http.post('/api/v1/projects', { body: { name: 'bad-auth' }, auth: 'wrong-token' });
  assert.equal(status, 401);
});

test('POST /api/v1/projects with the VALID bearer token succeeds', async () => {
  const { status } = await http.post('/api/v1/projects', { body: { name: 'good-auth' }, auth: true });
  assert.equal(status, 201);
});

test('PATCH (write) also requires the bearer token', async () => {
  const created = await http.post('/api/v1/projects', { body: { name: 'to-patch' } });
  assert.equal(created.status, 201);
  const { status } = await http.patch(`/api/v1/projects/${created.body.id}`, {
    body: { name: 'renamed' },
    auth: false,
  });
  assert.equal(status, 401);
});

test('GET (read) never requires a bearer token, even on a collection that requires auth to write', async () => {
  const { status } = await http.get('/api/v1/projects', { auth: false });
  assert.equal(status, 200);
});

test('GET a single resource is public too', async () => {
  const created = await http.post('/api/v1/projects', { body: { name: 'public-read' } });
  const { status } = await http.get(`/api/v1/projects/${created.body.id}`, { auth: false });
  assert.equal(status, 200);
});
