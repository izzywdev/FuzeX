-- 0001_create_schema.sql
-- design_frames — the Postgres lifecycle tier for design-frames-service.
-- See ../../docs/postgres-tier.md for the frozen contract this schema backs.
--
-- Idempotent: safe to re-run. This migration does NOT create the database or
-- any role — FuzeInfra provisions the database + a least-privilege role +
-- the DATABASE_URL SealedSecret before this (and every) migration runs
-- in-cluster (see ../README.md). This file only creates the schema.

CREATE SCHEMA IF NOT EXISTS design_frames;

COMMENT ON SCHEMA design_frames IS
  'design-frames-service lifecycle/index tier (projects, features, flows, '
  'frame refs, append-only approvals, discussions, threaded comments). '
  'Frame CONTENT (manifest.json + frame *.html) is NEVER stored here — it '
  'stays in git / the data/ PVC. See docs/postgres-tier.md.';
