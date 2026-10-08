-- A project's design system is an append-only sequence. A revision number is
-- an address within its owning project, never a globally interchangeable id.
CREATE TABLE IF NOT EXISTS design_frames.design_system_revision (
  project_id uuid NOT NULL REFERENCES design_frames.project(id),
  revision integer NOT NULL CHECK (revision > 0),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  description text,
  tokens jsonb NOT NULL CHECK (jsonb_typeof(tokens) = 'object'),
  components jsonb NOT NULL CHECK (jsonb_typeof(components) = 'array'),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, revision)
);

CREATE OR REPLACE FUNCTION design_frames.guard_design_system_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'design system revisions are immutable; append a new revision'
    USING ERRCODE = '25000';
END;
$$;

DROP TRIGGER IF EXISTS trg_design_system_revision_immutable ON design_frames.design_system_revision;
CREATE TRIGGER trg_design_system_revision_immutable
  BEFORE UPDATE OR DELETE ON design_frames.design_system_revision
  FOR EACH ROW EXECUTE FUNCTION design_frames.guard_design_system_revision();
