-- 0002_functions.sql
-- Shared trigger functions used by later migrations. Idempotent via
-- CREATE OR REPLACE FUNCTION (safe to re-run; a function body change would
-- also be picked up on re-run, which is the desired idempotent-forward-only
-- behaviour for this repo's migrations).

-- touch_updated_at(): bumps updated_at on any UPDATE. Attached to the
-- mutable-metadata tables (project, feature, flow, discussion) — NOT to the
-- append-only tables (approval, comment), which have their own guards below.
CREATE OR REPLACE FUNCTION design_frames.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- forbid_mutation(): unconditionally rejects UPDATE and DELETE. Attached to
-- `approval` — a decision log row is written once and never touched again;
-- a change of mind APPENDS a new row (see docs/postgres-tier.md "Append-only
-- approval log"). This is the strongest and simplest enforcement available in
-- plain SQL (a CHECK constraint cannot reference OLD vs NEW across time).
CREATE OR REPLACE FUNCTION design_frames.forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'design_frames.%: append-only table — % is not permitted (id=%)',
    TG_TABLE_NAME, TG_OP, COALESCE(OLD.id::text, 'unknown')
    USING ERRCODE = '25000'; -- invalid_transaction_state (closest generic code)
  RETURN NULL; -- unreachable, keeps plpgsql happy
END;
$$;

-- comment_guard(): `comment` is append-only EXCEPT for exactly one allowed
-- transition — soft-delete, which sets deleted_at (once) and blanks body to
-- the empty-string tombstone per the Comment schema in openapi.yaml
-- ("Empty string when deleted=true"). Every other UPDATE, and every DELETE,
-- is rejected. Re-soft-deleting an already-deleted row is also rejected.
CREATE OR REPLACE FUNCTION design_frames.comment_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'design_frames.comment: append-only — hard DELETE is not permitted (id=%)',
      OLD.id
      USING ERRCODE = '25000';
  END IF;

  -- TG_OP = 'UPDATE' from here.
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION
      'design_frames.comment: row % is already soft-deleted — no further mutation permitted',
      OLD.id
      USING ERRCODE = '25000';
  END IF;

  IF NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION
      'design_frames.comment: only a soft-delete (setting deleted_at) is permitted, id=%',
      OLD.id
      USING ERRCODE = '25000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.discussion_id IS DISTINCT FROM OLD.discussion_id
     OR NEW.parent_comment_id IS DISTINCT FROM OLD.parent_comment_id
     OR NEW.author_ref IS DISTINCT FROM OLD.author_ref
     OR NEW.author_type IS DISTINCT FROM OLD.author_type
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'design_frames.comment: soft-delete may only set deleted_at (and blank body), id=%',
      OLD.id
      USING ERRCODE = '25000';
  END IF;

  NEW.body := ''; -- enforce the tombstone shape regardless of what the caller sent
  RETURN NEW;
END;
$$;
