'use strict';

const assert = require('node:assert');
const { validateManifest } = require('../lib/schema');

function run() {
  const valid = {
    name: 'Billing invoices',
    description: 'Invoice history and download flow',
    designSystem: 'fuse-seam (@fuzefront/design-system)',
    entry: 'index.html',
    frames: [
      {
        id: '01-invoice-history',
        file: '01-invoice-history.html',
        label: '(a) Invoice history',
        summary: 'Lists invoices',
        testHooks: ["[data-frame='invoice-history']"],
        flow: 'billing',
      },
    ],
    build: {
      flows: [{ id: 'billing', orchestrator: 'BillingFlow', route: '/billing', approved: false }],
    },
  };
  assert.deepStrictEqual(validateManifest(valid), [], 'a well-formed manifest validates clean');

  assert.ok(validateManifest({}).length > 0, 'empty object is rejected');
  assert.ok(
    validateManifest({ ...valid, entry: 'index' }).some((e) => e.startsWith('entry:')),
    'entry must end in .html'
  );
  assert.ok(
    validateManifest({ ...valid, frames: [{ id: 'x' }] }).length > 0,
    'a frame missing required fields is rejected'
  );
  assert.ok(
    validateManifest({ ...valid, contract: { featureFlag: 'not-a-valid-flag' } }).some((e) => e.startsWith('contract.featureFlag')),
    'featureFlag must match <repo>.<domain>.<flag>'
  );
  assert.ok(
    validateManifest({ ...valid, frames: [{ ...valid.frames[0], flow: 'unknown-flow' }] }).some((e) => e.includes('unknown build.flows')),
    'a frame referencing an unknown flow id is rejected'
  );

  console.log('schema.test.cjs: all assertions passed');
}

run();
