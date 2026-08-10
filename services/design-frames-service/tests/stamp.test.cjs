'use strict';

const assert = require('node:assert');
const { computeStamp } = require('../lib/stamp');

function run() {
  const manifest = { name: 'x', description: 'y', designSystem: 'ds', entry: 'index.html', frames: [] };
  const frames = new Map([['01-a.html', '<p>a</p>']]);

  const s1 = computeStamp({ manifest, frames });
  assert.match(s1, /^[0-9a-f]{64}$/, 'stamp is a bare sha256 hex digest');

  // Stamp is stable across manifest key reordering.
  const reordered = { entry: 'index.html', name: 'x', frames: [], designSystem: 'ds', description: 'y' };
  const s2 = computeStamp({ manifest: reordered, frames });
  assert.strictEqual(s1, s2, 'stamp is independent of manifest key order');

  // Stamp is independent of the manifest's own `stamp` field.
  const withStamp = { ...manifest, stamp: 'deadbeef'.repeat(8) };
  const s3 = computeStamp({ manifest: withStamp, frames });
  assert.strictEqual(s1, s3, 'stamp excludes its own `stamp` field');

  // Stamp changes when frame content changes.
  const framesChanged = new Map([['01-a.html', '<p>b</p>']]);
  const s4 = computeStamp({ manifest, frames: framesChanged });
  assert.notStrictEqual(s1, s4, 'stamp changes when frame content changes');

  // Stamp is independent of flow approval bookkeeping.
  const manifestApproved = { ...manifest, build: { flows: [{ id: 'f1', orchestrator: 'X', route: '/x', approved: false, approvedBy: null, approvedAt: null }] } };
  const manifestApprovedTrue = { ...manifest, build: { flows: [{ id: 'f1', orchestrator: 'X', route: '/x', approved: true, approvedBy: 'alice', approvedAt: '2026-01-01' }] } };
  const s5 = computeStamp({ manifest: manifestApproved, frames });
  const s6 = computeStamp({ manifest: manifestApprovedTrue, frames });
  assert.strictEqual(s5, s6, 'approving a flow does not change the stamp');

  console.log('stamp.test.cjs: all assertions passed');
}

run();
