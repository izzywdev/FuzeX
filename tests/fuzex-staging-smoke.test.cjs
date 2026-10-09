'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const script = path.resolve(__dirname, '../scripts/fuzex-staging-smoke.mjs');

function run(env, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env } });
    let out = ''; let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

async function withServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('health-only verifier accepts JSON liveness/readiness without credentials', async (t) => {
  const base = await withServer(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url === '/health' ? { status: 'healthy' } : { status: 'ready' }));
  });
  const result = await run({ FUZE_X_SMOKE_BASE_URL: base });
  assert.equal(result.code, 0, result.err);
  assert.deepEqual(JSON.parse(result.out), { healthy: true, ready: true });
});

test('verifier rejects a portal HTML fallback even when it has a 200 status', async (t) => {
  const base = await withServer(t, (_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><html><body>portal</body></html>');
  });
  const result = await run({ FUZE_X_SMOKE_BASE_URL: base });
  assert.equal(result.code, 1);
  assert.match(result.err, /returned HTML/);
});

test('mutation mode refuses to write without the explicit dedicated-fixture acknowledgement', async (t) => {
  const base = await withServer(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url === '/health' ? { status: 'healthy' } : { status: 'ready' }));
  });
  const result = await run({ FUZE_X_SMOKE_BASE_URL: base, FUZE_X_SMOKE_BEARER_TOKEN: 'not-printed', FUZE_X_SMOKE_FEATURE_SLUG: 'fuzex-smoke' }, ['--mutation']);
  assert.equal(result.code, 1);
  assert.match(result.err, /ALLOW_MUTATION/);
  assert.doesNotMatch(result.err, /not-printed/);
});
