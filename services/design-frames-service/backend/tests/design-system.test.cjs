'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDesignSystemRevision, parseRevisionNumber } = require('../dist/lib/designSystem.js');

const valid = () => ({ expectedRevision: 0, name: 'Core', tokens: { color: { accent: { $type: 'color', $value: '#06f' } } }, components: [{ key: 'button.primary', name: 'Primary button' }] });

test('accepts nested tokens, component reviews, and normalizes nullable description', () => {
  const input = valid();
  input.components[0].status = 'rejected';
  input.components[0].reason = 'Contrast is too low';
  const parsed = parseDesignSystemRevision(input);
  assert.equal(parsed.description, null);
  assert.deepEqual(parsed.tokens, input.tokens);
  assert.equal(parsed.components[0].reason, 'Contrast is too low');
});

test('rejects caller-supplied revision identity and audit authors', () => {
  for (const field of ['projectId', 'revision', 'createdBy', 'createdAt', 'id']) {
    assert.throws(() => parseDesignSystemRevision({ ...valid(), [field]: 'injected' }), /invalid design system revision/);
  }
});

test('rejects malformed snapshot structures, duplicate component keys and rejected components without explanation', () => {
  for (const patch of [
    { tokens: [] }, { components: {} }, { components: [null] },
    { expectedRevision: -1 }, { expectedRevision: 0.5 }, { expectedRevision: 2147483647 },
    { components: [{ key: 'x', name: 'X' }, { key: 'x', name: 'Y' }] },
    { components: [{ key: 'x', name: 'X', status: 'rejected' }] },
    { components: [{ key: 'x', name: 'X', status: 'unknown' }] },
    { components: [{ key: 'x', name: 'X', status: ['approved'] }] },
    { components: [{ key: 'x', name: 'X', selector: null }] },
  ]) assert.throws(() => parseDesignSystemRevision({ ...valid(), ...patch }), /invalid design system revision/);
  for (const value of [null, [], 'snapshot']) assert.throws(() => parseDesignSystemRevision(value), /must be an object/);
});

test('requires canonical positive bounded revision addresses', () => {
  assert.equal(parseRevisionNumber('2147483647'), 2147483647);
  for (const value of ['0', '-1', '01', '1e2', '1.2', '2147483648', 'not-a-revision']) {
    assert.throws(() => parseRevisionNumber(value), /revision must be/);
  }
});
