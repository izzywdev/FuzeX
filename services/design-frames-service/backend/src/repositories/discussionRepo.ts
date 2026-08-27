// discussionRepo.ts — design_frames.discussion (fxdf_dsc_*). Polymorphic
// target (target_type, target_ref) — always resolved as the pair, never a
// bare target_ref lookup (identifier-standard.md §3).

import { query } from '../lib/db';
import { mintId, toUuid, fromUuid, type EntityId } from '../lib/identity';
import { NotFoundError } from '../lib/errors';
import type { ReqLogger } from '../lib/logger';
import { buildPage, decodeCursor, type Page, type PageParams } from '../lib/pagination';
import type { DiscussionTargetType } from '../lib/identity';

export interface DiscussionRow {
  id: string;
  target_type: DiscussionTargetType;
  target_ref: string;
  target_selector: string | null;
  title: string | null;
  resolved: boolean;
  created_at: Date;
  updated_at: Date;
}

/** `DiscussionRow` plus the full microsecond-precision text rendering of
 * `created_at`, used ONLY for the pagination cursor (see projectRepo.ts for
 * why: `pg` parses timestamptz into a millisecond JS Date, losing the
 * microsecond precision Postgres actually stores it at). */
interface DiscussionCursorRow extends DiscussionRow {
  cursor_ts: string;
}

export interface DiscussionDTO {
  id: EntityId<'discussion'>;
  targetType: DiscussionTargetType;
  targetRef: string;
  targetSelector: string | null;
  title: string | null;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toDiscussionDTO(row: DiscussionRow, targetRefWire: string): DiscussionDTO {
  return {
    id: fromUuid('discussion', row.id),
    targetType: row.target_type,
    targetRef: targetRefWire,
    targetSelector: row.target_selector,
    title: row.title,
    resolved: row.resolved,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface DiscussionCreateInput {
  targetType: DiscussionTargetType;
  targetRefUuid: string;
  targetSelector: string | null;
  title: string | null;
}

export async function createDiscussion(input: DiscussionCreateInput, log: ReqLogger): Promise<DiscussionRow> {
  const id = mintId('discussion');
  const { rows } = await query<DiscussionRow>(
    `insert into design_frames.discussion (id, target_type, target_ref, target_selector, title)
     values ($1, $2, $3, $4, $5) returning *`,
    [toUuid(id), input.targetType, input.targetRefUuid, input.targetSelector, input.title],
    log
  );
  return rows[0];
}

export async function getDiscussionRowByUuid(uuid: string, log: ReqLogger): Promise<DiscussionRow | null> {
  const { rows } = await query<DiscussionRow>(`select * from design_frames.discussion where id = $1`, [uuid], log);
  return rows[0] ?? null;
}

export async function getDiscussion(id: EntityId<'discussion'>, log: ReqLogger): Promise<DiscussionRow> {
  const row = await getDiscussionRowByUuid(toUuid(id), log);
  if (!row) throw new NotFoundError(`discussion '${id}' not found`);
  return row;
}

export async function setResolved(
  id: EntityId<'discussion'>,
  resolved: boolean,
  log: ReqLogger
): Promise<DiscussionRow> {
  const { rows } = await query<DiscussionRow>(
    `update design_frames.discussion set resolved = $1 where id = $2 returning *`,
    [resolved, toUuid(id)],
    log
  );
  if (!rows[0]) throw new NotFoundError(`discussion '${id}' not found`);
  return rows[0];
}

export async function listByTarget(
  targetType: DiscussionTargetType,
  targetRefUuid: string,
  resolved: boolean | null,
  page: PageParams,
  log: ReqLogger
): Promise<Page<DiscussionRow>> {
  const params: unknown[] = [targetType, targetRefUuid];
  let extraWhere = '';
  if (resolved !== null) {
    params.push(resolved);
    extraWhere += ` and resolved = $${params.length}`;
  }
  if (page.cursor) {
    const { v, id } = decodeCursor(page.cursor);
    params.push(v, toUuid(id as EntityId<'discussion'>));
    // Explicit ::timestamptz cast — the cursor's `v` carries FULL
    // microsecond precision (see cursor_ts below), so bind it back at that
    // same precision rather than relying on an implicit/ambiguous cast.
    extraWhere += ` and (created_at, id) > ($${params.length - 1}::timestamptz, $${params.length})`;
  }
  params.push(page.limit + 1);
  const { rows } = await query<DiscussionCursorRow>(
    `select *, created_at::text as cursor_ts from design_frames.discussion where target_type = $1 and target_ref = $2${extraWhere}
     order by created_at asc, id asc limit $${params.length}`,
    params,
    log
  );
  return buildPage(
    rows,
    page.limit,
    (row) => row,
    (row) => ({ v: row.cursor_ts, id: fromUuid('discussion', row.id) })
  );
}
