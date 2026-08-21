'use strict';

/**
 * 03-pagination-precision.test.cjs — deterministic reproduction of a real
 * pagination-cursor defect found by 02-projects.test.cjs's timing-based
 * cursor-walk test ("the cursor walks the whole set with no gaps or
 * dupes" — mandatory pagination verification).
 *
 * Root cause: Postgres `timestamptz` stores microsecond precision, but
 * node-postgres parses it into a JS `Date`, which only carries MILLISECOND
 * precision. `projectRepo.listProjects` (and the sibling discussion/approval
 * repos) build the pagination cursor from `row.created_at.toISOString()` —
 * already truncated to milliseconds by the time it gets there. When two rows
 * share a millisecond but differ in the sub-millisecond (microsecond) part —
 * entirely realistic under normal write throughput, not just a contrived
 * race — the truncated cursor value compares LESS than the boundary row's
 * own full-precision `created_at` still stored in Postgres. The next page's
 * `WHERE (created_at, id) > ($cursorV, $cursorId)` then evaluates true for
 * that same boundary row on `created_at` alone, and it comes back again.
 *
 * This test seeds two rows one microsecond-tier apart within the SAME
 * millisecond directly via SQL (bypassing timing luck entirely) to prove
 * the defect deterministically, independent of the flakier real-world
 * timing race 02-projects.test.cjs's walk test hits incidentally.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { bootServer, requireDatabase } = require('../lib/server.cjs');
const { client } = require('../lib/http.cjs');
const { withClient } = require('../lib/db.cjs');

let srv;
let http;
let databaseUrl;

try {
  databaseUrl = requireDatabase();
} catch (err) {
  console.warn(`03-pagination-precision.test.cjs: ${err.message} — skipping.`);
  test('skipped: no DATABASE_URL', { skip: true }, () => {});
  module.exports = undefined;
  return;
}

test.before(async () => {
  srv = await bootServer();
  http = client(srv.baseUrl, srv.token);
});

test.after(async () => {
  await srv.close();
});

test(
  'BUG: two projects sharing a millisecond (differing only in microseconds) — ' +
    'the second page must NOT re-return the first page boundary row',
  async () => {
    const idFirst = crypto.randomUUID();
    const idSecond = crypto.randomUUID();
    // Same millisecond (.100), different microseconds — this is the exact
    // shape node-postgres's millisecond-precision Date parsing collapses.
    const tsFirst = '2026-01-01 00:00:00.100100+00';
    const tsSecond = '2026-01-01 00:00:00.100900+00';

    await withClient(databaseUrl, async (db) => {
      await db.query(
        `insert into design_frames.project (id, name, created_at, updated_at) values ($1, $2, $3::timestamptz, $3::timestamptz)`,
        [idFirst, 'precision-first', tsFirst]
      );
      await db.query(
        `insert into design_frames.project (id, name, created_at, updated_at) values ($1, $2, $3::timestamptz, $3::timestamptz)`,
        [idSecond, 'precision-second', tsSecond]
      );
    });

    const page1 = await http.get('/api/v1/projects?limit=1', { auth: false });
    assert.equal(page1.status, 200);
    assert.equal(page1.body.items.length, 1);
    assert.equal(page1.body.items[0].name, 'precision-first', 'page 1 must be the earlier row');
    assert.equal(page1.body.page.hasMore, true);
    assert.ok(page1.body.page.nextCursor, 'hasMore:true must carry a cursor');

    const page2 = await http.get(
      `/api/v1/projects?limit=1&cursor=${encodeURIComponent(page1.body.page.nextCursor)}`,
      { auth: false }
    );
    assert.equal(page2.status, 200);
    assert.equal(page2.body.items.length, 1);

    // EXPECTED (per the pagination-standard cursor-walk invariant): page 2
    // is 'precision-second' — the next distinct row.
    // ACTUAL (defect): page 2 re-returns 'precision-first' — the SAME row
    // as page 1 — because the millisecond-truncated cursor value is less
    // than that row's own full-precision stored created_at.
    assert.notEqual(
      page2.body.items[0].name,
      'precision-first',
      'DEFECT: page 2 re-returned the page-1 boundary row (see backend/src/repositories/projectRepo.ts ' +
        'listProjects + backend/src/lib/pagination.ts — cursor built from a millisecond-truncated ' +
        'Date.toISOString() compared against a microsecond-precision timestamptz column)'
    );
    assert.equal(page2.body.items[0].name, 'precision-second');
  }
);
