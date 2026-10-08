import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ApiError, applyGeneration, createDesignSystemRevision, createGeneration, dismissGeneration, getGeneration, getProjectWorkspace, listDesignSystemRevisions, listProjects } from './api.ts'

const originalFetch = globalThis.fetch
const originalWindow = globalThis.window
afterEach(() => { globalThis.fetch = originalFetch; if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow })

test('workspace pagination preserves opaque cursors and project identity', async () => {
  const calls = []
  globalThis.fetch = async (path) => { calls.push(new URL(path, 'https://example.test')); return Response.json({ items: [], page: { hasMore: false, nextCursor: null } }) }
  await listProjects('a+b/c=&')
  await listDesignSystemRevisions('project/a', 'opaque=&')
  await getProjectWorkspace('project/a')
  assert.equal(calls[0].searchParams.get('cursor'), 'a+b/c=&')
  assert.equal(calls[1].pathname, '/api/v1/projects/project%2Fa/design-system/revisions')
  assert.equal(calls[1].searchParams.get('cursor'), 'opaque=&')
  assert.equal(calls[2].pathname, '/api/v1/projects/project%2Fa/workspace')
})

test('design system changes submit immutable revisions using the expected predecessor', async () => {
  const input = { expectedRevision: 3, name: 'App system', description: null, tokens: { color: 'blue' }, components: [{ key: 'save', name: 'Save', status: 'rejected', reason: 'Missing loading state' }] }
  globalThis.fetch = async (path, options) => {
    assert.equal(path, '/api/v1/projects/fxdf_prj_app/design-system/revisions')
    assert.equal(options.method, 'POST'); assert.equal(options.headers.Authorization, 'Bearer reviewer')
    assert.deepEqual(JSON.parse(options.body), input)
    return Response.json({ revision: 4 }, { status: 201 })
  }
  assert.equal((await createDesignSystemRevision('fxdf_prj_app', input, 'reviewer')).revision, 4)
})

test('draft creation cannot submit rendered HTML or an approval; publication keeps its reviewed base', async () => {
  const brief = { flowId: 'join-team', title: 'Join team', goal: 'Join an existing team', steps: [{ title: 'Choose team', description: 'Show the available teams' }] }
  const stamp = 'a'.repeat(64)
  const calls = []
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options }); return Response.json({ id: 'fxdf_gen_draft', status: 'draft' })
  }
  await createGeneration('team/area', stamp, brief, 'writer')
  await applyGeneration('team/area', 'fxdf_gen_draft', stamp, 'writer')
  await dismissGeneration('team/area', 'fxdf_gen_draft', 'writer')
  assert.equal(calls[0].path, '/api/v1/features/team%2Farea/generations')
  assert.deepEqual(JSON.parse(calls[0].options.body), { baseStamp: stamp, brief })
  assert.deepEqual(JSON.parse(calls[1].options.body), { baseStamp: stamp })
  assert.deepEqual(JSON.parse(calls[2].options.body), {})
  assert.equal(calls[1].options.headers.Authorization, 'Bearer writer')
})

test('stale publication conflicts retain the server reason for recovery', async () => {
  globalThis.fetch = async () => Response.json({ error: 'Content stamp changed' }, { status: 409 })
  await assert.rejects(applyGeneration('team', 'fxdf_gen_draft', 'a'.repeat(64), 'writer'), (error) => error instanceof ApiError && error.status === 409 && error.message === 'Content stamp changed')
})

test('draft preview fetch is read only and addresses the durable generation identity', async () => {
  globalThis.fetch = async (path, options) => {
    assert.equal(path, '/api/v1/features/team/generations/fxdf_gen_draft'); assert.equal(options, undefined)
    return Response.json({ id: 'fxdf_gen_draft', status: 'applied', resultStamp: 'b'.repeat(64) })
  }
  assert.equal((await getGeneration('team', 'fxdf_gen_draft')).status, 'applied')
})

test('portal-hosted API and static frames share the delegated proxy prefix', async () => {
  globalThis.window = { location: { pathname: '/apps/fuzex/' } }
  const hosted = await import('./api.ts?hosted-contract')
  globalThis.fetch = async (path) => {
    assert.equal(path, '/api/v1/fuzex/api/v1/projects?limit=100')
    return Response.json({ items: [], page: { hasMore: false, nextCursor: null } })
  }
  await hosted.listProjects()
  assert.equal(hosted.siteFrameUrl('team', 'one.html'), '/api/v1/fuzex/site/team/one.html')
})

test('explicit standalone API override can be empty even when the app mounts under a hosted path', async () => {
  globalThis.window = { DESIGN_FRAMES_API_BASE: '', location: { pathname: '/apps/fuzex/' } }
  const standalone = await import('./api.ts?standalone-contract')
  assert.equal(standalone.siteFrameUrl('team', 'one.html'), '/site/team/one.html')
})
