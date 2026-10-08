'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { generateDraft, validateBrief, ENGINE } = require('../lib/generation');
const { validateManifest } = require('../lib/schema');

const brief = {
  flowId: 'onboarding', title: 'Welcome journey', goal: 'Let a new member join their team', audience: 'New members',
  steps: [
    { title: 'Welcome', description: 'Explain what the workspace offers', action: 'Choose team' },
    { title: 'Choose team', description: 'Select an existing team', action: 'Join team' },
  ],
};
const context = { baseStamp: 'a'.repeat(64), designSystem: 'FuzeSeam' };

test('structured brief yields deterministic navigable unapproved draft, valid manifest and component anchors', () => {
  const draft = generateDraft(brief, context);
  assert.deepEqual(draft, generateDraft(brief, context));
  // The v1 provider's bytes are a versioned contract: keep its output stable
  // across later providers so persisted structured drafts retain their preview.
  const digest = createHash('sha256').update(JSON.stringify(draft)).digest('hex');
  assert.equal(digest, 'a37d2b85584ba8472b7b28bdd586a934a7f780d40f6bbe2883a5300bb0e29827');
  assert.equal(draft.engine, ENGINE);
  assert.equal(draft.baseStamp, context.baseStamp);
  assert.equal(draft.flow.approved, false);
  assert.equal(draft.flow.status, 'draft');
  assert.equal(draft.frames.length, 2);
  assert.match(draft.frames[0].html, /href="onboarding-2.html"/);
  assert.match(draft.frames[1].html, /href="onboarding-1.html"/);
  assert.match(draft.frames[0].html, /data-testhook="onboarding-1-action"/);
  assert.deepEqual(validateManifest({ name: brief.title, description: brief.goal, designSystem: 'FuzeSeam', entry: draft.frames[0].file,
    frames: draft.frames.map(({ html, ...frame }) => frame), build: { flows: [draft.flow] } }), []);
});

test('all user-authored text is escaped and never becomes runnable HTML', () => {
  const malicious = '<script>alert("x")</script><img src=x onerror=alert(1)>';
  const draft = generateDraft({ ...brief, title: malicious, goal: malicious, audience: malicious,
    steps: [{ title: malicious, description: malicious, action: malicious }] }, context);
  assert.doesNotMatch(draft.frames[0].html, /<script|<img/);
  assert.match(draft.frames[0].html, /&lt;script&gt;/);
});

test('malformed, oversized and arbitrary renderer input is rejected before generation', () => {
  for (const input of [null, [], { ...brief, html: '<script />' }, { ...brief, flowId: '../steal' },
    { ...brief, steps: [] }, { ...brief, steps: Array.from({ length: 13 }, () => brief.steps[0]) },
    { ...brief, steps: [{ ...brief.steps[0], html: '<b>Hi</b>' }] }, { ...brief, goal: 'x'.repeat(2001) }]) {
    assert.throws(() => validateBrief(input), { code: 'VALIDATION' });
  }
  assert.throws(() => generateDraft(brief, { baseStamp: 'old' }), { code: 'VALIDATION' });
});
