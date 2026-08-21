'use strict';

/**
 * 07-frame-refs-gap.test.cjs — documents a real functional gap: openapi.yaml
 * (DiscussionTargetType enum: project|feature|flow|frame|element) and
 * docs/postgres-tier.md ("discussions + threaded comments anchored to any
 * node of the design graph ... including element-level anchors") both
 * promise discussions can target a `frame` (fxdf_frm_*) or `element`
 * (a frame + a data-* testHook selector). But no LIVE route ever mints a
 * frame_ref row — repositories/frameRefRepo.ts#upsertFrameRef is called
 * ONLY from scripts/backfill.ts, never from PUT /api/v1/features/:slug/
 * frames/:file or any other request handler (grep confirms this — see PR
 * body). A client of the running API therefore has no way to discover a
 * valid `fxdf_frm_*` id and can never legitimately open a frame/element
 * discussion without an operator manually running the backfill script
 * out-of-band.
 *
 * This file proves BOTH halves precisely: (1) discussions ARE reachable
 * for frame/element targets once a frame_ref row exists (isolating the gap
 * to "nothing creates the row", not "the discussion feature is broken"),
 * and (2) that no live route creates one. (1) talks HTTP-only; (2)
 * necessarily looks past the HTTP boundary at Postgres directly, since the
 * defect IS the absence of an API-observable capability — there is no
 * endpoint to assert 404 against; the row itself never exists.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { bootServer, requireDatabase } = require('../lib/server.cjs');
const { client } = require('../lib/http.cjs');
const { withClient } = require('../lib/db.cjs');
// Reuse the SAME identity codec the backend uses (this repo's own
// @fuzex/identity, ../../../packages/identity) so the wire id this test
// constructs is byte-for-byte what the running server would itself mint.
const { fromUuid } = require(path.join(__dirname, '..', '..', '..', '..', 'packages', 'identity', 'dist', 'index.js'));

let srv;
let http;
let databaseUrl;

try {
  databaseUrl = requireDatabase();
} catch (err) {
  console.warn(`07-frame-refs-gap.test.cjs: ${err.message} — skipping.`);
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

function uniqueSlug(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

test('discussions on a `frame` target DO work once a frame_ref row exists (isolates the gap to row creation, not the feature)', async () => {
  const slug = uniqueSlug('frame-ref-feature');
  const create = await http.post('/api/v1/features', { body: { slug, description: 'fixture' } });
  assert.equal(create.status, 201);

  // Seed the missing row directly — standing in for what a (currently
  // nonexistent) live route would do on PUT .../frames/:file.
  const featureId = await withClient(databaseUrl, async (db) => {
    const { rows } = await db.query('select id from design_frames.feature where slug = $1', [slug]);
    return rows[0].id;
  });
  const frameRefUuid = crypto.randomUUID();
  await withClient(databaseUrl, (db) =>
    db.query(
      `insert into design_frames.frame_ref (id, feature_id, file, content_stamp) values ($1, $2, $3, $4)`,
      [frameRefUuid, featureId, '01-index.html', 'a'.repeat(64)]
    )
  );
  const frameRefWireId = fromUuid('frameRef', frameRefUuid);
  assert.match(frameRefWireId, /^fxdf_frm_[0-9a-hjkmnp-tv-z]+$/);

  const disc = await http.post('/api/v1/discussions', {
    body: { targetType: 'frame', targetRef: frameRefWireId, title: 'copy nit on this frame' },
  });
  assert.equal(disc.status, 201, 'the discussion feature itself works fine once the row exists');
  assert.equal(disc.body.targetType, 'frame');
  assert.equal(disc.body.targetRef, frameRefWireId);

  const elementDisc = await http.post('/api/v1/discussions', {
    body: {
      targetType: 'element',
      targetRef: frameRefWireId,
      targetSelector: '[data-testhook=reveal-token]',
    },
  });
  assert.equal(elementDisc.status, 201, 'element-level anchoring also works once the row exists');
});

test(
  'GAP: PUT .../frames/:file does NOT create a frame_ref row, so no client of the running API ' +
    'can ever discover a valid frame/element discussion target',
  async () => {
    const slug = uniqueSlug('no-frame-ref-feature');
    await http.post('/api/v1/features', { body: { slug, description: 'fixture' } });

    await http.put(`/api/v1/features/${slug}/frames/01-index.html`, {
      body: { html: '<html><body>content</body></html>' },
    });
    // Persist the stamp too — the strongest case for the row existing, since
    // frame_ref.content_stamp is meant to bind a ref to a specific stamped
    // version of the frame (db/migrations/0006_create_frame_ref.sql).
    await http.post(`/api/v1/features/${slug}/stamp`, {});

    const featureId = await withClient(databaseUrl, async (db) => {
      const { rows } = await db.query('select id from design_frames.feature where slug = $1', [slug]);
      return rows[0].id;
    });
    const frameRefCount = await withClient(databaseUrl, async (db) => {
      const { rows } = await db.query('select count(*)::int as n from design_frames.frame_ref where feature_id = $1', [
        featureId,
      ]);
      return rows[0].n;
    });

    // EXPECTED (per docs/postgres-tier.md's stated goal — discussions
    // anchored to "any node of the design graph ... including
    // element-level anchors"): writing + stamping a frame indexes at least
    // one frame_ref row, so a client could subsequently discover it (e.g.
    // via a future GET .../features/:slug/frames listing refs) and open a
    // frame/element discussion against it.
    // ACTUAL: 0 rows — frameRefRepo.upsertFrameRef is only ever called from
    // scripts/backfill.ts, never from any request handler.
    assert.ok(
      frameRefCount > 0,
      `DEFECT: PUT/POST frame+stamp created 0 frame_ref rows for feature '${slug}' — ` +
        'frame/element discussion targets are unreachable via the live API without running ' +
        'the out-of-band backfill script (see repositories/frameRefRepo.ts callers).'
    );
  }
);
