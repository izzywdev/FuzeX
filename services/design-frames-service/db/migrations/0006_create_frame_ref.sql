-- 0006_create_frame_ref.sql
-- frame_ref (wire prefix fxdf_frm) — a REF ONLY: (feature, file,
-- content_stamp) identity pointer at a frame. NEVER stores frame HTML — the
-- bytes stay in git / the data/ PVC (see docs/postgres-tier.md "Two-tier
-- persistence"). flow_id is nullable: a frame may belong to the feature but
-- to no single flow.

CREATE TABLE IF NOT EXISTS design_frames.frame_ref (
  id             uuid        PRIMARY KEY,
  feature_id     uuid        NOT NULL REFERENCES design_frames.feature(id),
  flow_id        uuid        REFERENCES design_frames.flow(id),
  file           text        NOT NULL CHECK (file ~ '\.html$'),
  content_stamp  char(64)    NOT NULL CHECK (content_stamp ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feature_id, file, content_stamp)
);

COMMENT ON TABLE design_frames.frame_ref IS
  'fxdf_frm_* on the wire. REF ONLY — points at a frame by '
  '(feature, file, content_stamp); never holds HTML. content_stamp is the '
  'sha256 hex from lib/stamp.js computeStamp().';
COMMENT ON COLUMN design_frames.frame_ref.flow_id IS
  'Nullable: a frame can belong to the feature but to no single flow.';

CREATE INDEX IF NOT EXISTS ix_frame_ref_feature_id
  ON design_frames.frame_ref (feature_id);
CREATE INDEX IF NOT EXISTS ix_frame_ref_flow_id
  ON design_frames.frame_ref (flow_id);

-- NOTE (not enforced here — see db/README.md "Known gaps"): the contract
-- does not explicitly require frame_ref to be append-only the way
-- approval/comment are. The (feature_id, file, content_stamp) UNIQUE
-- constraint makes inserting a duplicate ref a no-op-by-rejection, but
-- nothing here blocks UPDATE/DELETE on an existing row. If the backend tier
-- needs frame_ref rows to be strictly immutable/insert-only too, add a
-- design_frames.forbid_mutation() trigger here in a follow-up migration.
