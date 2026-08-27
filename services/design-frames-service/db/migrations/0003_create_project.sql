-- 0003_create_project.sql
-- project (wire prefix fxdf_prj) — groups features across a consuming product.
--
-- Identifier storage: `id` is a native 16-byte uuid PRIMARY KEY (UUIDv7,
-- minted by the app via mintId(), never by the DB — no DEFAULT
-- gen_random_uuid()/uuid_generate_v4() here per identifier-standard §1). The
-- `fxdf_prj_*` TypeID prefix is a wire-only concern encoded/decoded by the
-- app's identity codec; it is never stored as (part of) the PK.

CREATE TABLE IF NOT EXISTS design_frames.project (
  id           uuid        PRIMARY KEY,
  name         text        NOT NULL CHECK (length(trim(name)) > 0),
  description  text,
  source_repo  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE design_frames.project IS
  'fxdf_prj_* on the wire; native uuid PK here. ProjectCreate '
  '(openapi.yaml) forbids a client-supplied id — the service mints it.';
COMMENT ON COLUMN design_frames.project.id IS
  'Native UUIDv7, minted app-side. Encode as fxdf_prj_<base32> on the wire.';

DROP TRIGGER IF EXISTS trg_project_touch_updated_at ON design_frames.project;
CREATE TRIGGER trg_project_touch_updated_at
  BEFORE UPDATE ON design_frames.project
  FOR EACH ROW
  EXECUTE FUNCTION design_frames.touch_updated_at();
