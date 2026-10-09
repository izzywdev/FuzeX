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
  const { computeStamp } = require('../lib/stamp');
  const beforeRevision = await store.getFeature('test-feature');
  const revisionStamp = computeStamp(beforeRevision);
  await store.setStamp('test-feature', revisionStamp);
  await store.putFrame('test-feature', '01-a.html', '<p>new content</p>');
  const revisions = await store.listRevisions('test-feature');
  assert.strictEqual(revisions.length, 1, 'committing a stamp creates one immutable revision');
  const revision = await store.getRevision('test-feature', revisionStamp);
  assert.strictEqual(revision.frames.get('01-a.html'), '<p>hello</p>', 'revision retains the reviewed frame bytes');
  const feature = await store.getFeature('test-feature');
  assert.strictEqual(feature.frames.get('01-a.html'), '<p>new content</p>', 'current frame content can advance after a revision');

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

  const imported = { ...manifest, sourceRepo: 'FuzeFront', sourceStamp: 'c'.repeat(64), importerVersion: 'test' };
  const first = await store.importFeature('imported-feature', imported, new Map([
    ['index.html', '<p>first</p>'], ['removed.html', '<p>removed later</p>'],
  ]), null);
  assert.strictEqual(computeStamp(first), first.stamp, 'revision hashes its exact stored bytes');
  assert.strictEqual(first.metadata.sourceStamp, imported.sourceStamp, 'source provenance is retained');
  const unchanged = await store.importFeature('imported-feature', imported, new Map([
    ['index.html', '<p>first</p>'], ['removed.html', '<p>removed later</p>'],
  ]), first.stamp);
  assert.strictEqual(unchanged.stamp, first.stamp, 'an unchanged re-import resolves to the same content-addressed revision');
  assert.strictEqual((await store.listRevisions('imported-feature')).length, 1, 'an unchanged re-import does not duplicate an immutable revision');
  const second = await store.importFeature('imported-feature', imported, new Map([['index.html', '<p>second</p>']]), first.stamp);
  assert.strictEqual((await store.getFeature('imported-feature')).frames.has('removed.html'), false, 'full imports remove stale frames');
  assert.strictEqual((await store.getRevision('imported-feature', first.stamp)).frames.get('removed.html'), '<p>removed later</p>', 'removed frames remain historical');
  await assert.rejects(() => store.setStamp('imported-feature', first.stamp), (err) => err.code === 'STAMP_CONFLICT', 'stamping cannot snapshot changed bytes under an old digest');
  await assert.rejects(() => store.importFeature('imported-feature', imported, new Map([['index.html', 'stale']]), first.stamp), (err) => err.code === 'STAMP_CONFLICT', 'stale concurrent import cannot overwrite new content');
  const race = await Promise.allSettled([
    store.importFeature('imported-feature', imported, new Map([['index.html', '<p>writer A</p>']]), second.stamp),
    store.importFeature('imported-feature', imported, new Map([['index.html', '<p>writer B</p>']]), second.stamp),
  ]);
  assert.strictEqual(race.filter((result) => result.status === 'fulfilled').length, 1, 'only one same-base writer publishes');
  assert.strictEqual(race.filter((result) => result.status === 'rejected' && result.reason.code === 'STAMP_CONFLICT').length, 1, 'other same-base writer receives conflict');
  const current = await store.commitRevision('imported-feature');
  assert.strictEqual(computeStamp(current), current.stamp, 'atomic stamp commit agrees with immutable content');
  for (const file of ['../manifest.html', '..\\escape.html', '/outside.html']) {
    await assert.rejects(() => store.getFrame('imported-feature', file), (err) => err.code === 'VALIDATION', 'all frame read paths enforce feature boundaries');
    await assert.rejects(() => store.deleteFrame('imported-feature', file), (err) => err.code === 'VALIDATION', 'all frame deletion paths enforce feature boundaries');
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('store.test.cjs: all assertions passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
