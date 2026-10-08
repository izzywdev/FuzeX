import { query, withTransaction } from '../lib/db';
import { fromUuid, toUuid, type EntityId } from '../lib/identity';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { buildPage, decodeCursor, type Page, type PageParams } from '../lib/pagination';
import type { ReqLogger } from '../lib/logger';
import type { DesignSystemComponent, DesignSystemRevisionInput } from '../lib/designSystem';

interface RevisionRow {
  project_id: string;
  revision: number;
  name: string;
  description: string | null;
  tokens: Record<string, unknown>;
  components: DesignSystemComponent[];
  created_by: string;
  created_at: Date;
}

export interface DesignSystemRevisionDTO {
  projectId: EntityId<'project'>;
  revision: number;
  name: string;
  description: string | null;
  tokens: Record<string, unknown>;
  components: DesignSystemComponent[];
  createdBy: string;
  createdAt: string;
}

function toDTO(row: RevisionRow): DesignSystemRevisionDTO {
  return {
    projectId: fromUuid('project', row.project_id), revision: row.revision,
    name: row.name, description: row.description, tokens: row.tokens,
    components: row.components, createdBy: row.created_by, createdAt: row.created_at.toISOString(),
  };
}

export async function getDesignSystemRevision(
  projectId: EntityId<'project'>, revision: number | null, log: ReqLogger
): Promise<DesignSystemRevisionDTO | null> {
  const { rows } = await query<RevisionRow>(
    `select * from design_frames.design_system_revision where project_id = $1
     ${revision === null ? '' : 'and revision = $2'} order by revision desc limit 1`,
    revision === null ? [toUuid(projectId)] : [toUuid(projectId), revision], log
  );
  return rows[0] ? toDTO(rows[0]) : null;
}

export async function listDesignSystemRevisions(
  projectId: EntityId<'project'>, page: PageParams, log: ReqLogger
): Promise<Page<DesignSystemRevisionDTO>> {
  let after = 0;
  if (page.cursor) {
    const payload = decodeCursor(page.cursor);
    after = Number(payload.v);
    if (payload.id !== projectId || !Number.isSafeInteger(after) || after < 1 || after > 2147483647) {
      throw new ValidationError('invalid design system revision cursor');
    }
  }
  const { rows } = await query<RevisionRow>(
    `select * from design_frames.design_system_revision where project_id = $1 and revision > $2
     order by revision asc limit $3`, [toUuid(projectId), after, page.limit + 1], log
  );
  return buildPage(rows, page.limit, toDTO, (row) => ({ v: String(row.revision), id: projectId }));
}

export async function createDesignSystemRevision(
  projectId: EntityId<'project'>, input: DesignSystemRevisionInput, createdBy: string, log: ReqLogger
): Promise<DesignSystemRevisionDTO> {
  return withTransaction(async (client) => {
    // Serialize all writers for this project, including the very first revision.
    const project = await client.query('select id from design_frames.project where id = $1 for update', [toUuid(projectId)]);
    if (!project.rows.length) throw new NotFoundError(`project '${projectId}' not found`);
    const current = await client.query<{ revision: number }>(
      'select revision from design_frames.design_system_revision where project_id = $1 order by revision desc limit 1',
      [toUuid(projectId)]
    );
    const currentRevision = current.rows[0]?.revision ?? 0;
    if (currentRevision !== input.expectedRevision) {
      throw new ConflictError(`design system has revision ${currentRevision}; expected ${input.expectedRevision}`);
    }
    const { rows } = await client.query<RevisionRow>(
      `insert into design_frames.design_system_revision
       (project_id, revision, name, description, tokens, components, created_by)
       values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) returning *`,
      [toUuid(projectId), currentRevision + 1, input.name, input.description,
        JSON.stringify(input.tokens), JSON.stringify(input.components), createdBy]
    );
    return toDTO(rows[0]);
  }, log);
}
