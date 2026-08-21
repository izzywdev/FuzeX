// projectRepo.ts — design_frames.project (fxdf_prj_*).

import { query } from '../lib/db';
import { mintId, toUuid, fromUuid, type EntityId } from '../lib/identity';
import { NotFoundError } from '../lib/errors';
import { buildPage, decodeCursor, type Page, type PageParams } from '../lib/pagination';
import type { ReqLogger } from '../lib/logger';

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  source_repo: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProjectDTO {
  id: EntityId<'project'>;
  name: string;
  description: string | null;
  sourceRepo: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toProjectDTO(row: ProjectRow): ProjectDTO {
  return {
    id: fromUuid('project', row.id),
    name: row.name,
    description: row.description,
    sourceRepo: row.source_repo,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface ProjectCreateInput {
  name: string;
  description?: string | null;
  sourceRepo?: string | null;
}

export async function createProject(input: ProjectCreateInput, log: ReqLogger): Promise<ProjectDTO> {
  const id = mintId('project');
  const { rows } = await query<ProjectRow>(
    `insert into design_frames.project (id, name, description, source_repo)
     values ($1, $2, $3, $4) returning *`,
    [toUuid(id), input.name, input.description ?? null, input.sourceRepo ?? null],
    log
  );
  return toProjectDTO(rows[0]);
}

export async function getProjectRowByUuid(uuid: string, log: ReqLogger): Promise<ProjectRow | null> {
  const { rows } = await query<ProjectRow>(`select * from design_frames.project where id = $1`, [uuid], log);
  return rows[0] ?? null;
}

export async function getProject(id: EntityId<'project'>, log: ReqLogger): Promise<ProjectDTO> {
  const row = await getProjectRowByUuid(toUuid(id), log);
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
  log: ReqLogger
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
  const { rows } = await query<ProjectRow>(
    `update design_frames.project set ${sets.join(', ')} where id = $${i} returning *`,
    values,
    log
  );
  if (!rows[0]) throw new NotFoundError(`project '${id}' not found`);
  return toProjectDTO(rows[0]);
}

export async function listProjects(page: PageParams, log: ReqLogger): Promise<Page<ProjectDTO>> {
  const params: unknown[] = [];
  let where = '';
  if (page.cursor) {
    const { v, id } = decodeCursor(page.cursor);
    params.push(v, toUuid(id as EntityId<'project'>));
    where = `where (created_at, id) > ($1, $2)`;
  }
  params.push(page.limit + 1);
  const { rows } = await query<ProjectRow>(
    `select * from design_frames.project ${where} order by created_at asc, id asc limit $${params.length}`,
    params,
    log
  );
  return buildPage(
    rows,
    page.limit,
    toProjectDTO,
    (row) => ({ v: row.created_at.toISOString(), id: fromUuid('project', row.id) })
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
