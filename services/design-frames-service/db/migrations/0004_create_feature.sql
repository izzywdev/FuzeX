-- 0004_create_feature.sql
-- feature (wire prefix fxdf_ftr) — the index row for a design-frames
-- feature. Frame CONTENT (manifest.json + *.html) is NEVER stored here; this
-- row is a pointer + a place to hang project assignment, flows, frame_refs.
-- Still addressable by `slug` on the wire (v0.1.0 compatibility) — `slug` is
-- unique but is NOT the identifier; `id` is.

CREATE TABLE IF NOT EXISTS design_frames.feature (
  id          uuid        PRIMARY KEY,
  slug        text        NOT NULL UNIQUE
                           CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Nullable REFERENCE to an existing project — a reference, not identity
  -- (identifier-standard §1); a feature may be unassigned.
  project_id  uuid        REFERENCES design_frames.project(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE design_frames.feature IS
  'fxdf_ftr_* on the wire; native uuid PK here. project_id is a nullable '
  'REFERENCE (openapi ProjectId), never client-chosen identity.';
COMMENT ON COLUMN design_frames.feature.slug IS
  'Wire-addressable slug (v0.1.0 compatibility); unique, but id is the '
  'actual identifier — slug is a lookup key, not identity.';

CREATE INDEX IF NOT EXISTS ix_feature_project_id
  ON design_frames.feature (project_id);

DROP TRIGGER IF EXISTS trg_feature_touch_updated_at ON design_frames.feature;
CREATE TRIGGER trg_feature_touch_updated_at
  BEFORE UPDATE ON design_frames.feature
  FOR EACH ROW
  EXECUTE FUNCTION design_frames.touch_updated_at();
