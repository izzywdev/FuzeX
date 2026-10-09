# FuzeX platform events

FuzeX publishes design-lifecycle events through the PostgreSQL transactional outbox `design_frames.event_outbox`. A business write and its outbox row commit together. Delivery is at-least-once; consumers deduplicate on `eventId`.

Every event has the family envelope: `eventId`, `type`, `schemaVersion`, `occurredAt`, `tenantId`, `actor`, `correlationId`, and `payload`. Kafka key is `tenantId`, preserving tenant order.

Published version-1 topics: `fuzex.project.created`, `fuzex.project.updated`, `fuzex.project.repository.connected`, `fuzex.flow.created`, `fuzex.flow.revision.created`, `fuzex.flow.approval.recorded`, `fuzex.design-system.revision.created`, `fuzex.trace-link.created`, `fuzex.design-policy.approved`, and `fuzex.design-policy.superseded`.

Payloads hold safe identifiers and metadata only. They never include frame HTML, artifacts, FuzePlan LLM quote text or requirement/test bodies, credentials, external URLs, or design-policy instruction text. Consumers needing protected details must use an authorized FuzeX API call. `schemaVersion` is additive-only; breaking changes require a new version/topic.
