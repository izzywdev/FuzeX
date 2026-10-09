import assert from 'node:assert/strict'
import test from 'node:test'
import { PREVIEW_CSP, parsePreviewMessage, resolvePreviewUrl } from './previewSecurity.ts'

test('bundle entries are constrained to the dedicated HTTPS preview origin', () => {
  assert.equal(
    resolvePreviewUrl('/bundles/revision-1/index.html', 'https://preview.fuzex.example'),
    'https://preview.fuzex.example/bundles/revision-1/index.html'
  )
  assert.throws(
    () => resolvePreviewUrl('https://portal.fuze.example/apps/fuzex', 'https://preview.fuzex.example'),
    /dedicated preview origin/
  )
  assert.throws(
    () => resolvePreviewUrl('/bundle/index.html', 'http://preview.fuzex.example'),
    /HTTPS/
  )
})

test('the iframe policy allows local prototype assets but blocks network and embedding', () => {
  assert.match(PREVIEW_CSP, /default-src 'none'/)
  assert.match(PREVIEW_CSP, /connect-src 'none'/)
  assert.match(PREVIEW_CSP, /frame-src 'none'/)
  assert.match(PREVIEW_CSP, /form-action 'none'/)
  assert.match(PREVIEW_CSP, /script-src 'self' 'unsafe-inline' blob:/)
})

test('postMessage contract accepts only versioned lifecycle and local navigation events', () => {
  assert.deepEqual(parsePreviewMessage({ type: 'fuzex.preview.ready', version: 1 }), {
    type: 'fuzex.preview.ready', version: 1,
  })
  assert.deepEqual(parsePreviewMessage({ type: 'fuzex.preview.navigate', version: 1, path: '/checkout/confirm.html' }), {
    type: 'fuzex.preview.navigate', version: 1, path: '/checkout/confirm.html',
  })
  assert.equal(parsePreviewMessage({ type: 'fuzex.preview.navigate', version: 1, path: 'https://evil.example' }), null)
  assert.equal(parsePreviewMessage({ type: 'fuzex.preview.navigate', version: 1, path: '/../admin' }), null)
  assert.equal(parsePreviewMessage({ type: 'fuzex.preview.navigate', version: 2, path: '/ok' }), null)
  assert.equal(parsePreviewMessage({ type: 'fuzex.preview.token', version: 1, token: 'never' }), null)
})
