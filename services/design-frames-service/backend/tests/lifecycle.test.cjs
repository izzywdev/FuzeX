'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLifecycleEnvelope, LIFECYCLE_TOPICS } = require('../dist/events/lifecycle.js');

const event = (topic, payload) => ({
  version: '1.0', topic, correlationId: 'request-123', occurredAt: '2026-10-09T12:00:00.000Z', payload,
});

test('accepts only canonical lifecycle topic/version envelopes', () => {
  const parsed = parseLifecycleEnvelope(event('identity.org.created', {
    organizationId: 'c0a80101-1234-4abc-8def-000000000001', slug: 'acme', name: 'Acme', isActive: true,
  }), 'identity.org.created');
  assert.equal(parsed.topic, 'identity.org.created');
  assert.deepEqual(LIFECYCLE_TOPICS, [
    'identity.org.created', 'identity.org.deleted', 'identity.user.deleted',
    'identity.membership.added', 'identity.membership.removed', 'identity.authorization.changed',
  ]);
});

test('rejects stale/ambiguous envelope versions and Kafka topic substitution', () => {
  assert.throws(() => parseLifecycleEnvelope({ version: '0.9', topic: 'identity.org.created', correlationId: 'x', occurredAt: '2026-10-09T12:00:00Z', payload: {} }));
  assert.throws(() => parseLifecycleEnvelope(event('identity.org.created', {}), 'identity.org.deleted'));
  assert.throws(() => parseLifecycleEnvelope(event('unknown.topic', {})));
});
