import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { addDiscussionComment, ApiError, createElementDiscussion, getDiscussion, listElementDiscussions, setDiscussionResolved } from './api.ts'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('revision frame annotations retain target identity and opaque pagination cursor', async () => {
  const frameRef = 'fxdf_frm_frame-revision-identity'
  const cursor = 'opaque+cursor/with=reserved&characters'
  globalThis.fetch = async (path, options) => {
    const url = new URL(path, 'https://fuzex.example')
    assert.equal(url.pathname, '/api/v1/discussions')
    assert.equal(url.searchParams.get('targetType'), 'element')
    assert.equal(url.searchParams.get('targetRef'), frameRef)
    assert.equal(url.searchParams.get('cursor'), cursor)
    assert.equal(options, undefined)
    return Response.json({ items: [], page: { nextCursor: null, hasMore: false } })
  }
  assert.deepEqual(await listElementDiscussions(frameRef, cursor), { items: [], page: { nextCursor: null, hasMore: false } })
})

test('creating an annotation sends the exact immutable frame target with a write token', async () => {
  globalThis.fetch = async (path, options) => {
    assert.equal(path, '/api/v1/discussions')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers.Authorization, 'Bearer reviewer-token')
    assert.deepEqual(JSON.parse(options.body), {
      targetType: 'element', targetRef: 'fxdf_frm_revision-a', targetSelector: '[data-testid=save-button]', title: 'Save needs a disabled state',
    })
    return Response.json({ id: 'fxdf_dsc_annotation' }, { status: 201 })
  }
  assert.equal((await createElementDiscussion('fxdf_frm_revision-a', '[data-testid=save-button]', 'Save needs a disabled state', '  reviewer-token  ')).id, 'fxdf_dsc_annotation')
})

test('replies preserve the parent comment without accepting client-selected author identity', async () => {
  globalThis.fetch = async (path, options) => {
    assert.equal(path, '/api/v1/discussions/fxdf_dsc_thread/comments')
    assert.deepEqual(JSON.parse(options.body), { body: 'Updated in the next revision', parentCommentId: 'fxdf_cmt_parent' })
    assert.equal(options.headers.Authorization, 'Bearer token')
    return Response.json({ id: 'fxdf_cmt_reply' }, { status: 201 })
  }
  assert.equal((await addDiscussionComment('fxdf_dsc_thread', 'Updated in the next revision', 'token', 'fxdf_cmt_parent')).id, 'fxdf_cmt_reply')
})

test('resolve and reopen persist opposite statuses using the same discussion identity', async () => {
  const statuses = []
  globalThis.fetch = async (path, options) => {
    assert.equal(path, '/api/v1/discussions/fxdf_dsc_thread')
    assert.equal(options.method, 'PATCH')
    const { resolved } = JSON.parse(options.body)
    statuses.push(resolved)
    return Response.json({ id: 'fxdf_dsc_thread', resolved })
  }
  await setDiscussionResolved('fxdf_dsc_thread', true, 'token')
  await setDiscussionResolved('fxdf_dsc_thread', false, 'token')
  assert.deepEqual(statuses, [true, false])
})

test('authentication failures expose actionable server errors and retain the draft retry reason', async () => {
  globalThis.fetch = async () => Response.json({ error: 'Reviewer token expired', details: ['Sign in again'] }, { status: 401 })
  await assert.rejects(getDiscussion('fxdf_dsc_thread'), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 401)
    assert.equal(error.message, 'Reviewer token expired')
    assert.deepEqual(error.details, ['Sign in again'])
    return true
  })
})
