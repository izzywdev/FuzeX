'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.FUZEFRONT_API_URL = 'https://fuzefront.test';
process.env.FUZEFRONT_AUTHZ_TIMEOUT_MS = '1000';

const observed = [];
let mode = 'allow';
globalThis.fetch = async (url, init) => {
  observed.push({ url, init });
  if (mode === 'down') throw new Error('unreachable');
  if (mode === 'not-json') return { status: 200, json: async () => { throw new Error('bad json'); } };
  if (mode === 'error') return { status: 503, json: async () => ({}) };
  return { status: 200, json: async () => ({ allow: mode === 'allow' }) };
};

const { checkFuzeFrontAuthorization } = require('../dist/lib/fuzefrontAuthz.js');
const { __testables } = require('../dist/middleware/auth.js');
const check = () => checkFuzeFrontAuthorization({
  bearerToken: 'workload', subject: 'user-a', tenant: 'tenant-a',
  resource: { type: 'fuzex.DesignWorkspace', key: 'project:abc' }, action: 'manage',
});

test('FuzeX asks the FuzeFront Security decision contract with the workload bearer', async () => {
  mode = 'allow'; observed.length = 0;
  assert.equal(await check(), true);
  assert.equal(observed[0].url, 'https://fuzefront.test/api/v1/security/authz/check');
  assert.equal(observed[0].init.headers.authorization, 'Bearer workload');
  assert.deepEqual(JSON.parse(observed[0].init.body), {
    subject: 'user-a', tenant: 'tenant-a', resource: { type: 'fuzex.DesignWorkspace', key: 'project:abc' }, action: 'manage',
  });
});

for (const state of ['deny', 'error', 'not-json', 'down']) {
  test(`FuzeFront authz ${state} fails closed`, async () => {
    mode = state;
    assert.equal(await check(), false);
  });
}

test('native operations have explicit stable Security decisions', () => {
  assert.deepEqual(__testables.nativeDecision({ method: 'GET', path: '/api/v1/projects/fxdf_prj_a/workspace' }), {
    resource: { type: 'fuzex.DesignWorkspace', key: 'project:fxdf_prj_a' }, action: 'read',
  });
  assert.equal(__testables.nativeDecision({ method: 'POST', path: '/api/v1/discussions/fxdf_dsc_a/comments' }).action, 'comment');
  assert.equal(__testables.nativeDecision({ method: 'POST', path: '/api/v1/features/a/generations' }).action, 'generate');
});
