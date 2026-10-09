# FuzeFront lifecycle events

FuzeX consumes platform lifecycle events as a downstream, at-least-once Kafka
consumer. It is deliberately not an identity or authorization authority:
FuzeFront Security and its Permit/OPAL model continue to make every live access
decision.

Enable the consumer only when a FuzeInfra Kafka endpoint is provisioned:

```yaml
postgresTier:
  lifecycleEvents:
    enabled: true
    brokers: kafka.fuzeinfra.svc.cluster.local:9092
    groupId: fuzex-lifecycle-v1
```

The supported v1 topics are `identity.org.created`, `identity.org.deleted`,
`identity.user.deleted`, `identity.membership.added`,
`identity.membership.removed`, and `identity.authorization.changed`.

Each envelope must have `{ version: '1.0', topic, correlationId, occurredAt,
payload }`. `topic + correlationId` is recorded transactionally before the
projection/cleanup mutation, so replay is harmless. Invalid envelopes go to
`<topic>.dlq` with only a reason and raw-payload hash; database failures are
re-thrown for Kafka retry.

Organization/user/membership removal creates a local tombstone or revocation
that blocks FuzeX access immediately in addition to the live FuzeFront
authorization check. Hard organization deletion removes only projects with a
verified `organization_id`; legacy unscoped records are never guessed at or
deleted. `identity.authorization.changed` records a per-subject authorization
epoch for audit/cache invalidation; membership removal also revokes the local
projection. It never grants a role or interprets policy locally.
