'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function run() {
  // Point the store at a throwaway temp dir before requiring it — DATA_DIR is
  // resolved at require-time from the env var.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-frames-store-test-'));
  process.env.DESIGN_FRAMES_DATA_DIR = tmp;
  delete require.cache[require.resolve('../lib/store')];
  const store = require('../lib/store');

  const manifest = {
    name: 'Test feature',
    description: 'desc',
    designSystem: 'ds',
    entry: 'index.html',
    frames: [],
    build: { flows: [{ id: 'main', orchestrator: 'MainFlow', route: '/x', approved: false, approvedBy: null, approvedAt: null }] },
  };

  await store.createFeature('test-feature', manifest);
  assert.ok(await store.featureExists('test-feature'), 'feature exists after create');

  await assert.rejects(
    () => store.createFeature('test-feature', manifest),
    (err) => err.code === 'CONFLICT',
    'creating the same slug twice conflicts'
  );

  await store.putFrame('test-feature', '01-a.html', '<p>hello</p>');
  const feature = await store.getFeature('test-feature');
  assert.strictEqual(feature.frames.get('01-a.html'), '<p>hello</p>', 'frame content round-trips');

  const flow = await store.setFlowApproval('test-feature', 'main', { approved: true, approvedBy: 'alice', approvedAt: '2026-01-01' });
  assert.strictEqual(flow.approved, true, 'approval persists');

  await assert.rejects(
    () => store.setFlowApproval('test-feature', 'nope', { approved: true }),
    (err) => err.code === 'NOT_FOUND',
    'approving an unknown flow 404s'
  );

  await store.deleteFrame('test-feature', '01-a.html');
  await assert.rejects(
    () => store.getFrame('test-feature', '01-a.html'),
    (err) => err.code === 'NOT_FOUND',
    'deleted frame is gone'
  );

  const list = await store.listFeatures();
  assert.ok(list.some((f) => f.slug === 'test-feature'), 'listFeatures includes the created feature');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('store.test.cjs: all assertions passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
