'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectManifest } = require('../dist/lib/projection.js');

test('projectManifest overlays the latest approval onto a matching flow', () => {
  const manifest = {
    build: {
      flows: [{ id: 'primary', orchestrator: 'o', route: '/primary', approved: false, approvedBy: null, approvedAt: null }],
    },
  };
  const latest = new Map([['primary', { decision: 'approve', actorRef: 'alice', decidedAt: '2026-01-01T00:00:00.000Z' }]]);
  const out = projectManifest(manifest, latest);
  assert.deepEqual(out.build.flows[0], {
    id: 'primary',
    orchestrator: 'o',
    route: '/primary',
    approved: true,
    approvedBy: 'alice',
    approvedAt: '2026-01-01T00:00:00.000Z',
  });
});

test('projectManifest reflects a reject decision as approved=false with the actor recorded', () => {
  const manifest = { build: { flows: [{ id: 'primary', approved: true, approvedBy: 'stale', approvedAt: 'stale' }] } };
  const latest = new Map([['primary', { decision: 'reject', actorRef: 'bob', decidedAt: '2026-02-02T00:00:00.000Z' }]]);
  const out = projectManifest(manifest, latest);
  assert.equal(out.build.flows[0].approved, false);
  assert.equal(out.build.flows[0].approvedBy, 'bob');
  assert.equal(out.build.flows[0].approvedAt, '2026-02-02T00:00:00.000Z');
});

test('projectManifest falls back to the flat file bookkeeping when no Postgres row exists yet (pre-backfill safety)', () => {
  const manifest = {
    build: { flows: [{ id: 'primary', approved: true, approvedBy: 'legacy-file-value', approvedAt: 'legacy-ts' }] },
  };
  const out = projectManifest(manifest, new Map()); // no rows indexed yet
  assert.deepEqual(out.build.flows[0], {
    id: 'primary',
    approved: true,
    approvedBy: 'legacy-file-value',
    approvedAt: 'legacy-ts',
  });
});

test('projectManifest is a no-op when the manifest declares no flows', () => {
  const manifest = { build: {} };
  assert.deepEqual(projectManifest(manifest, new Map()), manifest);
});

test('projectManifest tolerates a manifest with no build block at all', () => {
  const manifest = { name: 'x' };
  assert.deepEqual(projectManifest(manifest, new Map()), manifest);
});

test('projectManifest only overlays the flow the approval belongs to, leaving siblings untouched', () => {
  const manifest = {
    build: {
      flows: [
        { id: 'primary', approved: false, approvedBy: null, approvedAt: null },
        { id: 'secondary', approved: false, approvedBy: null, approvedAt: null },
      ],
    },
  };
  const latest = new Map([['primary', { decision: 'approve', actorRef: 'alice', decidedAt: 't' }]]);
  const out = projectManifest(manifest, latest);
  assert.equal(out.build.flows[0].approved, true);
  assert.equal(out.build.flows[1].approved, false);
});
