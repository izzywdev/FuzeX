-- Database-owned application catalogue. A project is the App visible in the
-- FuzeX portal; repositories are explicit connections to it. A frame manifest
-- may report provenance, but it must never create an App implicitly.

ALTER TABLE design_frames.feature
  ADD COLUMN IF NOT EXISTS source_repo text;

CREATE INDEX IF NOT EXISTS ix_feature_source_repo
  ON design_frames.feature (source_repo)
  WHERE source_repo IS NOT NULL;

CREATE TABLE IF NOT EXISTS design_frames.project_repository (
  id              uuid        PRIMARY KEY,
  project_id      uuid        NOT NULL REFERENCES design_frames.project(id) ON DELETE CASCADE,
  repository      text        NOT NULL UNIQUE CHECK (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  frames_path     text        NOT NULL DEFAULT 'design/frames',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_project_repository_project
  ON design_frames.project_repository (project_id);

DROP TRIGGER IF EXISTS trg_project_repository_touch_updated_at ON design_frames.project_repository;
CREATE TRIGGER trg_project_repository_touch_updated_at
  BEFORE UPDATE ON design_frames.project_repository
  FOR EACH ROW
  EXECUTE FUNCTION design_frames.touch_updated_at();

COMMENT ON TABLE design_frames.project_repository IS
  'Explicit repository connections for a database-owned FuzeX App workspace. '
  'A manifest sourceRepo is provenance only; imports match this catalogue.';
