const test = require('node:test');
const assert = require('node:assert/strict');
const { FUZE_X_EVENT_TOPICS, makeEvent, EventContractError } = require('../dist/lib/events');
const { __testables: relay } = require('../dist/events/outboxRelay');

test('FuzeX event has the versioned tenant envelope and safe project payload', () => {
  const event = makeEvent(FUZE_X_EVENT_TOPICS.projectCreated, { tenantId: 'org_test', actor: 'usr_test', correlationId: 'request-1' }, { projectId: 'fxdf_prj_test', name: 'Studio', sourceRepo: null }, new Date('2026-10-09T00:00:00.000Z'));
  assert.equal(event.type, 'fuzex.project.created');
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.tenantId, 'org_test');
  assert.equal(event.correlationId, 'request-1');
  assert.match(event.eventId, /^[0-9a-f-]{36}$/i);
});

test('FuzeX events reject quote/frame/credential data before it reaches the outbox', () => {
  assert.throws(() => makeEvent(FUZE_X_EVENT_TOPICS.traceLinkCreated, { tenantId: 'org_test', actor: 'usr_test' }, { projectId: 'fxdf_prj_test', traceLinkId: 'trace-1', sourceSystem: 'fuzeplan', sourceKind: 'llm_quote', quoteText: 'private requirement' }), EventContractError);
  assert.throws(() => makeEvent(FUZE_X_EVENT_TOPICS.projectCreated, { tenantId: 'org_test', actor: 'usr_test' }, { projectId: 'fxdf_prj_test', name: 'Studio', html: '<html>secret</html>' }), EventContractError);
});

test('outbox backoff is bounded', () => {
  assert.equal(relay.backoffMs(1), 1000);
  assert.equal(relay.backoffMs(99), 60000);
});
