-- 0009_create_comment.sql
-- comment (wire prefix fxdf_cmt) — APPEND-ONLY, threaded via nullable
-- self-FK parent_comment_id, soft-delete via deleted_at (set once; the row
-- is retained per openapi.yaml "Soft-deleted comments are tombstoned, not
-- omitted"). Enforced below by design_frames.comment_guard()
-- (0002_functions.sql): rejects hard DELETE always, and any UPDATE other
-- than the single deleted_at-setting soft-delete transition.

CREATE TABLE IF NOT EXISTS design_frames.comment (
  id                 uuid        PRIMARY KEY,
  discussion_id      uuid        NOT NULL REFERENCES design_frames.discussion(id),
  parent_comment_id  uuid        REFERENCES design_frames.comment(id),

  body               text        NOT NULL,

  -- author(ref+type) — identifier-standard §2. See 0007_create_approval.sql
  -- for why this is TEXT (external identity string, e.g. email/SSO subject),
  -- not a native uuid: openapi.yaml Comment.authorRef carries no fxdf_*
  -- pattern, unlike discussion.target_ref.
  author_ref         text        NOT NULL CHECK (length(trim(author_ref)) > 0),
  author_type        text        NOT NULL DEFAULT 'user'
                                  CHECK (author_type IN ('user', 'agent')),

  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),

  -- Tombstone shape: a live comment has a non-empty body; a soft-deleted one
  -- is blanked (openapi: "Empty string when deleted=true").
  CONSTRAINT comment_tombstone_shape
    CHECK (
      (deleted_at IS NULL AND length(body) > 0)
      OR (deleted_at IS NOT NULL AND body = '')
    )
);

COMMENT ON TABLE design_frames.comment IS
  'fxdf_cmt_* on the wire. APPEND-ONLY + threaded (nullable self-FK '
  'parent_comment_id) + soft-delete (deleted_at set once). See '
  'design_frames.comment_guard() trigger below.';

-- Required by contract.
CREATE INDEX IF NOT EXISTS ix_comment_discussion_id
  ON design_frames.comment (discussion_id);
CREATE INDEX IF NOT EXISTS ix_comment_parent_comment_id
  ON design_frames.comment (parent_comment_id);

DROP TRIGGER IF EXISTS trg_comment_guard ON design_frames.comment;
CREATE TRIGGER trg_comment_guard
  BEFORE UPDATE OR DELETE ON design_frames.comment
  FOR EACH ROW
  EXECUTE FUNCTION design_frames.comment_guard();
