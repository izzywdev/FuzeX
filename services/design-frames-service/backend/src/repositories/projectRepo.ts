// projectRepo.ts — design_frames.project (fxdf_prj_*).

import { query, withTransaction } from '../lib/db';
import { mintId, toUuid, fromUuid, type EntityId } from '../lib/identity';
import { ConflictError, NotFoundError } from '../lib/errors';
import { buildPage, decodeCursor, type Page, type PageParams } from '../lib/pagination';
import type { ReqLogger } from '../lib/logger';
import { enqueueEvent, FUZE_X_EVENT_TOPICS, makeEvent, type EventContext } from '../lib/events';

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  source_repo: string | null;
  organization_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/** `ProjectRow` plus the FULL microsecond-precision text rendering of
 * `created_at`, used ONLY for the pagination cursor — `pg` parses
 * `timestamptz` into a millisecond JS `Date`, but Postgres stores
 * microseconds, so a cursor built from `row.created_at.toISOString()` loses
 * precision and a boundary row can reappear across pages. Selecting
 * `created_at::text` keeps the full precision for the cursor while the
 * `Date` continues to serve the DTO's ISO timestamp. */
interface ProjectCursorRow extends ProjectRow {
  cursor_ts: string;
}

export interface ProjectDTO {
  id: EntityId<'project'>;
  name: string;
  description: string | null;
  sourceRepo: string | null;
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toProjectDTO(row: ProjectRow): ProjectDTO {
  return {
    id: fromUuid('project', row.id),
    name: row.name,
    description: row.description,
    sourceRepo: row.source_repo,
    organizationId: row.organization_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface ProjectCreateInput {
  name: string;
  description?: string | null;
  sourceRepo?: string | null;
  /** Verified FuzeFront tenant; never supplied by the API body. */
  organizationId: string;
}

export async function createProject(input: ProjectCreateInput, log: ReqLogger, eventContext?: EventContext): Promise<ProjectDTO> {
  const id = mintId('project');
  return withTransaction(async (client) => {
  const { rows } = await client.query<ProjectRow>(
    `insert into design_frames.project (id, name, description, source_repo, organization_id)
     values ($1, $2, $3, $4, $5) returning *`,
    [toUuid(id), input.name, input.description ?? null, input.sourceRepo ?? null, input.organizationId]
  );
  const project = toProjectDTO(rows[0]);
  if (eventContext) await enqueueEvent(client, project.id, makeEvent(FUZE_X_EVENT_TOPICS.projectCreated, eventContext, { projectId: project.id, name: project.name, sourceRepo: project.sourceRepo }));
  return project;
  }, log);
}

export interface ProjectRepositoryDTO {
  repository: string;
  framesPath: string;
  createdAt: string;
}

interface ProjectRepositoryRow {
  id: string;
  project_id: string;
  repository: string;
  frames_path: string;
  created_at: Date;
}

function toProjectRepositoryDTO(row: ProjectRepositoryRow): ProjectRepositoryDTO {
  return { repository: row.repository, framesPath: row.frames_path, createdAt: row.created_at.toISOString() };
}

export async function listProjectRepositories(id: EntityId<'project'>, log: ReqLogger): Promise<ProjectRepositoryDTO[]> {
  const { rows } = await query<ProjectRepositoryRow>(
    `select * from design_frames.project_repository where project_id = $1 order by repository asc`, [toUuid(id)], log
  );
  return rows.map(toProjectRepositoryDTO);
}

export async function connectRepository(
  projectId: EntityId<'project'>, repository: string, framesPath: string, log: ReqLogger, eventContext?: EventContext
): Promise<ProjectRepositoryDTO> {
  const id = mintId('project');
  try {
    return await withTransaction(async (client) => {
    const { rows } = await client.query<ProjectRepositoryRow>(
      `insert into design_frames.project_repository (id, project_id, repository, frames_path)
       values ($1, $2, $3, $4) returning *`,
      [toUuid(id), toUuid(projectId), repository, framesPath]
    );
    const connected = toProjectRepositoryDTO(rows[0]);
    if (eventContext) await enqueueEvent(client, projectId, makeEvent(FUZE_X_EVENT_TOPICS.repositoryConnected, eventContext, { projectId, repository: connected.repository, framesPath: connected.framesPath }));
    return connected;
    }, log);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError(`repository '${repository}' is already connected to an App`);
    }
    throw err;
  }
}

export async function findProjectByRepository(repository: string, log: ReqLogger): Promise<EntityId<'project'> | null> {
  const { rows } = await query<{ project_id: string }>(
    `select project_id from design_frames.project_repository where repository = $1`, [repository], log
  );
  return rows[0] ? fromUuid('project', rows[0].project_id) : null;
}

export async function assignImportedFeaturesForRepository(projectId: EntityId<'project'>, repository: string, log: ReqLogger): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `with updated as (
       update design_frames.feature set project_id = $1
       where source_repo = $2 and project_id is null
       returning id
     ) select count(*)::text as count from updated`,
    [toUuid(projectId), repository], log
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getProjectRowByUuid(uuid: string, log: ReqLogger, organizationId?: string): Promise<ProjectRow | null> {
  const scoped = organizationId ? ` and organization_id = $2` : '';
  const { rows } = await query<ProjectRow>(`select * from design_frames.project where id = $1${scoped}`, organizationId ? [uuid, organizationId] : [uuid], log);
  return rows[0] ?? null;
}

export async function getProject(id: EntityId<'project'>, log: ReqLogger, organizationId?: string): Promise<ProjectDTO> {
  const row = await getProjectRowByUuid(toUuid(id), log, organizationId);
  if (!row) throw new NotFoundError(`project '${id}' not found`);
  return toProjectDTO(row);
}

export interface ProjectPatchInput {
  name?: string;
  description?: string | null;
  sourceRepo?: string | null;
}

export async function patchProject(
  id: EntityId<'project'>,
  patch: ProjectPatchInput,
  log: ReqLogger, eventContext?: EventContext
): Promise<ProjectDTO> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (patch.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(patch.name);
  }
  if (patch.description !== undefined) {
    sets.push(`description = $${i++}`);
    values.push(patch.description);
  }
  if (patch.sourceRepo !== undefined) {
    sets.push(`source_repo = $${i++}`);
    values.push(patch.sourceRepo);
  }
  if (sets.length === 0) {
    return getProject(id, log);
  }
  values.push(toUuid(id));
  return withTransaction(async (client) => {
  const { rows } = await client.query<ProjectRow>(
    `update design_frames.project set ${sets.join(', ')} where id = $${i} returning *`,
    values,
  );
  if (!rows[0]) throw new NotFoundError(`project '${id}' not found`);
  const project = toProjectDTO(rows[0]);
  if (eventContext) await enqueueEvent(client, project.id, makeEvent(FUZE_X_EVENT_TOPICS.projectUpdated, eventContext, { projectId: project.id, changed: Object.keys(patch).filter((key) => patch[key as keyof ProjectPatchInput] !== undefined) }));
  return project;
  }, log);
}

export async function listProjects(page: PageParams, log: ReqLogger, organizationId?: string): Promise<Page<ProjectDTO>> {
  const params: unknown[] = [];
  let where = '';
  if (organizationId) {
    params.push(organizationId);
    where = `where organization_id = $1`;
  }
  if (page.cursor) {
    const { v, id } = decodeCursor(page.cursor);
    // Bind the full-precision cursor text back as an explicit timestamptz so
    // the row comparison compares at the same microsecond precision Postgres
    // stores, rather than relying on an implicit/ambiguous cast.
    params.push(v, toUuid(id as EntityId<'project'>));
    where += `${where ? ' and' : 'where'} (created_at, id) > ($${params.length - 1}::timestamptz, $${params.length})`;
  }
  params.push(page.limit + 1);
  const { rows } = await query<ProjectCursorRow>(
    `select *, created_at::text as cursor_ts from design_frames.project ${where}
     order by created_at asc, id asc limit $${params.length}`,
    params,
    log
  );
  return buildPage(
    rows,
    page.limit,
    toProjectDTO,
    (row) => ({ v: row.cursor_ts, id: fromUuid('project', row.id) })
  );
}

export async function listFeatureIdsByProject(
  projectUuid: string,
  log: ReqLogger
): Promise<Array<{ slug: string; created_at: Date; id: string }>> {
  const { rows } = await query<{ slug: string; created_at: Date; id: string }>(
    `select id, slug, created_at from design_frames.feature where project_id = $1 order by created_at asc, id asc`,
    [projectUuid],
    log
  );
  return rows;
}
