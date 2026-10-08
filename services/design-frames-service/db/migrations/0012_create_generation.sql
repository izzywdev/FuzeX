-- Structured generation inputs and outputs remain drafts until explicitly applied.
CREATE TABLE IF NOT EXISTS design_frames.generation (
  id uuid PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES design_frames.feature(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'applied', 'dismissed')),
  base_stamp text NOT NULL CHECK (base_stamp ~ '^[a-f0-9]{64}$'),
  result_stamp text CHECK (result_stamp IS NULL OR result_stamp ~ '^[a-f0-9]{64}$'),
  actor_ref text NOT NULL,
  draft jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'applied') = (result_stamp IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_generation_feature_created ON design_frames.generation (feature_id, created_at DESC, id DESC);
DROP TRIGGER IF EXISTS trg_generation_touch_updated_at ON design_frames.generation;
CREATE TRIGGER trg_generation_touch_updated_at BEFORE UPDATE ON design_frames.generation
  FOR EACH ROW EXECUTE FUNCTION design_frames.touch_updated_at();
