'use strict';

/**
 * Integration tests for server.js — REST API auth, CRUD, and approval flow.
 * Node built-in assert + http only, no test-framework dependency (mirrors
 * tests/bridge-server-security.test.cjs at the repo root).
 * Run with: node tests/server.test.cjs
 */

const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-frames-server-test-'));
process.env.DESIGN_FRAMES_DATA_DIR = tmp;
process.env.DESIGN_FRAMES_API_TOKENS = 'test-token-123';
process.env.DESIGN_FRAMES_PORT = '0';

const { start } = require('../server');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.error('  FAIL  ' + name);
    console.error('        ' + (err && err.message ? err.message : String(err)));
  }
}

function request(port, options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, ...options }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        // `raw` and `headers` are exposed alongside the parsed body because not
        // every response IS JSON — /openapi.yaml is YAML, and asserting on it
        // through `data` would silently compare `null` to `null` and pass no
        // matter what the server returned. Purely additive: `status` and `data`
        // are unchanged for every existing test.
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, data, raw, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const server = start();
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const auth = { Authorization: 'Bearer test-token-123', 'Content-Type': 'application/json' };

  await test('unauthenticated create is rejected', async () => {
    const res = await request(port, { method: 'POST', path: '/api/v1/features', headers: { 'Content-Type': 'application/json' } }, { slug: 'x' });
    assert.strictEqual(res.status, 401);
  });

  await test('authenticated create succeeds', async () => {
    const res = await request(
      port,
      { method: 'POST', path: '/api/v1/features', headers: auth },
      { slug: 'checkout-redesign', name: 'Checkout redesign', description: 'New checkout flow' }
    );
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.slug, 'checkout-redesign');
  });

  await test('GET features list is public (no auth header)', async () => {
    const res = await request(port, { method: 'GET', path: '/api/v1/features' });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.features.some((f) => f.slug === 'checkout-redesign'));
  });

  await test('duplicate create conflicts', async () => {
    const res = await request(
      port,
      { method: 'POST', path: '/api/v1/features', headers: auth },
      { slug: 'checkout-redesign', name: 'Checkout redesign', description: 'New checkout flow' }
    );
    assert.strictEqual(res.status, 409);
  });

  await test('invalid manifest on create is rejected with details', async () => {
    const res = await request(port, { method: 'POST', path: '/api/v1/features', headers: auth }, {});
    assert.strictEqual(res.status, 400);
  });

  await test('PUT manifest with a flow, then GET stamp', async () => {
    const manifest = {
      name: 'Checkout redesign',
      description: 'New checkout flow',
      designSystem: 'ds',
      entry: 'index.html',
      frames: [
        { id: '01-cart', file: '01-cart.html', label: '(a) Cart', summary: 'Cart review', testHooks: ["[data-frame='cart']"], flow: 'checkout' },
      ],
      build: { flows: [{ id: 'checkout', orchestrator: 'CheckoutFlow', route: '/checkout', approved: false, approvedBy: null, approvedAt: null }] },
    };
    const put = await request(port, { method: 'PUT', path: '/api/v1/features/checkout-redesign/manifest', headers: auth }, manifest);
    assert.strictEqual(put.status, 200);

    const stamp = await request(port, { method: 'GET', path: '/api/v1/features/checkout-redesign/stamp' });
    assert.strictEqual(stamp.status, 200);
    assert.match(stamp.data.stamp, /^[0-9a-f]{64}$/);
    assert.strictEqual(stamp.data.current, false, 'not yet persisted onto the manifest');
  });

  await test('PUT frame content, GET it back via the public /site surface', async () => {
    const put = await request(
      port,
      { method: 'PUT', path: '/api/v1/features/checkout-redesign/frames/01-cart.html', headers: auth },
      { html: '<html><body data-frame="cart">Cart</body></html>' }
    );
    assert.strictEqual(put.status, 200);

    const site = await request(port, { method: 'GET', path: '/site/checkout-redesign/01-cart.html' });
    assert.strictEqual(site.status, 200);
  });

  await test('POST /stamp persists the computed stamp onto the manifest', async () => {
    const write = await request(port, { method: 'POST', path: '/api/v1/features/checkout-redesign/stamp', headers: auth });
    assert.strictEqual(write.status, 200);

    const check = await request(port, { method: 'GET', path: '/api/v1/features/checkout-redesign/stamp' });
    assert.strictEqual(check.data.current, true, 'persisted stamp now matches the computed one');
  });

  await test('approve requires auth and an approvedBy', async () => {
    const noAuth = await request(port, { method: 'POST', path: '/api/v1/features/checkout-redesign/flows/checkout/approve', headers: { 'Content-Type': 'application/json' } }, {});
    assert.strictEqual(noAuth.status, 401);

    const missingApprover = await request(port, { method: 'POST', path: '/api/v1/features/checkout-redesign/flows/checkout/approve', headers: auth }, {});
    assert.strictEqual(missingApprover.status, 400);

    const ok = await request(port, { method: 'POST', path: '/api/v1/features/checkout-redesign/flows/checkout/approve', headers: auth }, { approvedBy: 'izzy' });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.data.flow.approved, true);
    assert.strictEqual(ok.data.flow.approvedBy, 'izzy');
  });

  await test('approving does not change the stamp', async () => {
    const res = await request(port, { method: 'GET', path: '/api/v1/features/checkout-redesign/stamp' });
    assert.strictEqual(res.data.current, true, 'stamp recorded before approval still matches after approval');
  });

  // The contract has to be reachable from the running service, not just present
  // in the repository — an unfetchable openapi.yaml cannot be diffed against the
  // instance actually serving traffic, which is most of what publishing one buys.
  await test('GET /openapi.yaml serves the contract, unauthenticated', async () => {
    const res = await request(port, { method: 'GET', path: '/openapi.yaml' });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers['content-type'] || '', /yaml/);
    assert.match(res.raw, /^openapi: 3\./m, 'body is not the OpenAPI document');
    assert.match(res.raw, /design-frames-service/, 'served spec is not this service');
  });

  await test('GET /openapi.json serves the same bytes, not a half-conversion', async () => {
    // Accepted because tooling asks for it by convention. It must NOT claim to be
    // JSON while returning YAML, and it must not diverge from /openapi.yaml.
    const [yaml, json] = await Promise.all([
      request(port, { method: 'GET', path: '/openapi.yaml' }),
      request(port, { method: 'GET', path: '/openapi.json' }),
    ]);
    assert.strictEqual(json.status, 200);
    assert.strictEqual(json.raw, yaml.raw, '/openapi.json and /openapi.yaml disagree');
    assert.doesNotMatch(json.headers['content-type'] || '', /application\/json/,
      'served YAML under a JSON content type');
  });

  await test('unknown route 404s', async () => {
    const res = await request(port, { method: 'GET', path: '/api/v1/nope' });
    assert.strictEqual(res.status, 404);
  });

  // The Module-Federation remote (webapp/'s built dist/) used to be served
  // here at /apps/fuzex/ by server.js itself — migrated to the family-
  // standard nginx-serving stage (Dockerfile's `webapp-mfe` target,
  // webapp/nginx.conf). This process no longer answers that route at all
  // (see the "Module-Federation remote" comment near the top of server.js),
  // so there is nothing left for this suite to exercise; the nginx image's
  // build+serve contract is smoke-tested at the Docker level instead
  // (.github/workflows/design-frames-service-ci.yml).
  await test('GET /apps/fuzex/ is not served by this process (moved to nginx)', async () => {
    const res = await request(port, { method: 'GET', path: '/apps/fuzex/remoteEntry.js' });
    assert.strictEqual(res.status, 404);
  });

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
