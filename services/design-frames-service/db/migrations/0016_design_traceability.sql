-- Traceability connects a design decision to its business and QA evidence.
-- External references are evidence locators only: FuzeX never dereferences an
-- arbitrary URL supplied by a user, so this relation cannot become SSRF.
CREATE TABLE IF NOT EXISTS design_frames.design_trace_link (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES design_frames.project(id),
  target_type text NOT NULL CHECK (target_type IN ('project','flow','flowStep','frame','element','designSystemComponent')),
  target_ref text NOT NULL CHECK (length(trim(target_ref)) > 0),
  selector text,
  content_stamp text CHECK (content_stamp IS NULL OR content_stamp ~ '^[0-9a-f]{64}$'),
  source_system text NOT NULL CHECK (source_system IN ('fuzeplan','fuzequality','fuzex')),
  source_kind text NOT NULL CHECK (source_kind IN ('requirement','llm_quote','test_case','design_decision')),
  external_ref text NOT NULL CHECK (length(trim(external_ref)) > 0),
  external_url text,
  quote_text text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source_kind = 'llm_quote') = (quote_text IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_design_trace_link_target
  ON design_frames.design_trace_link(project_id, target_type, target_ref, created_at);

-- Policies are natural-language design constraints for AI agents. A draft is
-- never returned by the approved-only endpoint; approval is explicit and
-- attributable. Body/scope become immutable once recorded, preserving the
-- evidence behind an approval while allowing status to advance.
CREATE TABLE IF NOT EXISTS design_frames.design_agent_policy (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES design_frames.project(id),
  target_type text NOT NULL CHECK (target_type IN ('project','flow','flowStep','frame','element','designSystemComponent')),
  target_ref text NOT NULL CHECK (length(trim(target_ref)) > 0),
  selector text,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  instruction text NOT NULL CHECK (length(trim(instruction)) > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','superseded')),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  supersedes_id uuid REFERENCES design_frames.design_agent_policy(id),
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_design_agent_policy_scope
  ON design_frames.design_agent_policy(project_id, target_type, target_ref, status, created_at);

CREATE TABLE IF NOT EXISTS design_frames.design_agent_policy_trace_link (
  policy_id uuid NOT NULL REFERENCES design_frames.design_agent_policy(id) ON DELETE CASCADE,
  trace_link_id uuid NOT NULL REFERENCES design_frames.design_trace_link(id),
  PRIMARY KEY(policy_id, trace_link_id)
);

CREATE OR REPLACE FUNCTION design_frames.guard_design_agent_policy_body()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.target_type IS DISTINCT FROM OLD.target_type
     OR NEW.target_ref IS DISTINCT FROM OLD.target_ref OR NEW.selector IS DISTINCT FROM OLD.selector
     OR NEW.title IS DISTINCT FROM OLD.title OR NEW.instruction IS DISTINCT FROM OLD.instruction
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'design policy body is immutable; supersede it with a new policy' USING ERRCODE = '25000';
  END IF;
  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'superseded design policies are immutable' USING ERRCODE = '25000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_design_agent_policy_body_immutable ON design_frames.design_agent_policy;
CREATE TRIGGER trg_design_agent_policy_body_immutable BEFORE UPDATE ON design_frames.design_agent_policy
  FOR EACH ROW EXECUTE FUNCTION design_frames.guard_design_agent_policy_body();
