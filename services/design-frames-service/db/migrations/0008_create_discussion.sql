-- 0008_create_discussion.sql
-- discussion (wire prefix fxdf_dsc) — polymorphic target
-- (target_type, target_ref) where target_type in
-- project|feature|flow|frame|element. target_ref is the native uuid of the
-- referenced row (project.id / feature.id / flow.id / frame_ref.id); for
-- target_type='element' it is the frame_ref.id being annotated, further
-- narrowed by target_selector (a data-* testHook selector).
--
-- No single-table FK is possible for a polymorphic reference spanning four
-- different tables, so target_ref is left unconstrained by FK (standard
-- polymorphic-association tradeoff) — but it DOES carry its type
-- (target_type), satisfying identifier-standard §2 ("no lookup resolves a
-- bare id"): the backend tier must always resolve (target_type, target_ref)
-- together, never target_ref alone.

CREATE TABLE IF NOT EXISTS design_frames.discussion (
  id               uuid        PRIMARY KEY,
  target_type      text        NOT NULL
                                CHECK (target_type IN ('project', 'feature', 'flow', 'frame', 'element')),
  target_ref       uuid        NOT NULL,
  target_selector  text,
  title            text,
  resolved         boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT discussion_element_requires_selector
    CHECK (target_type <> 'element' OR target_selector IS NOT NULL)
);

COMMENT ON TABLE design_frames.discussion IS
  'fxdf_dsc_* on the wire. Polymorphic (target_type, target_ref) — no FK '
  '(spans project/feature/flow/frame_ref), always resolved as a pair, never '
  'a bare target_ref lookup.';

-- Required by contract.
CREATE INDEX IF NOT EXISTS ix_discussion_target
  ON design_frames.discussion (target_type, target_ref);

DROP TRIGGER IF EXISTS trg_discussion_touch_updated_at ON design_frames.discussion;
CREATE TRIGGER trg_discussion_touch_updated_at
  BEFORE UPDATE ON design_frames.discussion
  FOR EACH ROW
  EXECUTE FUNCTION design_frames.touch_updated_at();
