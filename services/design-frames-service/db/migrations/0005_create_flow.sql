-- 0005_create_flow.sql
-- flow (wire prefix fxdf_flw, per docs/postgres-tier.md's entity/prefix
-- table) — an approvable flow within a feature.
--
-- IMPORTANT wire note: the `{flowId}` path parameter used throughout
-- openapi.yaml (.../flows/{flowId}/approve|reject|approvals) is the
-- PRE-EXISTING manifest flow id (manifest.build.flows[].id, a plain string
-- such as "primary" set by product-designer/frontend-engineer content) — NOT
-- an fxdf_flw_* TypeID. openapi.yaml deliberately has no `FlowId` TypeID
-- schema (unlike ProjectId/ApprovalId/DiscussionId/CommentId/FrameRefId),
-- which is why: this table has an internal uuid `id` for FK use by
-- approval/frame_ref, PLUS a `flow_key` column holding that manifest string,
-- unique per feature, which the backend tier resolves the wire {flowId} to
-- (create-on-first-use is expected — a flow is not explicitly POSTed).

CREATE TABLE IF NOT EXISTS design_frames.flow (
  id          uuid        PRIMARY KEY,
  feature_id  uuid        NOT NULL REFERENCES design_frames.feature(id),
  flow_key    text        NOT NULL CHECK (length(trim(flow_key)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feature_id, flow_key)
);

COMMENT ON TABLE design_frames.flow IS
  'Internal fxdf_flw_* row. flow_key is the manifest build.flows[].id '
  'string == the wire {flowId} path param; resolved (feature_id, flow_key) '
  '-> id by the backend tier, never exposed as a bare id lookup.';

CREATE INDEX IF NOT EXISTS ix_flow_feature_id
  ON design_frames.flow (feature_id);

DROP TRIGGER IF EXISTS trg_flow_touch_updated_at ON design_frames.flow;
CREATE TRIGGER trg_flow_touch_updated_at
  BEFORE UPDATE ON design_frames.flow
  FOR EACH ROW
  EXECUTE FUNCTION design_frames.touch_updated_at();
