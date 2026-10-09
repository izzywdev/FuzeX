-- Native FuzeX UX artifact bundles.  HTML/JS/CSS/images live in private
-- object storage; Postgres records only immutable object metadata and the
-- revision graph.  There is intentionally no public URL or storage credential
-- in this schema.

CREATE TABLE IF NOT EXISTS design_frames.artifact_bundle (
  id              uuid        PRIMARY KEY,
  project_id      uuid        NOT NULL REFERENCES design_frames.project(id) ON DELETE CASCADE,
  flow_key        text        NOT NULL CHECK (flow_key ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  revision        integer     NOT NULL CHECK (revision > 0),
  display_name    text        NOT NULL CHECK (length(trim(display_name)) > 0),
  content_sha256  text        NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  storage_bucket  text        NOT NULL CHECK (length(trim(storage_bucket)) > 0),
  storage_prefix  text        NOT NULL CHECK (storage_prefix ~ '^[a-zA-Z0-9!_.*''()/=-]+$'),
  state           text        NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading', 'sealed')),
  created_by      text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sealed_at       timestamptz,
  UNIQUE (project_id, flow_key, revision),
  UNIQUE (project_id, content_sha256),
  CHECK ((state = 'uploading' AND sealed_at IS NULL) OR (state = 'sealed' AND sealed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ix_artifact_bundle_project_flow
  ON design_frames.artifact_bundle (project_id, flow_key, revision DESC);

CREATE TABLE IF NOT EXISTS design_frames.artifact_bundle_object (
  id              uuid        PRIMARY KEY,
  bundle_id       uuid        NOT NULL REFERENCES design_frames.artifact_bundle(id) ON DELETE CASCADE,
  object_path     text        NOT NULL CHECK (object_path ~ '^[a-zA-Z0-9][a-zA-Z0-9!_.*''()/=-]*$' AND object_path !~ '(^|/)\\.\\.?(/|$)'),
  content_type    text        NOT NULL CHECK (length(content_type) BETWEEN 1 AND 255),
  byte_size       bigint      NOT NULL CHECK (byte_size >= 0 AND byte_size <= 1073741824),
  sha256          text        NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  storage_key     text        NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bundle_id, object_path)
);

CREATE OR REPLACE FUNCTION design_frames.guard_artifact_bundle_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'artifact bundles cannot be deleted';
  END IF;
  IF OLD.state = 'sealed' THEN
    RAISE EXCEPTION 'sealed artifact bundles are immutable';
  END IF;
  IF NEW.id <> OLD.id OR NEW.project_id <> OLD.project_id OR NEW.flow_key <> OLD.flow_key
     OR NEW.revision <> OLD.revision OR NEW.display_name <> OLD.display_name
     OR NEW.content_sha256 <> OLD.content_sha256 OR NEW.storage_bucket <> OLD.storage_bucket
     OR NEW.storage_prefix <> OLD.storage_prefix OR NEW.created_by <> OLD.created_by
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'artifact bundle metadata is immutable';
  END IF;
  IF NEW.state <> 'sealed' OR NEW.sealed_at IS NULL THEN
    RAISE EXCEPTION 'artifact bundle state can only transition to sealed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION design_frames.reject_artifact_object_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'artifact bundle objects are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_artifact_bundle_immutable ON design_frames.artifact_bundle;
CREATE TRIGGER trg_artifact_bundle_immutable
  BEFORE UPDATE OR DELETE ON design_frames.artifact_bundle
  FOR EACH ROW EXECUTE FUNCTION design_frames.guard_artifact_bundle_immutable();

DROP TRIGGER IF EXISTS trg_artifact_bundle_object_immutable ON design_frames.artifact_bundle_object;
CREATE TRIGGER trg_artifact_bundle_object_immutable
  BEFORE UPDATE OR DELETE ON design_frames.artifact_bundle_object
  FOR EACH ROW EXECUTE FUNCTION design_frames.reject_artifact_object_mutation();

COMMENT ON TABLE design_frames.artifact_bundle IS
  'Immutable private UX artifact bundle revision. Bytes are in S3/MinIO, never Postgres or public buckets.';
COMMENT ON TABLE design_frames.artifact_bundle_object IS
  'Allowlisted private bundle objects; object paths and checksums are immutable after declaration.';
