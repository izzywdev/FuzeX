-- FuzeX is a downstream consumer of FuzeFront identity/security lifecycle
-- events.  FuzeFront remains the identity and Permit/OPAL authorization
-- authority; these rows are only a durable local safety projection used to
-- revoke FuzeX access promptly and to make event handling idempotent.

ALTER TABLE design_frames.project
  ADD COLUMN IF NOT EXISTS organization_id text;

CREATE INDEX IF NOT EXISTS ix_project_organization_id
  ON design_frames.project (organization_id)
  WHERE organization_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS design_frames.tenant_lifecycle_state (
  organization_id text PRIMARY KEY CHECK (length(trim(organization_id)) > 0),
  slug text,
  name text,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  deleted_cascade text CHECK (deleted_cascade in ('soft', 'hard')),
  last_event_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS design_frames.tenant_membership_state (
  organization_id text NOT NULL REFERENCES design_frames.tenant_lifecycle_state(organization_id) ON DELETE CASCADE,
  user_id text NOT NULL CHECK (length(trim(user_id)) > 0),
  role text,
  is_active boolean NOT NULL DEFAULT true,
  last_event_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS ix_tenant_membership_active
  ON design_frames.tenant_membership_state (organization_id, user_id)
  WHERE is_active;

-- Correlation ids are the platform's event idempotency keys. A receipt is
-- inserted in the same transaction as every projection/cleanup mutation, so
-- Kafka redelivery cannot apply a lifecycle transition twice.
CREATE TABLE IF NOT EXISTS design_frames.lifecycle_event_receipt (
  topic text NOT NULL CHECK (length(trim(topic)) > 0),
  correlation_id text NOT NULL CHECK (length(trim(correlation_id)) > 0),
  occurred_at timestamptz NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (topic, correlation_id)
);

-- Authorization-change events never grant access in FuzeX. This is an
-- audit/revocation epoch; live decisions remain FuzeFront Security's job.
CREATE TABLE IF NOT EXISTS design_frames.authorization_change_epoch (
  organization_id text NOT NULL REFERENCES design_frames.tenant_lifecycle_state(organization_id) ON DELETE CASCADE,
  subject_id text NOT NULL CHECK (length(trim(subject_id)) > 0),
  change text NOT NULL CHECK (change in ('membership_added', 'membership_removed', 'membership_role_changed')),
  changed_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, subject_id)
);

COMMENT ON COLUMN design_frames.project.organization_id IS
  'Verified FuzeFront tenant id at workspace creation; never client supplied. Legacy unscoped projects require an explicit administrative migration before tenancy is enforced.';
