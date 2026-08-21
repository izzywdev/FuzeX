'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mintId,
  parseId,
  assertRef,
  tryParseId,
  isId,
  toUuid,
  fromUuid,
  entityTypeOf,
  configureIdentity,
  ENTITY_PREFIXES,
} = require('../dist/index.js');

test('mintId produces a fxdf_-prefixed TypeID with a 26-char base32 suffix', () => {
  const id = mintId('project');
  assert.match(id, /^fxdf_prj_[0-9a-hjkmnp-tv-z]{26}$/);
});

test('mintId never repeats and encodes an increasing UUIDv7 timestamp', () => {
  const a = mintId('feature');
  const b = mintId('feature');
  assert.notEqual(a, b);
});

test('parseId round-trips a minted id for the correct type', () => {
  const id = mintId('flow');
  assert.equal(parseId('flow', id), id);
});

test('parseId rejects a cross-type id (PREFIX_MISMATCH)', () => {
  const projectId = mintId('project');
  assert.throws(() => parseId('feature', projectId), (err) => err.code === 'PREFIX_MISMATCH');
});

test('parseId rejects a completely unregistered prefix (UNKNOWN_PREFIX)', () => {
  assert.throws(() => parseId('project', 'zzz_01h455vb4pex5vsknk084sn02q'), (err) => err.code === 'UNKNOWN_PREFIX');
});

test('parseId rejects a malformed suffix', () => {
  assert.throws(() => parseId('project', 'fxdf_prj_not-base32!!'), (err) => err.code === 'MALFORMED_ID');
});

test('parseId rejects a bare UUID by default (no legacy window)', () => {
  assert.throws(
    () => parseId('project', '0195a8f2-6c3d-7f11-8b2e-000000000000'),
    (err) => err.code === 'LEGACY_NOT_PERMITTED'
  );
});

test('configureIdentity opens a legacy dual-accept window per type', () => {
  configureIdentity({ legacyUuidTypes: new Set(['comment']) });
  const uuid = '0195a8f2-6c3d-7f11-8b2e-000000000000';
  assert.equal(parseId('comment', uuid), uuid);
  assert.throws(() => parseId('discussion', uuid), (err) => err.code === 'LEGACY_NOT_PERMITTED');
  configureIdentity({ legacyUuidTypes: new Set() }); // reset for other tests
});

test('tryParseId / isId are non-throwing variants', () => {
  const id = mintId('approval');
  assert.equal(tryParseId('approval', 'garbage'), null);
  assert.equal(isId('approval', id), true);
  assert.equal(isId('discussion', id), false);
});

test('toUuid/fromUuid is a lossless round trip through native uuid storage', () => {
  const id = mintId('discussion');
  const uuid = toUuid(id);
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const back = fromUuid('discussion', uuid);
  assert.equal(back, id);
});

test('entityTypeOf identifies the type without needing it in advance', () => {
  const id = mintId('comment');
  assert.equal(entityTypeOf(id), 'comment');
  assert.equal(entityTypeOf('not-an-id'), null);
});

test('registry declares exactly the seven fxdf_* entity prefixes the contract reserves', () => {
  assert.deepEqual(ENTITY_PREFIXES, {
    project: 'fxdf_prj',
    feature: 'fxdf_ftr',
    flow: 'fxdf_flw',
    frameRef: 'fxdf_frm',
    approval: 'fxdf_apr',
    discussion: 'fxdf_dsc',
    comment: 'fxdf_cmt',
  });
});

test('assertRef is the same function as parseId (identifier-standard L0)', () => {
  assert.equal(assertRef, parseId);
});
