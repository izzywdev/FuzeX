'use strict';

/**
 * 08-identifiers.test.cjs — the mandatory identifier-verification checks
 * (governance/identifier-standard.md) as a single consolidated file, in
 * addition to the type-specific checks already embedded in
 * 02-projects/04-features/06-discussions.test.cjs. Covers:
 *   - a body carrying an `id` is rejected for EVERY create surface;
 *   - an id minted for one entity type is rejected where another is
 *     expected (cross-type confusion), across every path parameter that
 *     accepts a typed id;
 *   - a polymorphic reference without its type discriminator is rejected;
 *   - "knowing an id grants nothing" — SCOPE NOTE below.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootServer, requireDatabase } = require('../lib/server.cjs');
const { client } = require('../lib/http.cjs');

let srv;
let http;

try {
  requireDatabase();
} catch (err) {
  console.warn(`08-identifiers.test.cjs: ${err.message} — skipping.`);
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

async function seedIdOfEachType() {
  const project = await http.post('/api/v1/projects', { body: { name: `id-fixture-${Date.now()}` } });
  const discussion = await http.post('/api/v1/discussions', {
    body: { targetType: 'project', targetRef: project.body.id },
  });
  const comment = await http.post(`/api/v1/discussions/${discussion.body.id}/comments`, { body: { body: 'x' } });
  return {
    project: project.body.id, // fxdf_prj_*
    discussion: discussion.body.id, // fxdf_dsc_*
    comment: comment.body.id, // fxdf_cmt_*
  };
}

// ---- Every create body: a client-supplied `id` is rejected ----------------

test('every create surface rejects a client-supplied `id`: ProjectCreate, DiscussionCreate, CommentCreate', async () => {
  const ids = await seedIdOfEachType();

  const projectAttempt = await http.post('/api/v1/projects', {
    body: { name: 'x', id: 'fxdf_prj_01h455vb4pex5vsknk084sn02q' },
  });
  assert.ok([400, 422].includes(projectAttempt.status), `ProjectCreate: got ${projectAttempt.status}`);

  const discussionAttempt = await http.post('/api/v1/discussions', {
    body: { targetType: 'project', targetRef: ids.project, id: 'fxdf_dsc_01h455vb4pex5vsknk084sn02q' },
  });
  assert.ok([400, 422].includes(discussionAttempt.status), `DiscussionCreate: got ${discussionAttempt.status}`);

  const commentAttempt = await http.post(`/api/v1/discussions/${ids.discussion}/comments`, {
    body: { body: 'x', id: 'fxdf_cmt_01h455vb4pex5vsknk084sn02q' },
  });
  assert.ok([400, 422].includes(commentAttempt.status), `CommentCreate: got ${commentAttempt.status}`);
});

// ---- Cross-type confusion at every typed path parameter --------------------

test('every typed path parameter rejects an id minted for a DIFFERENT entity type', async () => {
  const ids = await seedIdOfEachType();

  // /api/v1/projects/:id expects a project id — give it a discussion id.
  const projectPath = await http.get(`/api/v1/projects/${ids.discussion}`, { auth: false });
  assert.ok([400, 404].includes(projectPath.status), `GET /projects/:id with a discussion id: ${projectPath.status}`);

  // /api/v1/discussions/:id expects a discussion id — give it a project id.
  const discussionPath = await http.get(`/api/v1/discussions/${ids.project}`, { auth: false });
  assert.ok(
    [400, 404].includes(discussionPath.status),
    `GET /discussions/:id with a project id: ${discussionPath.status}`
  );

  // parentCommentId on CommentCreate expects a comment id — give it a project id.
  const parentCommentAttempt = await http.post(`/api/v1/discussions/${ids.discussion}/comments`, {
    body: { body: 'reply', parentCommentId: ids.project },
  });
  assert.equal(parentCommentAttempt.status, 400, `parentCommentId with a project id: ${parentCommentAttempt.status}`);

  // projectId on feature-create expects a project id — give it a comment id.
  const featureAttempt = await http.post('/api/v1/features', {
    body: { slug: `xtype-${Date.now()}`, description: 'x', projectId: ids.comment },
  });
  assert.equal(featureAttempt.status, 400, `feature projectId with a comment id: ${featureAttempt.status}`);
});

// ---- Polymorphic reference without its type discriminator ------------------

test('a polymorphic reference is ALWAYS rejected without its type discriminator (no bare-id lookup)', async () => {
  const ids = await seedIdOfEachType();

  // GET /api/v1/discussions requires targetType alongside targetRef.
  const bareRef = await http.get(`/api/v1/discussions?targetRef=${ids.project}`, { auth: false });
  assert.equal(bareRef.status, 400);

  // POST /api/v1/discussions requires targetType alongside targetRef too.
  const createBareRef = await http.post('/api/v1/discussions', { body: { targetRef: ids.project } });
  assert.equal(createBareRef.status, 400);

  // There is no route that accepts JUST an id and resolves its type by
  // guessing from the prefix — confirm no such implicit lookup exists for
  // a plausible alternate path shape either.
  const guessedLookup = await http.get(`/api/v1/entities/${ids.project}`, { auth: false });
  assert.equal(guessedLookup.status, 404); // route doesn't exist at all — not a hidden bare-id resolver
});

// ---- "An id is never a capability" ------------------------------------------

test(
  'an id is never a capability: a well-formed but never-created id resolves to 404 everywhere, ' +
    'never to fabricated data',
  async () => {
    const neverCreated = {
      project: 'fxdf_prj_01h455vb4pex5vsknk084sn02q',
      discussion: 'fxdf_dsc_01h455vb4pex5vsknk084sn02q',
    };
    const p = await http.get(`/api/v1/projects/${neverCreated.project}`, { auth: false });
    assert.equal(p.status, 404);
    const d = await http.get(`/api/v1/discussions/${neverCreated.discussion}`, { auth: false });
    assert.equal(d.status, 404);
  }
);

/**
 * SCOPE NOTE (honest gap, not silently skipped): the identifier standard's
 * strongest check — "a caller authorized for entity A presenting a valid id
 * for entity B is denied" — presupposes a per-entity authorization model
 * (e.g. Permit-style ACLs distinguishing which CALLER may act on which
 * entity). This service has NO such model: writes are gated by a single
 * shared bearer secret (see middleware/auth.ts) with no per-caller identity
 * or per-entity ownership at all, and reads are public by design. There is
 * therefore no "caller A vs caller B" distinction this suite can exercise —
 * every bearer-holding caller is equivalent, and every read is public to
 * everyone. This is NOT weakened coverage of the mandate; it is the
 * documented reason that specific sub-check does not apply to this service's
 * current authz model. What we CAN and DO verify (above) is the part that
 * IS testable here: an id alone never resolves a lookup, never substitutes
 * for its type, and never being GRANTED (client-chosen) in the first place.
 */
