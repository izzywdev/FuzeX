'use strict';

// Revision refs are discoverable over HTTP and retain their original frame and
// component identity when a later import replaces the active content.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootServer, requireDatabase } = require('../lib/server.cjs');
const { client } = require('../lib/http.cjs');

try { requireDatabase(); } catch {
  test('frame revision acceptance requires DATABASE_URL', { skip: true }, () => {});
  return;
}

let srv;
let http;
test.before(async () => { srv = await bootServer(); http = client(srv.baseUrl, srv.token); });
test.after(async () => { await srv.close(); });

function manifest(slug, hook = 'reveal-token') {
  return { name: slug, description: 'fixture', designSystem: 'fuse-seam', entry: 'index.html',
    frames: [{ id: 'index', file: 'index.html', label: 'Primary', summary: 'Primary action', testHooks: [hook], flow: 'primary' }],
    build: { flows: [{ id: 'primary', orchestrator: 'Orchestrator.tsx', route: '/primary' }] } };
}

test('import exposes real revision frame refs and historical selectors stay bound to their original snapshot', async () => {
  const slug = `revision-annotations-${Date.now().toString(36)}`;
  const first = await http.post(`/api/v1/features/${slug}/import`, { body: {
    manifest: manifest(slug), frames: { 'index.html': '<html><body><button data-testhook="reveal-token">Reveal</button></body></html>' }, expectedStamp: null,
  } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const refs = await http.get(`/api/v1/features/${slug}/revisions/${first.body.stamp}/frame-refs`);
  assert.equal(refs.status, 200);
  assert.equal(refs.body.frames.length, 1);
  const ref = refs.body.frames[0];
  assert.match(ref.id, /^fxdf_frm_[0-9a-hjkmnp-tv-z]+$/);
  assert.equal(ref.contentStamp, first.body.stamp);
  assert.equal((await http.post('/api/v1/discussions', { body: { targetType: 'frame', targetRef: ref.id } })).status, 201);

  const second = await http.post(`/api/v1/features/${slug}/import`, { body: {
    manifest: manifest(slug, 'new-action'), frames: { 'index.html': '<html><body><button data-testhook="new-action">New</button></body></html>' }, expectedStamp: first.body.stamp,
  } });
  assert.equal(second.status, 200);
  assert.notEqual(second.body.stamp, first.body.stamp);
  const annotation = await http.post('/api/v1/discussions', { body: {
    targetType: 'element', targetRef: ref.id, targetSelector: '[data-testhook=reveal-token]',
  } });
  assert.equal(annotation.status, 201, 'historical annotation resolves against historical HTML after replacement');
  const missing = await http.post('/api/v1/discussions', { body: {
    targetType: 'element', targetRef: ref.id, targetSelector: '[data-testhook=new-action]',
  } });
  assert.equal(missing.status, 400, 'a component in the new revision is absent from the old revision');
  const historical = await http.get(`/api/v1/features/${slug}/revisions/${first.body.stamp}`);
  assert.match(historical.body.frames['index.html'], /reveal-token/);
  assert.doesNotMatch(historical.body.frames['index.html'], /new-action/);
});

test('legacy frame write and stamp expose revision references through the running API', async () => {
  const slug = `legacy-frame-refs-${Date.now().toString(36)}`;
  assert.equal((await http.post('/api/v1/features', { body: { slug } })).status, 201);
  assert.equal((await http.put(`/api/v1/features/${slug}/frames/index.html`, { body: { html: '<html><body>content</body></html>' } })).status, 200);
  const stamped = await http.post(`/api/v1/features/${slug}/stamp`, {});
  assert.equal(stamped.status, 200);
  const refs = await http.get(`/api/v1/features/${slug}/revisions/${stamped.body.stamp}/frame-refs`);
  assert.equal(refs.status, 200);
  assert.equal(refs.body.frames.length, 1);
  assert.equal(refs.body.frames[0].file, 'index.html');
});
