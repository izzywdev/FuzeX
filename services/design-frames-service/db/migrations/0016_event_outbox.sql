-- FuzeX's transactional outbox: the state mutation and safe platform event
-- commit together.  It stores references/metadata only, never design content.
CREATE TABLE IF NOT EXISTS design_frames.event_outbox (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL CHECK (length(trim(tenant_id)) > 0),
  aggregate_key text NOT NULL CHECK (length(trim(aggregate_key)) > 0),
  topic text NOT NULL CHECK (topic LIKE 'fuzex.%'),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  correlation_id text,
  actor text,
  occurred_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  locked_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_event_outbox_pending ON design_frames.event_outbox (available_at, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_event_outbox_tenant_aggregate ON design_frames.event_outbox (tenant_id, aggregate_key, created_at);
COMMENT ON TABLE design_frames.event_outbox IS 'Tenant-scoped transactional outbox; payloads never contain frame HTML, artifact contents, LLM quote text, credentials, or policy instruction bodies.';
