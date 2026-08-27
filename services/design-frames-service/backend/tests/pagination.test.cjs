'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parsePageParams,
  encodeCursor,
  decodeCursor,
  buildPage,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} = require('../dist/lib/pagination.js');

test('parsePageParams defaults limit to 50 when absent', () => {
  const { limit, cursor } = parsePageParams({});
  assert.equal(limit, DEFAULT_LIMIT);
  assert.equal(cursor, null);
});

test('parsePageParams clamps an over-max limit to 200 rather than rejecting it', () => {
  const { limit } = parsePageParams({ limit: '99999' });
  assert.equal(limit, MAX_LIMIT);
});

test('parsePageParams falls back to the default for limit=0 or negative', () => {
  assert.equal(parsePageParams({ limit: '0' }).limit, DEFAULT_LIMIT);
  assert.equal(parsePageParams({ limit: '-5' }).limit, DEFAULT_LIMIT);
});

test('parsePageParams falls back to the default for a non-numeric limit', () => {
  assert.equal(parsePageParams({ limit: 'not-a-number' }).limit, DEFAULT_LIMIT);
});

test('parsePageParams accepts an in-range limit unchanged', () => {
  assert.equal(parsePageParams({ limit: '17' }).limit, 17);
});

test('parsePageParams reads a string cursor through', () => {
  assert.equal(parsePageParams({ cursor: 'abc123' }).cursor, 'abc123');
});

test('cursor round-trips losslessly through encode/decode', () => {
  const payload = { v: '2026-01-01T00:00:00.000Z', id: 'fxdf_apr_01h455vb4pex5vsknk084sn02q' };
  const cursor = encodeCursor(payload);
  assert.deepEqual(decodeCursor(cursor), payload);
});

test('decodeCursor rejects a garbage cursor', () => {
  assert.throws(() => decodeCursor('not-valid-base64url-json'), (err) => err.code === 'VALIDATION');
});

test('decodeCursor rejects a well-formed-base64 payload missing required fields', () => {
  const bogus = Buffer.from(JSON.stringify({ v: 'x' }), 'utf8').toString('base64url');
  assert.throws(() => decodeCursor(bogus), (err) => err.code === 'VALIDATION');
});

test('buildPage: hasMore is false and nextCursor is null when rows.length <= limit', () => {
  const rows = [{ id: 'a', createdAt: '1' }, { id: 'b', createdAt: '2' }];
  const page = buildPage(rows, 5, (r) => r, (r) => ({ v: r.createdAt, id: r.id }));
  assert.equal(page.items.length, 2);
  assert.equal(page.page.hasMore, false);
  assert.equal(page.page.nextCursor, null);
});

test('buildPage: fetching limit+1 rows signals hasMore and trims to limit items', () => {
  const rows = [
    { id: 'a', createdAt: '1' },
    { id: 'b', createdAt: '2' },
    { id: 'c', createdAt: '3' }, // the "+1" lookahead row
  ];
  const page = buildPage(rows, 2, (r) => r, (r) => ({ v: r.createdAt, id: r.id }));
  assert.equal(page.items.length, 2);
  assert.deepEqual(page.items.map((i) => i.id), ['a', 'b']);
  assert.equal(page.page.hasMore, true);
  assert.notEqual(page.page.nextCursor, null);
  assert.deepEqual(decodeCursor(page.page.nextCursor), { v: '2', id: 'b' });
});

test('buildPage walking a full known set page by page produces no gaps or dupes', () => {
  const all = Array.from({ length: 7 }, (_, i) => ({ id: `id-${i}`, createdAt: String(i).padStart(3, '0') }));
  const limit = 3;
  const seen = [];
  let offset = 0;
  for (let guard = 0; guard < 10; guard++) {
    const slice = all.slice(offset, offset + limit + 1);
    const page = buildPage(slice, limit, (r) => r, (r) => ({ v: r.createdAt, id: r.id }));
    seen.push(...page.items.map((i) => i.id));
    if (!page.page.hasMore) break;
    offset += limit;
  }
  assert.deepEqual(seen, all.map((r) => r.id));
});
