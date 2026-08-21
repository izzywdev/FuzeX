-- 0007_create_approval.sql
-- approval (wire prefix fxdf_apr) — APPEND-ONLY decision log for a flow.
-- decision discriminates approve/reject; a change of mind APPENDS a new row,
-- never mutates a prior one (see docs/postgres-tier.md "Append-only approval
-- log + stamp-binding invariant"). Enforced below by
-- design_frames.forbid_mutation() (0002_functions.sql) rejecting every
-- UPDATE and DELETE.

CREATE TABLE IF NOT EXISTS design_frames.approval (
  id             uuid        PRIMARY KEY,
  flow_id        uuid        NOT NULL REFERENCES design_frames.flow(id),
  decision       text        NOT NULL CHECK (decision IN ('approve', 'reject')),

  -- actor(ref+type) — identifier-standard §2 polymorphic-reference pairing.
  -- NOTE (deviation, documented): actor_ref is TEXT, not a native uuid.
  -- openapi.yaml's Approval.actorRef is explicitly "Who decided
  -- (approvedBy/rejectedBy)" — an external identity string (email/SSO
  -- subject/agent name), not an fxdf_* entity id minted by this service.
  -- discussion.target_ref (0008) IS a native uuid because it references
  -- fxdf_* rows this service owns (project/feature/flow/frame_ref).
  actor_ref      text        NOT NULL CHECK (length(trim(actor_ref)) > 0),
  actor_type     text        NOT NULL DEFAULT 'user'
                              CHECK (actor_type IN ('user', 'agent')),

  -- Stamp-binding: sha256 hex from lib/stamp.js. Nullable for legacy
  -- {approvedBy}-only callers (openapi: "Old {approvedBy}-only approve
  -- callers still work" — appended as an approve row with a null stamp).
  content_stamp  char(64)    CHECK (content_stamp IS NULL OR content_stamp ~ '^[0-9a-f]{64}$'),

  -- Reject requires reason (v0.2.0 tightening) — table-level CHECK.
  reason         text,

  decided_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT approval_reject_requires_reason
    CHECK (decision <> 'reject' OR (reason IS NOT NULL AND length(trim(reason)) > 0))
);

COMMENT ON TABLE design_frames.approval IS
  'fxdf_apr_* on the wire. APPEND-ONLY decision log — see '
  'design_frames.forbid_mutation() trigger below. GET .../approvals returns '
  'this history newest-first via ix_approval_flow_decided_at.';

-- Required by contract: (flow_id, decided_at) for history queries,
-- newest-first.
CREATE INDEX IF NOT EXISTS ix_approval_flow_decided_at
  ON design_frames.approval (flow_id, decided_at DESC);

DROP TRIGGER IF EXISTS trg_approval_forbid_mutation ON design_frames.approval;
CREATE TRIGGER trg_approval_forbid_mutation
  BEFORE UPDATE OR DELETE ON design_frames.approval
  FOR EACH ROW
  EXECUTE FUNCTION design_frames.forbid_mutation();
