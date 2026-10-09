// Pure workspace behavior is testable independently of the embedded portal.
import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewStatusLabel, summarizeComponentReviews, validateDesignSystemDraft } from './designSystemWorkspace.ts'

test('design system drafts reject invalid and duplicate component keys before publishing', () => {
  assert.equal(validateDesignSystemDraft('', {}, []), 'Provide a name for this design system revision.')
  assert.equal(validateDesignSystemDraft('Portal', [], []), 'Tokens must be a JSON object.')
  assert.match(validateDesignSystemDraft('Portal', {}, [{ key: 'not valid', name: 'Button' }]), /stable key/)
  assert.equal(validateDesignSystemDraft('Portal', {}, [
    { key: 'button.primary', name: 'Primary button' },
    { key: 'button.primary', name: 'Duplicated button' },
  ]), 'Component key "button.primary" is used more than once.')
})

test('review summary treats unreviewed components as drafts', () => {
  assert.deepEqual(summarizeComponentReviews([
    { key: 'button', name: 'Button', status: 'approved' },
    { key: 'alert', name: 'Alert', status: 'rejected' },
    { key: 'input', name: 'Input' },
  ]), { approved: 1, rejected: 1, draft: 1 })
  assert.equal(reviewStatusLabel('rejected'), 'Changes requested')
  assert.equal(reviewStatusLabel(undefined), 'Draft')
})
