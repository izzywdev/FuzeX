import { query, withTransaction } from '../lib/db';
import { fromUuid, mintId, toUuid, type EntityId } from '../lib/identity';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { buildPage, decodeCursor, type Page, type PageParams } from '../lib/pagination';
import type { ReqLogger } from '../lib/logger';
import { enqueueEvent, FUZE_X_EVENT_TOPICS, makeEvent, type EventContext } from '../lib/events';

interface FlowRow {
  id: string;
  project_id: string;
  flow_key: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  current_revision: number | null;
}

interface RevisionRow {
  flow_id: string;
  revision: number;
  document: Record<string, unknown>;
  message: string | null;
  created_by: string;
  created_at: Date;
}

export interface NativeFlowDTO {
  id: EntityId<'flow'>;
  projectId: EntityId<'project'>;
  key: string;
  name: string;
  description: string | null;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface FlowDocumentRevisionDTO {
  flowId: EntityId<'flow'>;
  revision: number;
  document: Record<string, unknown>;
  message: string | null;
  createdBy: string;
  createdAt: string;
}

export interface NativeFlowCreate {
  key: string;
  name: string;
  description: string | null;
  document: Record<string, unknown>;
  message: string | null;
}

function toFlowDTO(row: FlowRow): NativeFlowDTO {
  return {
    id: fromUuid('flow', row.id), projectId: fromUuid('project', row.project_id),
    key: row.flow_key, name: row.name, description: row.description,
    currentRevision: row.current_revision ?? 0,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}

function toRevisionDTO(row: RevisionRow): FlowDocumentRevisionDTO {
  return {
    flowId: fromUuid('flow', row.flow_id), revision: row.revision, document: row.document,
    message: row.message, createdBy: row.created_by, createdAt: row.created_at.toISOString(),
  };
}

const FLOW_SELECT = `select f.*, latest.revision as current_revision
  from design_frames.flow f
  left join lateral (
    select revision from design_frames.flow_document_revision r
    where r.flow_id = f.id order by revision desc limit 1
  ) latest on true`;

export async function listNativeFlows(projectId: EntityId<'project'>, page: PageParams, log: ReqLogger): Promise<Page<NativeFlowDTO>> {
  let after: { ts: string; id: string } | null = null;
  if (page.cursor) {
    const payload = decodeCursor(page.cursor);
    const separator = payload.v.indexOf('|');
    const cursorProject = separator < 0 ? '' : payload.v.slice(0, separator);
    const cursorTimestamp = separator < 0 ? '' : payload.v.slice(separator + 1);
    if (cursorProject !== projectId || !cursorTimestamp) {
      throw new ValidationError('invalid native flow cursor');
    }
    after = { ts: cursorTimestamp, id: payload.id };
  }
  const params: unknown[] = [toUuid(projectId)];
  let where = 'f.project_id = $1';
  if (after) {
    params.push(after.ts, after.id);
    where += ' and (f.created_at, f.id) > ($2::timestamptz, $3::uuid)';
  }
  params.push(page.limit + 1);
  const { rows } = await query<FlowRow>(`${FLOW_SELECT} where ${where} order by f.created_at asc, f.id asc limit $${params.length}`, params, log);
  return buildPage(rows, page.limit, toFlowDTO, (row) => ({ v: `${projectId}|${row.created_at.toISOString()}`, id: row.id }));
}

export async function countNativeFlows(projectId: EntityId<'project'>, log: ReqLogger): Promise<number> {
  const { rows } = await query<{ count: string }>(
    'select count(*)::text as count from design_frames.flow where project_id = $1', [toUuid(projectId)], log
  );
  return Number(rows[0]?.count ?? 0);
}

async function requireNativeFlow(projectId: EntityId<'project'>, flowId: EntityId<'flow'>, log: ReqLogger): Promise<FlowRow> {
  const { rows } = await query<FlowRow>(`${FLOW_SELECT} where f.project_id = $1 and f.id = $2`, [toUuid(projectId), toUuid(flowId)], log);
  if (!rows[0]) throw new NotFoundError(`native flow '${flowId}' not found in project '${projectId}'`);
  return rows[0];
}

export async function getNativeFlow(projectId: EntityId<'project'>, flowId: EntityId<'flow'>, log: ReqLogger): Promise<NativeFlowDTO> {
  return toFlowDTO(await requireNativeFlow(projectId, flowId, log));
}

export async function createNativeFlow(projectId: EntityId<'project'>, input: NativeFlowCreate, createdBy: string, log: ReqLogger, eventContext?: EventContext): Promise<{ flow: NativeFlowDTO; revision: FlowDocumentRevisionDTO }> {
  return withTransaction(async (client) => {
    const project = await client.query('select id from design_frames.project where id = $1 for update', [toUuid(projectId)]);
    if (!project.rows.length) throw new NotFoundError(`project '${projectId}' not found`);
    const id = mintId('flow');
    try {
      const inserted = await client.query<FlowRow>(
        `insert into design_frames.flow (id, project_id, flow_key, name, description)
         values ($1,$2,$3,$4,$5)
         returning *, 1::integer as current_revision`,
        [toUuid(id), toUuid(projectId), input.key, input.name, input.description]
      );
      const revision = await client.query<RevisionRow>(
        `insert into design_frames.flow_document_revision (flow_id, revision, document, message, created_by)
         values ($1,1,$2::jsonb,$3,$4) returning *`,
        [toUuid(id), JSON.stringify(input.document), input.message, createdBy]
      );
      const result = { flow: toFlowDTO(inserted.rows[0]), revision: toRevisionDTO(revision.rows[0]) };
      if (eventContext) await enqueueEvent(client, result.flow.id, makeEvent(FUZE_X_EVENT_TOPICS.flowCreated, eventContext, { projectId: result.flow.projectId, flowId: result.flow.id, flowKey: result.flow.key, revision: result.revision.revision }));
      return result;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictError(`a flow with key '${input.key}' already exists in this project`);
      throw error;
    }
  }, log);
}

export async function getNativeFlowRevision(projectId: EntityId<'project'>, flowId: EntityId<'flow'>, revision: number, log: ReqLogger): Promise<FlowDocumentRevisionDTO> {
  await requireNativeFlow(projectId, flowId, log);
  const { rows } = await query<RevisionRow>(
    `select * from design_frames.flow_document_revision where flow_id = $1 and revision = $2`,
    [toUuid(flowId), revision], log
  );
  if (!rows[0]) throw new NotFoundError(`revision '${revision}' not found for flow '${flowId}'`);
  return toRevisionDTO(rows[0]);
}

export async function listNativeFlowRevisions(projectId: EntityId<'project'>, flowId: EntityId<'flow'>, page: PageParams, log: ReqLogger): Promise<Page<FlowDocumentRevisionDTO>> {
  await requireNativeFlow(projectId, flowId, log);
  let after = 0;
  if (page.cursor) {
    const payload = decodeCursor(page.cursor);
    after = Number(payload.v);
    if (payload.id !== flowId || !Number.isSafeInteger(after) || after < 1) throw new ValidationError('invalid flow revision cursor');
  }
  const { rows } = await query<RevisionRow>(
    `select * from design_frames.flow_document_revision where flow_id = $1 and revision > $2 order by revision asc limit $3`,
    [toUuid(flowId), after, page.limit + 1], log
  );
  return buildPage(rows, page.limit, toRevisionDTO, (row) => ({ id: flowId, v: String(row.revision) }));
}

export async function appendNativeFlowRevision(
  projectId: EntityId<'project'>, flowId: EntityId<'flow'>,
  input: { expectedRevision: number; document: Record<string, unknown>; message: string | null },
  createdBy: string, log: ReqLogger, eventContext?: EventContext
): Promise<FlowDocumentRevisionDTO> {
  return withTransaction(async (client) => {
    const flow = await client.query<FlowRow>(
      `select * from design_frames.flow where id = $1 and project_id = $2 for update`, [toUuid(flowId), toUuid(projectId)]
    );
    if (!flow.rows[0]) throw new NotFoundError(`native flow '${flowId}' not found in project '${projectId}'`);
    const latest = await client.query<{ revision: number }>(
      `select revision from design_frames.flow_document_revision where flow_id = $1 order by revision desc limit 1`, [toUuid(flowId)]
    );
    const current = latest.rows[0]?.revision ?? 0;
    if (current !== input.expectedRevision) throw new ConflictError(`flow has revision ${current}; expected ${input.expectedRevision}`);
    const { rows } = await client.query<RevisionRow>(
      `insert into design_frames.flow_document_revision (flow_id, revision, document, message, created_by)
       values ($1,$2,$3::jsonb,$4,$5) returning *`,
      [toUuid(flowId), current + 1, JSON.stringify(input.document), input.message, createdBy]
    );
    const result = toRevisionDTO(rows[0]);
    if (eventContext) await enqueueEvent(client, flowId, makeEvent(FUZE_X_EVENT_TOPICS.flowRevisionCreated, eventContext, { projectId, flowId, revision: result.revision, message: result.message }));
    return result;
  }, log);
}
