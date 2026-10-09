import { query, withTransaction } from '../lib/db';
import { fromUuid, mintId, toUuid, type EntityId } from '../lib/identity';
import { ConflictError, NotFoundError } from '../lib/errors';
import type { ReqLogger } from '../lib/logger';
import type { TraceLinkInput, TraceTarget } from '../lib/traceability';

type LinkRow = { id: string; project_id: string; target_type: string; target_ref: string; selector: string | null; content_stamp: string | null; source_system: string; source_kind: string; external_ref: string; external_url: string | null; quote_text: string | null; metadata: Record<string, unknown>; created_by: string; created_at: Date };
type PolicyRow = { id: string; project_id: string; target_type: string; target_ref: string; selector: string | null; title: string; instruction: string; status: 'draft' | 'approved' | 'superseded'; created_by: string; created_at: Date; approved_by: string | null; approved_at: Date | null; supersedes_id: string | null; trace_link_ids: string[] };

export interface TraceLinkDTO { id: EntityId<'traceLink'>; projectId: EntityId<'project'>; target: TraceTarget; source: { system: string; kind: string; externalRef: string; externalUrl: string | null; quoteText: string | null; metadata: Record<string, unknown> }; createdBy: string; createdAt: string }
export interface DesignPolicyDTO { id: EntityId<'designPolicy'>; projectId: EntityId<'project'>; target: Omit<TraceTarget, 'contentStamp'>; title: string; instruction: string; status: 'draft' | 'approved' | 'superseded'; traceLinkIds: EntityId<'traceLink'>[]; createdBy: string; createdAt: string; approvedBy: string | null; approvedAt: string | null; supersedesId: EntityId<'designPolicy'> | null }

function linkDTO(row: LinkRow): TraceLinkDTO { return { id: fromUuid('traceLink', row.id), projectId: fromUuid('project', row.project_id), target: { targetType: row.target_type as TraceTarget['targetType'], targetRef: row.target_ref, selector: row.selector, contentStamp: row.content_stamp }, source: { system: row.source_system, kind: row.source_kind, externalRef: row.external_ref, externalUrl: row.external_url, quoteText: row.quote_text, metadata: row.metadata }, createdBy: row.created_by, createdAt: row.created_at.toISOString() }; }
function policyDTO(row: PolicyRow): DesignPolicyDTO { return { id: fromUuid('designPolicy', row.id), projectId: fromUuid('project', row.project_id), target: { targetType: row.target_type as TraceTarget['targetType'], targetRef: row.target_ref, selector: row.selector }, title: row.title, instruction: row.instruction, status: row.status, traceLinkIds: row.trace_link_ids.map((id) => fromUuid('traceLink', id)), createdBy: row.created_by, createdAt: row.created_at.toISOString(), approvedBy: row.approved_by, approvedAt: row.approved_at?.toISOString() ?? null, supersedesId: row.supersedes_id ? fromUuid('designPolicy', row.supersedes_id) : null }; }

async function requireProject(projectId: EntityId<'project'>, log: ReqLogger): Promise<void> { const result = await query('select id from design_frames.project where id = $1', [toUuid(projectId)], log); if (!result.rows.length) throw new NotFoundError(`project '${projectId}' not found`); }
async function requireTargetInProject(projectId: EntityId<'project'>, target: TraceTarget, log: ReqLogger): Promise<void> {
  if (target.targetType === 'project') { if (target.targetRef !== projectId) throw new NotFoundError('trace target project does not match the route project'); return; }
  if (target.targetType === 'designSystemComponent') {
    // A free-form key would create orphaned evidence. The latest immutable
    // Design System snapshot is the authoritative component catalogue.
    const component = await query(
      `select 1 from design_frames.design_system_revision
       where project_id = $1 and components @> $2::jsonb
       order by revision desc limit 1`,
      [toUuid(projectId), JSON.stringify([{ key: target.targetRef }])], log
    );
    if (!component.rows.length) throw new NotFoundError('design-system component does not belong to this project');
    return;
  }
  const text = target.targetType === 'flow' || target.targetType === 'flowStep'
    ? 'select 1 from design_frames.flow where id = $1 and project_id = $2'
    : `select 1 from design_frames.frame_ref r join design_frames.flow f on f.id = r.flow_id left join design_frames.feature ft on ft.id = f.feature_id where r.id = $1 and (f.project_id = $2 or ft.project_id = $2)`;
  const result = await query(text, [toUuid(target.targetRef as EntityId<'flow' | 'frameRef'>), toUuid(projectId)], log);
  if (!result.rows.length) throw new NotFoundError('trace target does not belong to this project');
}

export async function listTraceLinks(projectId: EntityId<'project'>, target: Partial<Pick<TraceTarget, 'targetType' | 'targetRef'>>, log: ReqLogger): Promise<TraceLinkDTO[]> {
  await requireProject(projectId, log);
  const params: unknown[] = [toUuid(projectId)]; let where = 'project_id = $1';
  if (target.targetType) { params.push(target.targetType); where += ` and target_type = $${params.length}`; }
  if (target.targetRef) { params.push(target.targetRef); where += ` and target_ref = $${params.length}`; }
  const { rows } = await query<LinkRow>(`select * from design_frames.design_trace_link where ${where} order by created_at asc, id asc`, params, log);
  return rows.map(linkDTO);
}

export async function createTraceLink(projectId: EntityId<'project'>, input: TraceLinkInput, actor: string, log: ReqLogger): Promise<TraceLinkDTO> {
  await requireProject(projectId, log); await requireTargetInProject(projectId, input, log); const id = mintId('traceLink');
  const { rows } = await query<LinkRow>(`insert into design_frames.design_trace_link (id,project_id,target_type,target_ref,selector,content_stamp,source_system,source_kind,external_ref,external_url,quote_text,metadata,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13) returning *`, [toUuid(id),toUuid(projectId),input.targetType,input.targetRef,input.selector,input.contentStamp,input.sourceSystem,input.sourceKind,input.externalRef,input.externalUrl,input.quoteText,JSON.stringify(input.metadata),actor], log);
  return linkDTO(rows[0]);
}

const POLICY_SELECT = `select p.*, coalesce(array_agg(pt.trace_link_id) filter (where pt.trace_link_id is not null), '{}') as trace_link_ids from design_frames.design_agent_policy p left join design_frames.design_agent_policy_trace_link pt on pt.policy_id = p.id`;
export async function listPolicies(projectId: EntityId<'project'>, approvedOnly: boolean, log: ReqLogger): Promise<DesignPolicyDTO[]> {
  await requireProject(projectId, log); const { rows } = await query<PolicyRow>(`${POLICY_SELECT} where p.project_id = $1 ${approvedOnly ? "and p.status = 'approved'" : ''} group by p.id order by p.created_at asc, p.id asc`, [toUuid(projectId)], log); return rows.map(policyDTO);
}

export async function createPolicy(projectId: EntityId<'project'>, input: TraceTarget & { title: string; instruction: string; traceLinkIds: EntityId<'traceLink'>[] }, actor: string, log: ReqLogger): Promise<DesignPolicyDTO> {
  await requireTargetInProject(projectId, input, log);
  return withTransaction(async (client) => {
    const project = await client.query('select id from design_frames.project where id = $1 for update', [toUuid(projectId)]); if (!project.rows.length) throw new NotFoundError(`project '${projectId}' not found`);
    if (input.traceLinkIds.length) { const refs = input.traceLinkIds.map(toUuid); const links = await client.query<{ id: string }>('select id from design_frames.design_trace_link where project_id = $1 and id = any($2::uuid[])', [toUuid(projectId), refs]); if (links.rows.length !== refs.length) throw new NotFoundError('one or more trace links do not belong to this project'); }
    const id = mintId('designPolicy');
    const inserted = await client.query<PolicyRow>(`insert into design_frames.design_agent_policy (id,project_id,target_type,target_ref,selector,title,instruction,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *, '{}'::uuid[] as trace_link_ids`, [toUuid(id),toUuid(projectId),input.targetType,input.targetRef,input.selector,input.title,input.instruction,actor]);
    for (const traceId of input.traceLinkIds) await client.query('insert into design_frames.design_agent_policy_trace_link (policy_id, trace_link_id) values ($1,$2)', [toUuid(id), toUuid(traceId)]);
    return policyDTO({ ...inserted.rows[0], trace_link_ids: input.traceLinkIds.map(toUuid) });
  }, log);
}

export async function approvePolicy(projectId: EntityId<'project'>, policyId: EntityId<'designPolicy'>, actor: string, log: ReqLogger): Promise<DesignPolicyDTO> {
  const { rows } = await query<PolicyRow>(`${POLICY_SELECT} where p.project_id = $1 and p.id = $2 group by p.id`, [toUuid(projectId),toUuid(policyId)], log); const current = rows[0]; if (!current) throw new NotFoundError(`design policy '${policyId}' not found in project '${projectId}'`); if (current.status !== 'draft') throw new ConflictError('only draft design policies can be approved');
  await query(`update design_frames.design_agent_policy set status = 'approved', approved_by = $3, approved_at = now() where project_id = $1 and id = $2`, [toUuid(projectId),toUuid(policyId),actor], log);
  const result = await query<PolicyRow>(`${POLICY_SELECT} where p.project_id = $1 and p.id = $2 group by p.id`, [toUuid(projectId),toUuid(policyId)], log);
  return policyDTO(result.rows[0]);
}

/**
 * Policy instructions are evidence records, not mutable prompts.  Replacing a
 * decision creates a new draft and marks the previous policy superseded in the
 * same transaction; no consumer can mistake a changed instruction for the
 * one that was originally approved.
 */
export async function supersedePolicy(projectId: EntityId<'project'>, policyId: EntityId<'designPolicy'>, input: TraceTarget & { title: string; instruction: string; traceLinkIds: EntityId<'traceLink'>[] }, actor: string, log: ReqLogger): Promise<DesignPolicyDTO> {
  await requireTargetInProject(projectId, input, log);
  return withTransaction(async (client) => {
    const previous = await client.query<PolicyRow>('select * from design_frames.design_agent_policy where project_id = $1 and id = $2 for update', [toUuid(projectId), toUuid(policyId)]);
    const current = previous.rows[0];
    if (!current) throw new NotFoundError(`design policy '${policyId}' not found in project '${projectId}'`);
    if (current.status === 'superseded') throw new ConflictError('a superseded design policy cannot be superseded again');
    if (input.traceLinkIds.length) {
      const refs = input.traceLinkIds.map(toUuid);
      const links = await client.query<{ id: string }>('select id from design_frames.design_trace_link where project_id = $1 and id = any($2::uuid[])', [toUuid(projectId), refs]);
      if (links.rows.length !== refs.length) throw new NotFoundError('one or more trace links do not belong to this project');
    }
    const id = mintId('designPolicy');
    const inserted = await client.query<PolicyRow>(`insert into design_frames.design_agent_policy (id,project_id,target_type,target_ref,selector,title,instruction,created_by,supersedes_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *, '{}'::uuid[] as trace_link_ids`, [toUuid(id),toUuid(projectId),input.targetType,input.targetRef,input.selector,input.title,input.instruction,actor,toUuid(policyId)]);
    for (const traceId of input.traceLinkIds) await client.query('insert into design_frames.design_agent_policy_trace_link (policy_id, trace_link_id) values ($1,$2)', [toUuid(id), toUuid(traceId)]);
    await client.query("update design_frames.design_agent_policy set status = 'superseded' where project_id = $1 and id = $2", [toUuid(projectId), toUuid(policyId)]);
    return policyDTO({ ...inserted.rows[0], trace_link_ids: input.traceLinkIds.map(toUuid) });
  }, log);
}
