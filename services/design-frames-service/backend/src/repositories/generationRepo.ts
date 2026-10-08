import { query, withTransaction } from '../lib/db';
import { mintId, toUuid } from '../lib/identity';
import { NotFoundError, ConflictError } from '../lib/errors';
import type { ReqLogger } from '../lib/logger';
import { generateDraft, type GeneratedDraft } from '../lib/generationLib';

export interface GenerationRow {
  id: string;
  feature_id: string;
  status: 'draft' | 'applied' | 'dismissed';
  base_stamp: string;
  result_stamp: string | null;
  actor_ref: string;
  draft: GeneratedDraft;
  created_at: Date;
  updated_at: Date;
}

type StoredGenerationRow = Omit<GenerationRow, 'draft'> & {
  draft: Omit<GeneratedDraft, 'frames'> & { frames: Array<Omit<GeneratedDraft['frames'][number], 'html'>> };
};

function hydrate(row: StoredGenerationRow): GenerationRow {
  // v1 is a frozen deterministic provider. Postgres stores inputs and descriptor
  // metadata only; frame bytes belong to the immutable content tier upon apply.
  if (row.draft.engine !== 'deterministic-wireframe-v1') throw new ConflictError('generation provider version is not available');
  const draft = generateDraft(row.draft.brief, { baseStamp: row.base_stamp, designSystem: row.draft.designSystem });
  return { ...row, draft };
}

export async function createGeneration(featureId: string, draft: GeneratedDraft, actorRef: string, log: ReqLogger): Promise<GenerationRow> {
  const stored = { ...draft, frames: draft.frames.map(({ html: _html, ...frame }) => frame) };
  const { rows } = await query<StoredGenerationRow>(
    `insert into design_frames.generation (id, feature_id, base_stamp, actor_ref, draft) values ($1,$2,$3,$4,$5) returning *`,
    [toUuid(mintId('generation')), featureId, draft.baseStamp, actorRef, JSON.stringify(stored)], log
  );
  return hydrate(rows[0]);
}

export async function listGenerations(featureId: string, log: ReqLogger): Promise<GenerationRow[]> {
  const { rows } = await query<StoredGenerationRow>(
    `select * from design_frames.generation where feature_id=$1 order by created_at desc, id desc limit 100`, [featureId], log
  );
  return rows.map(hydrate);
}

export async function getGeneration(featureId: string, id: string, log: ReqLogger): Promise<GenerationRow> {
  const { rows } = await query<StoredGenerationRow>(`select * from design_frames.generation where feature_id=$1 and id=$2`, [featureId, id], log);
  if (!rows[0]) throw new NotFoundError('generation not found in feature');
  return hydrate(rows[0]);
}

/** Serialize transitions so a simultaneous dismissal cannot race publication. */
export async function transitionGeneration(
  featureId: string, id: string,
  transition: (row: GenerationRow) => Promise<{ status: GenerationRow['status']; resultStamp: string | null }>,
  log: ReqLogger
): Promise<GenerationRow> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<StoredGenerationRow>(
      `select * from design_frames.generation where feature_id=$1 and id=$2 for update`, [featureId, id]
    );
    if (!rows[0]) throw new NotFoundError('generation not found in feature');
    const next = await transition(hydrate(rows[0]));
    const updated = await client.query<StoredGenerationRow>(
      `update design_frames.generation set status=$3, result_stamp=$4 where feature_id=$1 and id=$2 returning *`,
      [featureId, id, next.status, next.resultStamp]
    );
    return hydrate(updated.rows[0]);
  }, log);
}
