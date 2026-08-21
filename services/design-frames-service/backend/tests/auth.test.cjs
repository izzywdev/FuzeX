'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// requireAuthForWrites reads DESIGN_FRAMES_API_TOKENS at module-load time, so
// set it before requiring.
process.env.DESIGN_FRAMES_API_TOKENS = 'secret-token-a, secret-token-b';
const { requireAuthForWrites, __testables } = require('../dist/middleware/auth.js');

function fakeReq(method, headers = {}) {
  return { method, headers };
}
function fakeRes() {
  return {};
}

test('GET (read) always passes through, even with no token', () => {
  let called = false;
  requireAuthForWrites(fakeReq('GET'), fakeRes(), () => {
    called = true;
  });
  assert.equal(called, true);
});

test('POST with a valid bearer token passes through', () => {
  let err;
  requireAuthForWrites(fakeReq('POST', { authorization: 'Bearer secret-token-a' }), fakeRes(), (e) => {
    err = e;
  });
  assert.equal(err, undefined);
});

test('POST with an invalid bearer token is rejected (UNAUTHORIZED)', () => {
  let err;
  requireAuthForWrites(fakeReq('POST', { authorization: 'Bearer wrong-token' }), fakeRes(), (e) => {
    err = e;
  });
  assert.ok(err);
  assert.equal(err.code, 'UNAUTHORIZED');
});

test('POST with no Authorization header is rejected', () => {
  let err;
  requireAuthForWrites(fakeReq('POST'), fakeRes(), (e) => {
    err = e;
  });
  assert.ok(err);
  assert.equal(err.code, 'UNAUTHORIZED');
});

test('safeCompare is constant-shape for equal-length mismatched strings', () => {
  assert.equal(__testables.safeCompare('aaaa', 'aaab'), false);
  assert.equal(__testables.safeCompare('aaaa', 'aaaa'), true);
});

test('extractBearer parses the "Bearer <token>" header shape only', () => {
  assert.equal(__testables.extractBearer({ headers: { authorization: 'Bearer abc' } }), 'abc');
  assert.equal(__testables.extractBearer({ headers: { authorization: 'Basic abc' } }), null);
  assert.equal(__testables.extractBearer({ headers: {} }), null);
});
