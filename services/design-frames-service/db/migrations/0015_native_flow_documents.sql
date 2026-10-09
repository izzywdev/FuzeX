-- Native FuzeX UX flows are owned by an App/project, rather than by a Git
-- feature manifest. The existing design_frames.flow rows remain valid legacy
-- flow identities; this migration makes their legacy feature parent optional
-- and introduces the project-owned document/revision lifecycle.

ALTER TABLE design_frames.flow
  ALTER COLUMN feature_id DROP NOT NULL;

ALTER TABLE design_frames.flow
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES design_frames.project(id),
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE design_frames.flow
  ADD CONSTRAINT chk_flow_single_owner
  CHECK ((feature_id IS NULL) <> (project_id IS NULL));

ALTER TABLE design_frames.flow
  ADD CONSTRAINT uq_flow_project_key UNIQUE (project_id, flow_key);

ALTER TABLE design_frames.flow
  ADD CONSTRAINT chk_native_flow_name
  CHECK (project_id IS NULL OR (name IS NOT NULL AND length(trim(name)) > 0));

CREATE INDEX IF NOT EXISTS ix_flow_project_id
  ON design_frames.flow (project_id)
  WHERE project_id IS NOT NULL;

-- The document is intentionally JSONB: it is the portable, database-native
-- representation of a UX flow (for example React Flow nodes/edges). Rendered
-- HTML/JS bundles are handled by the artifact tier and are never mixed into
-- lifecycle metadata. Rows are immutable evidence snapshots.
CREATE TABLE IF NOT EXISTS design_frames.flow_document_revision (
  flow_id uuid NOT NULL REFERENCES design_frames.flow(id),
  revision integer NOT NULL CHECK (revision > 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  message text,
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flow_id, revision)
);

CREATE OR REPLACE FUNCTION design_frames.guard_flow_document_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'flow document revisions are immutable; append a new revision'
    USING ERRCODE = '25000';
END;
$$;

DROP TRIGGER IF EXISTS trg_flow_document_revision_immutable ON design_frames.flow_document_revision;
CREATE TRIGGER trg_flow_document_revision_immutable
  BEFORE UPDATE OR DELETE ON design_frames.flow_document_revision
  FOR EACH ROW
  EXECUTE FUNCTION design_frames.guard_flow_document_revision();
