'use strict';

/**
 * 05-approvals.test.cjs — the append-only approve/reject decision log
 * (docs/postgres-tier.md "Append-only approval log + stamp-binding
 * invariant") and GET .../approvals (paginated, newest-first).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { bootServer, requireDatabase } = require('../lib/server.cjs');
const { client } = require('../lib/http.cjs');
const { assertMatchesSchema, assertMatchesPageEnvelope } = require('../lib/openapiSchemas.cjs');

let srv;
let http;

try {
  requireDatabase();
} catch (err) {
  console.warn(`05-approvals.test.cjs: ${err.message} — skipping.`);
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

async function createFeatureWithFlow(flowId = 'primary') {
  const slug = uniqueSlug('approval-feature');
  await http.post('/api/v1/features', { body: { slug, description: 'fixture' } });
  return { slug, flowId };
}

test('GET .../approvals on a flow nobody ever decided is 200 with an EMPTY history, not 404', async () => {
  const { slug, flowId } = await createFeatureWithFlow();
  const { status, body } = await http.get(`/api/v1/features/${slug}/flows/${flowId}/approvals`, { auth: false });
  assert.equal(status, 200);
  assert.deepEqual(body.items, []);
  assert.equal(body.page.hasMore, false);
  assert.equal(body.page.nextCursor, null);
});

test('POST .../approve mints an fxdf_apr_* id and matches the Approval schema', async () => {
  const { slug, flowId } = await createFeatureWithFlow();
  const { status, body } = await http.post(`/api/v1/features/${slug}/flows/${flowId}/approve`, {
    body: { approvedBy: 'reviewer@example.com' },
  });
  assert.equal(status, 200);
  assert.match(body.id, /^fxdf_apr_[0-9a-hjkmnp-tv-z]+$/);
  assert.equal(body.decision, 'approve');
  assert.equal(body.actorRef, 'reviewer@example.com');
  assert.equal(body.actorType, 'user');
  assert.equal(body.reason, null);
  assertMatchesSchema('Approval', body);
});

test('legacy {approvedBy}-only callers still succeed (backward-compat) with a null contentStamp', async () => {
  const { slug, flowId } = await createFeatureWithFlow();
  const { status, body } = await http.post(`/api/v1/features/${slug}/flows/${flowId}/approve`, {
    body: { approvedBy: 'legacy-caller@example.com' },
  });
  assert.equal(status, 200);
  assert.equal(body.contentStamp, null);
});

test('POST .../approve without approvedBy is 400', async () => {
  const { slug, flowId } = await createFeatureWithFlow();
  const { status } = await http.post(`/api/v1/features/${slug}/flows/${flowId}/approve`, { body: {} });
  assert.equal(status, 400);
});

test('POST .../reject REQUIRES `reason` (v0.2.0 tightening) — 400 without it', async () => {
  const { slug, flowId } = await createFeatureWithFlow();
  const { status } = await http.post(`/api/v1/features/${slug}/flows/${flowId}/reject`, {
    body: { rejectedBy: 'reviewer@example.com' },
  });
  assert.equal(status, 400);
});

test('POST .../reject with an empty-string reason is 400 (not just "reason present")', async () => {
  const { slug, flowId } = await createFeatureWithFlow();
  const { status } = await http.post(`/api/v1/features/${slug}/flows/${flowId}/reject`, {
    body: { reason: '   ' },
  });
  assert.equal(status, 400);
});

test('POST .../reject with a reason succeeds and the row carries it', async () => {
  const { slug, flowId } = await createFeatureWithFlow();
  const { status, body } = await http.post(`/api/v1/features/${slug}/flows/${flowId}/reject`, {
    body: { reason: 'Needs another pass on empty states', rejectedBy: 'reviewer@example.com' },
  });
  assert.equal(status, 200);
  assert.equal(body.decision, 'reject');
  assert.equal(body.reason, 'Needs another pass on empty states');
  assertMatchesSchema('Approval', body);
});

// ---- Append-only: approve -> reject -> approve appends 3 rows -------------

test('approve -> reject -> approve on the same flow APPENDS 3 rows (never overwrites) — GET history returns all 3, newest first', async () => {
  const { slug, flowId } = await createFeatureWithFlow();

  const a1 = await http.post(`/api/v1/features/${slug}/flows/${flowId}/approve`, {
    body: { approvedBy: 'alice@example.com' },
  });
  assert.equal(a1.status, 200);

  const r1 = await http.post(`/api/v1/features/${slug}/flows/${flowId}/reject`, {
    body: { reason: 'found a problem', rejectedBy: 'bob@example.com' },
  });
  assert.equal(r1.status, 200);

  const a2 = await http.post(`/api/v1/features/${slug}/flows/${flowId}/approve`, {
    body: { approvedBy: 'carol@example.com' },
  });
  assert.equal(a2.status, 200);

  const history = await http.get(`/api/v1/features/${slug}/flows/${flowId}/approvals`, { auth: false });
  assert.equal(history.status, 200);
  assertMatchesPageEnvelope('Approval', history.body);
  assert.equal(history.body.items.length, 3, 'a change of mind must APPEND, never overwrite/delete prior rows');

  const ids = history.body.items.map((i) => i.id);
  assert.equal(new Set(ids).size, 3, 'all three rows must have distinct ids');

  // newest-first: carol's second approve, then bob's reject, then alice's first approve
  assert.equal(history.body.items[0].actorRef, 'carol@example.com');
  assert.equal(history.body.items[0].decision, 'approve');
  assert.equal(history.body.items[1].actorRef, 'bob@example.com');
  assert.equal(history.body.items[1].decision, 'reject');
  assert.equal(history.body.items[2].actorRef, 'alice@example.com');
  assert.equal(history.body.items[2].decision, 'approve');
});

test("manifest.build.flows[].approved* projects the LATEST approval row, not the first", async () => {
  const slug = uniqueSlug('projection-feature');
  await http.post('/api/v1/features', { body: { slug, description: 'fixture' } });
  await http.put(`/api/v1/features/${slug}/manifest`, {
    body: {
      name: slug,
      description: 'fixture',
      designSystem: 'fuse-seam',
      entry: 'index.html',
      frames: [],
      build: { flows: [{ id: 'primary', orchestrator: 'Orchestrator.tsx', route: '/primary' }] },
    },
  });

  await http.post(`/api/v1/features/${slug}/flows/primary/approve`, { body: { approvedBy: 'alice@example.com' } });
  await http.post(`/api/v1/features/${slug}/flows/primary/reject`, {
    body: { reason: 'nope', rejectedBy: 'bob@example.com' },
  });

  const { status, body } = await http.get(`/api/v1/features/${slug}`, { auth: false });
  assert.equal(status, 200);
  const flow = body.manifest.build.flows.find((f) => f.id === 'primary');
  assert.ok(flow, 'flow must be present in the projected manifest');
  assert.equal(flow.approved, false, 'must reflect the LATEST (reject) decision, not the first approve');
  assert.equal(flow.approvedBy, 'bob@example.com');
});

// ---- Stamp-binding: contentStamp mismatch -> 409 --------------------------

test('POST .../approve with a contentStamp that matches the current stamp succeeds', async () => {
  const slug = uniqueSlug('stamp-match-feature');
  await http.post('/api/v1/features', { body: { slug, description: 'fixture' } });
  const stampResp = await http.get(`/api/v1/features/${slug}/stamp`, { auth: false });
  const { status, body } = await http.post(`/api/v1/features/${slug}/flows/primary/approve`, {
    body: { approvedBy: 'reviewer@example.com', contentStamp: stampResp.body.stamp },
  });
  assert.equal(status, 200);
  assert.equal(body.contentStamp, stampResp.body.stamp);
});

test('POST .../approve with a STALE contentStamp (frames changed underneath the reviewer) is 409 StampConflict', async () => {
  const slug = uniqueSlug('stamp-mismatch-feature');
  await http.post('/api/v1/features', { body: { slug, description: 'fixture' } });
  const staleStamp = (await http.get(`/api/v1/features/${slug}/stamp`, { auth: false })).body.stamp;

  // Content changes underneath the reviewer.
  await http.put(`/api/v1/features/${slug}/frames/01-index.html`, { body: { html: '<html>v2</html>' } });

  const { status, body } = await http.post(`/api/v1/features/${slug}/flows/primary/approve`, {
    body: { approvedBy: 'reviewer@example.com', contentStamp: staleStamp },
  });
  assert.equal(status, 409);
  assert.equal(body.expectedStamp && body.expectedStamp.length, 64);
  assert.equal(body.suppliedStamp, staleStamp);
});

test('POST .../reject with a STALE contentStamp is also 409 StampConflict', async () => {
  const slug = uniqueSlug('stamp-mismatch-reject');
  await http.post('/api/v1/features', { body: { slug, description: 'fixture' } });
  const staleStamp = (await http.get(`/api/v1/features/${slug}/stamp`, { auth: false })).body.stamp;
  await http.put(`/api/v1/features/${slug}/frames/01-index.html`, { body: { html: '<html>changed</html>' } });

  const { status } = await http.post(`/api/v1/features/${slug}/flows/primary/reject`, {
    body: { reason: 'stale review', contentStamp: staleStamp },
  });
  assert.equal(status, 409);
});

// ---- BUG: approve/reject bodies accept unknown properties -----------------

test(
  'BUG: POST .../approve REJECTS an unexpected body property — openapi.yaml\'s approve requestBody ' +
    'has additionalProperties:false',
  async () => {
    const { slug, flowId } = await createFeatureWithFlow();
    const { status, body } = await http.post(`/api/v1/features/${slug}/flows/${flowId}/approve`, {
      body: { approvedBy: 'reviewer@example.com', notInSchema: 'sneaked in' },
    });
    // EXPECTED per openapi.yaml (additionalProperties:false on the approve
    // body): 400. ACTUAL: routes/features.ts's approve handler only reads
    // the fields it cares about off `body` and never rejects extras.
    assert.equal(
      status,
      400,
      `DEFECT: expected 400 (additionalProperties:false), got ${status}: ${JSON.stringify(body)}`
    );
  }
);

test(
  'BUG: POST .../reject REJECTS an unexpected body property — openapi.yaml\'s reject requestBody ' +
    'has additionalProperties:false',
  async () => {
    const { slug, flowId } = await createFeatureWithFlow();
    const { status, body } = await http.post(`/api/v1/features/${slug}/flows/${flowId}/reject`, {
      body: { reason: 'because', notInSchema: 'sneaked in' },
    });
    assert.equal(
      status,
      400,
      `DEFECT: expected 400 (additionalProperties:false), got ${status}: ${JSON.stringify(body)}`
    );
  }
);

// ---- Pagination (mandatory) on the approvals history -----------------------

test('GET .../approvals: limit is clamped, never exceeding the requested/declared max', async () => {
  const { slug, flowId } = await createFeatureWithFlow();
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await http.post(`/api/v1/features/${slug}/flows/${flowId}/approve`, { body: { approvedBy: `actor-${i}` } });
  }
  const { status, body } = await http.get(`/api/v1/features/${slug}/flows/${flowId}/approvals?limit=2`, {
    auth: false,
  });
  assert.equal(status, 200);
  assert.equal(body.items.length, 2);
  assert.equal(body.page.hasMore, true);
});

test('GET .../approvals: the cursor walks the WHOLE history with no gaps/dupes, terminating with hasMore:false', async () => {
  const { slug, flowId } = await createFeatureWithFlow();
  const actors = Array.from({ length: 17 }, (_, i) => `walker-${i}@example.com`);
  for (const actor of actors) {
    // eslint-disable-next-line no-await-in-loop
    await http.post(`/api/v1/features/${slug}/flows/${flowId}/approve`, { body: { approvedBy: actor } });
  }

  const seen = new Set();
  let cursor;
  let hasMore = true;
  let pages = 0;
  while (hasMore) {
    const qs = new URLSearchParams({ limit: '4' });
    if (cursor) qs.set('cursor', cursor);
    const { status, body } = await http.get(
      `/api/v1/features/${slug}/flows/${flowId}/approvals?${qs}`,
      { auth: false }
    );
    assert.equal(status, 200);
    for (const item of body.items) {
      assert.ok(!seen.has(item.id), `duplicate approval id ${item.id} across pages`);
      seen.add(item.id);
    }
    hasMore = body.page.hasMore;
    cursor = body.page.nextCursor;
    pages += 1;
    assert.ok(pages < 50, 'pagination did not terminate');
  }
  assert.equal(seen.size, actors.length, 'every approval must be visited exactly once');
});
