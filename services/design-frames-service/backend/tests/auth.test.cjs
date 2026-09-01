'use strict';

// Write-path auth tests for the machine-token migration (issue #26).
//
// The load-bearing test here is "introspection 200 + { active: false } is
// REJECTED". FuzeFront's introspection contract answers HTTP 200 for EVERY
// token — unknown, expired and revoked ones come back `200 { active: false }`.
// An implementation that reads "200" as "valid" accepts every token ever
// presented, which is a complete authentication bypass and which every
// happy-path test in the world still passes. It is asserted explicitly, and the
// assertion also checks the stub really answered 200, so the test cannot start
// passing for the wrong reason (e.g. the transport failing).

const test = require('node:test');
const assert = require('node:assert/strict');

const INTROSPECT_URL = 'https://fuzefront.test/api/v1/security/tokens/introspect';
const SCOPE = 'fuzex:frames:write';

// Read at module-load time by the middleware, so set before requiring it.
process.env.FUZEFRONT_API_URL = 'https://fuzefront.test';
// Disable the positive-result cache so each test's scripted response is used.
process.env.DESIGN_FRAMES_INTROSPECTION_CACHE_SECONDS = '0';

/** Scripted introspection responses keyed by token. Unknown => 200 active:false. */
const responses = new Map();
/** What the stub actually answered, so a test can prove the HTTP status. */
let lastResponse = null;

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

globalThis.fetch = async (url, init) => {
  assert.equal(url, INTROSPECT_URL, 'middleware must call the introspection contract path');
  const { token } = JSON.parse(init.body);
  const scripted = responses.get(token);
  const res =
    typeof scripted === 'function'
      ? await scripted()
      : scripted || jsonResponse(200, { active: false });
  lastResponse = { status: res.status, token };
  return res;
};

function activeToken(token, { subject = 'svc-test', tenantId = null, scope = SCOPE } = {}) {
  responses.set(token, jsonResponse(200, { active: true, subject, tenantId, scope }));
  return token;
}

const { requireAuthForWrites, __testables } = require('../dist/middleware/auth.js');

function fakeReq(method, headers = {}) {
  return { method, headers };
}
function fakeRes() {
  return {};
}

/** Run the middleware and resolve with the error it passed to next() (or undefined). */
function run(req) {
  return new Promise((resolve) => {
    requireAuthForWrites(req, fakeRes(), (err) => resolve(err));
  });
}

test('GET (read) always passes through, even with no token', async () => {
  const err = await run(fakeReq('GET'));
  assert.equal(err, undefined);
});

test('POST with a valid, active, correctly-scoped token passes through', async () => {
  const t = activeToken('good-token', { subject: 'svc-fuzefront', tenantId: 'tenant-a' });
  const req = fakeReq('POST', { authorization: `Bearer ${t}` });
  const err = await run(req);
  assert.equal(err, undefined);
  assert.equal(req.machineIdentity.subject, 'svc-fuzefront');
  assert.equal(req.machineIdentity.tenantId, 'tenant-a');
});

// ─── The fail-open regression tests ───

test('FAIL-OPEN GUARD: introspection 200 + { active: false } is REJECTED', async () => {
  responses.set('revoked-token', jsonResponse(200, { active: false }));

  const err = await run(fakeReq('POST', { authorization: 'Bearer revoked-token' }));

  // Prove the stub really answered 200: this test exists to catch an
  // implementation that treats a 200 status as authentication success.
  assert.deepEqual(lastResponse, { status: 200, token: 'revoked-token' });
  assert.ok(err, 'an inactive token MUST be rejected despite the 200 status');
  assert.equal(err.code, 'UNAUTHORIZED');
});

test('FAIL-OPEN GUARD: introspection 200 with a body missing `active` is REJECTED', async () => {
  responses.set('no-active', jsonResponse(200, { subject: 'svc-x', scope: SCOPE }));
  const err = await run(fakeReq('POST', { authorization: 'Bearer no-active' }));
  assert.equal(lastResponse.status, 200);
  assert.ok(err);
  assert.equal(err.code, 'UNAUTHORIZED');
});

test('FAIL-OPEN GUARD: introspection 200 with a non-boolean `active` is REJECTED', async () => {
  responses.set('stringy', jsonResponse(200, { active: 'true', subject: 'svc-x', scope: SCOPE }));
  const err = await run(fakeReq('POST', { authorization: 'Bearer stringy' }));
  assert.equal(lastResponse.status, 200);
  assert.ok(err);
});

test('an active token with no `subject` is REJECTED', async () => {
  responses.set('no-subject', jsonResponse(200, { active: true, scope: SCOPE }));
  const err = await run(fakeReq('POST', { authorization: 'Bearer no-subject' }));
  assert.ok(err);
});

// ─── Undecidable is a denial, never a pass ───

test('a 500 from introspection is a denial', async () => {
  responses.set('svc-down', () => jsonResponse(500, { error: 'boom' }));
  const err = await run(fakeReq('POST', { authorization: 'Bearer svc-down' }));
  assert.ok(err);
  assert.equal(err.code, 'UNAUTHORIZED');
});

test('a network failure reaching introspection is a denial', async () => {
  responses.set('net-fail', () => Promise.reject(new Error('ECONNREFUSED')));
  const err = await run(fakeReq('POST', { authorization: 'Bearer net-fail' }));
  assert.ok(err);
});

test('a non-JSON introspection body is a denial', async () => {
  responses.set('garbage', () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('Unexpected token <');
    },
  }));
  const err = await run(fakeReq('POST', { authorization: 'Bearer garbage' }));
  assert.ok(err);
});

// ─── No token / malformed header ───

test('POST with no Authorization header is rejected', async () => {
  const err = await run(fakeReq('POST'));
  assert.ok(err);
  assert.equal(err.code, 'UNAUTHORIZED');
});

test('POST with a non-Bearer Authorization header is rejected', async () => {
  const err = await run(fakeReq('POST', { authorization: 'Basic dXNlcjpwYXNz' }));
  assert.ok(err);
  assert.equal(err.code, 'UNAUTHORIZED');
});

test('every write method is gated, not just POST', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const err = await run(fakeReq(method));
    assert.ok(err, `${method} must be gated`);
    assert.equal(err.code, 'UNAUTHORIZED');
  }
});

// ─── Scope enforcement ───

test('an active token WITHOUT the write scope is FORBIDDEN, not unauthorized', async () => {
  const t = activeToken('read-only', { scope: 'fuzex:frames:read' });
  const err = await run(fakeReq('POST', { authorization: `Bearer ${t}` }));
  assert.ok(err);
  assert.equal(err.code, 'FORBIDDEN');
});

test('an active token with no scopes at all is FORBIDDEN', async () => {
  responses.set('no-scope', jsonResponse(200, { active: true, subject: 'svc-x' }));
  const err = await run(fakeReq('POST', { authorization: 'Bearer no-scope' }));
  assert.ok(err);
  assert.equal(err.code, 'FORBIDDEN');
});

test('the scope must match exactly, not as a substring', async () => {
  const t = activeToken('substring', { scope: 'fuzex:frames:write-nope' });
  const err = await run(fakeReq('POST', { authorization: `Bearer ${t}` }));
  assert.ok(err);
  assert.equal(err.code, 'FORBIDDEN');
});

// ─── The retired pre-shared token is gone ───

test('DESIGN_FRAMES_API_TOKENS is not read by the middleware', async () => {
  const src = require('node:fs').readFileSync(
    require.resolve('../dist/middleware/auth.js'),
    'utf8'
  );
  assert.ok(
    !/process\.env\.DESIGN_FRAMES_API_TOKENS/.test(src),
    'the pre-shared token list must not be read anywhere'
  );
});

test('setting DESIGN_FRAMES_API_TOKENS does not make it a usable credential', async () => {
  process.env.DESIGN_FRAMES_API_TOKENS = 'legacy-token';
  const err = await run(fakeReq('POST', { authorization: 'Bearer legacy-token' }));
  delete process.env.DESIGN_FRAMES_API_TOKENS;
  assert.ok(err, 'the retired pre-shared token must not authenticate anything');
});

// The ORIGINAL fail-open, asserted directly. The previous middleware began
// `if (TOKENS.size === 0) return next();`, and TOKENS came from
// `(process.env.DESIGN_FRAMES_API_TOKENS || '').split(',').filter(Boolean)` — so
// UNSET, EMPTY STRING and a comma/whitespace-only value ALL yielded an empty set
// and made every write unauthenticated. The secret was never sealed and the
// mount was `optional: true`, so that was the DEFAULT state of every
// environment. Each input is replayed here and must be REJECTED.
for (const [label, value] of [
  ['unset', undefined],
  ['empty string', ''],
  ['comma/whitespace only', ' , , '],
]) {
  test(`FAIL-OPEN GUARD: empty token store (${label}) still REJECTS writes`, async () => {
    if (value === undefined) delete process.env.DESIGN_FRAMES_API_TOKENS;
    else process.env.DESIGN_FRAMES_API_TOKENS = value;

    const noHeader = await run(fakeReq('POST'));
    const withHeader = await run(fakeReq('POST', { authorization: 'Bearer anything-at-all' }));
    delete process.env.DESIGN_FRAMES_API_TOKENS;

    assert.ok(noHeader, `empty token store (${label}) must refuse an unauthenticated write`);
    assert.equal(noHeader.code, 'UNAUTHORIZED');
    assert.ok(withHeader, `empty token store (${label}) must not accept an arbitrary bearer`);
    assert.equal(withHeader.code, 'UNAUTHORIZED');
  });
}

test('extractBearer parses the "Bearer <token>" header shape only', () => {
  assert.equal(__testables.extractBearer({ headers: { authorization: 'Bearer abc' } }), 'abc');
  assert.equal(__testables.extractBearer({ headers: { authorization: 'Basic abc' } }), null);
  assert.equal(__testables.extractBearer({ headers: {} }), null);
});
