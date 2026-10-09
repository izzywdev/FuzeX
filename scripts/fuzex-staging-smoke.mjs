#!/usr/bin/env node
/**
 * Credentialed FuzeX staging acceptance check.
 *
 * This verifier deliberately does not dispatch Argo or restore data.  Those are
 * FuzeInfra-owned operations.  It provides the evidence a rollout/rollback
 * operator needs from FuzeX's own API: correct same-origin routing, dependency
 * readiness, immutable imports/revisions, and append-only review decisions.
 *
 * Default mode is read-only.  `--mutation` requires an explicit acknowledgement
 * and a dedicated, non-production feature slug before it can publish the bundled
 * fixture and append a single approval decision.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const usage = `Usage:
  FUZE_X_SMOKE_BASE_URL=https://staging.example \\
  FUZE_X_SMOKE_BEARER_TOKEN=... \\
  node scripts/fuzex-staging-smoke.mjs [--mutation] [--rollback]

Required environment:
  FUZE_X_SMOKE_BASE_URL       Same-origin FuzeFront mount, e.g. https://portal.example/apps/fuzex/api
  FUZE_X_SMOKE_BEARER_TOKEN   FuzeFront-issued staging workload/machine token (never log it)

Optional environment:
  FUZE_X_SMOKE_DELEGATION_TOKEN  Delegated user token when the caller uses delegated auth
  FUZE_X_SMOKE_FEATURE_SLUG      Dedicated staging-only feature (required for --mutation)
  FUZE_X_SMOKE_IMPORT_FILE       Fixture JSON (defaults to scripts/fixtures/staging-smoke-import.json)
  FUZE_X_SMOKE_FLOW_ID           Flow key to approve (defaults to staging-smoke-flow)
  FUZE_X_SMOKE_ROLLBACK_STAMP    Historical immutable stamp to retrieve with --rollback
  FUZE_X_SMOKE_ROLLBACK_FRAME    Frame filename to hash with --rollback (defaults to index.html)
  FUZE_X_SMOKE_ROLLBACK_FRAME_SHA256  Expected SHA-256 of that historical frame

Safety:
  --mutation is refused unless FUZE_X_SMOKE_ALLOW_MUTATION=dedicated-staging-fixture.
  It never deletes data, rolls infrastructure back, or accepts an arbitrary import body.
`;

function fail(message) { throw new Error(message); }

function normalizedBaseUrl(value) {
  if (!value) fail('FUZE_X_SMOKE_BASE_URL is required');
  let parsed;
  try { parsed = new URL(value); } catch { fail('FUZE_X_SMOKE_BASE_URL must be an absolute http(s) URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) fail('FUZE_X_SMOKE_BASE_URL must use http or https');
  parsed.username = '';
  parsed.password = '';
  return parsed.toString().replace(/\/$/, '');
}

function authHeaders() {
  const bearer = process.env.FUZE_X_SMOKE_BEARER_TOKEN;
  if (!bearer) fail('FUZE_X_SMOKE_BEARER_TOKEN is required');
  const headers = { Authorization: `Bearer ${bearer}`, Accept: 'application/json' };
  const delegation = process.env.FUZE_X_SMOKE_DELEGATION_TOKEN;
  if (delegation) headers['X-Fuze-Delegation'] = `Bearer ${delegation}`;
  return headers;
}

function isHtml(contentType, text) {
  return /text\/html/i.test(contentType ?? '') || /^\s*<!doctype html/i.test(text) || /^\s*<html[\s>]/i.test(text);
}

async function request(baseUrl, method, path, { body, authenticated = true, expected = [200] } = {}) {
  const headers = authenticated ? authHeaders() : { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error',
  });
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  if (isHtml(contentType, text)) {
    fail(`${method} ${path} returned HTML; expected the FuzeX API (portal SPA fallback/routing failure)`);
  }
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { fail(`${method} ${path} returned non-JSON API content (${response.status})`); }
  if (!expected.includes(response.status)) {
    const message = typeof json?.error === 'string' ? json.error : 'unexpected response';
    fail(`${method} ${path} returned ${response.status}: ${message}`);
  }
  return json;
}

function assert(condition, message) { if (!condition) fail(message); }

async function verifyHealth(baseUrl) {
  const health = await request(baseUrl, 'GET', '/health', { authenticated: false });
  assert(health?.status === 'healthy', '/health did not report healthy');
  const ready = await request(baseUrl, 'GET', '/ready', { authenticated: false });
  assert(ready?.status === 'ready', '/ready did not report ready (database or durable storage is unavailable)');
}

async function verifyRollbackRevision(baseUrl) {
  const slug = process.env.FUZE_X_SMOKE_FEATURE_SLUG;
  const stamp = process.env.FUZE_X_SMOKE_ROLLBACK_STAMP;
  if (!slug || !stamp) fail('--rollback requires FUZE_X_SMOKE_FEATURE_SLUG and FUZE_X_SMOKE_ROLLBACK_STAMP');
  if (!/^[a-f0-9]{64}$/.test(stamp)) fail('FUZE_X_SMOKE_ROLLBACK_STAMP must be a lowercase sha256 digest');
  const revision = await request(baseUrl, 'GET', `/api/v1/features/${encodeURIComponent(slug)}/revisions/${stamp}`);
  assert(revision?.stamp === stamp, 'historical revision response did not preserve the requested stamp');
  const frame = process.env.FUZE_X_SMOKE_ROLLBACK_FRAME ?? 'index.html';
  const html = revision?.frames?.[frame];
  assert(typeof html === 'string', `historical revision does not contain ${frame}`);
  const expectedHash = process.env.FUZE_X_SMOKE_ROLLBACK_FRAME_SHA256;
  if (expectedHash) {
    const actualHash = createHash('sha256').update(html).digest('hex');
    assert(actualHash === expectedHash, `historical ${frame} hash differs from the recorded rollback evidence`);
  }
  return { stamp, frame };
}

async function verifyMutation(baseUrl) {
  if (process.env.FUZE_X_SMOKE_ALLOW_MUTATION !== 'dedicated-staging-fixture') {
    fail('--mutation requires FUZE_X_SMOKE_ALLOW_MUTATION=dedicated-staging-fixture');
  }
  const slug = process.env.FUZE_X_SMOKE_FEATURE_SLUG;
  if (!slug || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(slug) || !slug.includes('smoke')) {
    fail('--mutation requires FUZE_X_SMOKE_FEATURE_SLUG to be a dedicated lowercase *smoke* feature slug');
  }
  const fixturePath = resolve(process.env.FUZE_X_SMOKE_IMPORT_FILE ?? 'scripts/fixtures/staging-smoke-import.json');
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  assert(fixture?.manifest && fixture?.frames, 'smoke fixture must contain manifest and frames');
  const flowId = process.env.FUZE_X_SMOKE_FLOW_ID ?? 'staging-smoke-flow';

  let currentStamp = null;
  try {
    const current = await request(baseUrl, 'GET', `/api/v1/features/${encodeURIComponent(slug)}/stamp`, { expected: [200, 404] });
    currentStamp = current?.stamp ?? null;
  } catch (error) {
    // A 404 is returned as valid JSON and is handled above; do not hide routing/auth failures.
    throw error;
  }
  const imported = await request(baseUrl, 'POST', `/api/v1/features/${encodeURIComponent(slug)}/import`, {
    body: { ...fixture, expectedStamp: currentStamp },
  });
  assert(/^[a-f0-9]{64}$/.test(imported?.stamp ?? ''), 'import did not return an immutable content stamp');
  assert(imported.frameCount === Object.keys(fixture.frames).length, 'imported frame count differs from fixture');

  // Replaying the exact same publication must retain the same immutable revision.
  const replay = await request(baseUrl, 'POST', `/api/v1/features/${encodeURIComponent(slug)}/import`, {
    body: { ...fixture, expectedStamp: imported.stamp },
  });
  assert(replay?.stamp === imported.stamp, 'idempotent import produced a different immutable stamp');
  const revision = await request(baseUrl, 'GET', `/api/v1/features/${encodeURIComponent(slug)}/revisions/${imported.stamp}`);
  assert(revision?.stamp === imported.stamp, 'exact imported revision cannot be read back');
  for (const [file, html] of Object.entries(fixture.frames)) {
    assert(revision?.frames?.[file] === html, `immutable revision bytes differ for ${file}`);
  }

  const approvalsBefore = await request(baseUrl, 'GET', `/api/v1/features/${encodeURIComponent(slug)}/flows/${encodeURIComponent(flowId)}/approvals`);
  const approved = await request(baseUrl, 'POST', `/api/v1/features/${encodeURIComponent(slug)}/flows/${encodeURIComponent(flowId)}/approve`, {
    body: { approvedBy: 'staging-smoke-verifier', contentStamp: imported.stamp },
  });
  assert(approved?.decision === 'approve' && approved?.contentStamp === imported.stamp, 'approval was not bound to the imported immutable revision');
  const approvalsAfter = await request(baseUrl, 'GET', `/api/v1/features/${encodeURIComponent(slug)}/flows/${encodeURIComponent(flowId)}/approvals`);
  assert((approvalsAfter?.items?.length ?? 0) >= (approvalsBefore?.items?.length ?? 0) + 1, 'append-only approval history did not grow');
  return { slug, stamp: imported.stamp, approvalId: approved.id ?? null };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(usage); return; }
  const supported = new Set(['--mutation', '--rollback']);
  const unknown = argv.filter((arg) => !supported.has(arg));
  if (unknown.length) fail(`unknown argument(s): ${unknown.join(', ')}\n${usage}`);
  const baseUrl = normalizedBaseUrl(process.env.FUZE_X_SMOKE_BASE_URL);
  await verifyHealth(baseUrl);
  const result = { healthy: true, ready: true };
  if (argv.includes('--mutation')) result.mutation = await verifyMutation(baseUrl);
  if (argv.includes('--rollback')) result.rollback = await verifyRollbackRevision(baseUrl);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // Never print environment variables, headers, token values, or response bodies.
    process.stderr.write(`FuzeX staging smoke failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
