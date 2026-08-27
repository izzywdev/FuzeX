// approvalRepo.ts — design_frames.approval (fxdf_apr_*). APPEND-ONLY: every
// write is an INSERT; the table's forbid_mutation() trigger
// (db/migrations/0002_functions.sql) rejects UPDATE/DELETE at the database
// layer, so this repository never attempts either.

import { query } from '../lib/db';
import { mintId, toUuid, fromUuid, type EntityId } from '../lib/identity';
import type { ReqLogger } from '../lib/logger';
import { buildPage, decodeCursor, type Page, type PageParams } from '../lib/pagination';

export type Decision = 'approve' | 'reject';
export type ActorType = 'user' | 'agent';

export interface ApprovalRow {
  id: string;
  flow_id: string;
  decision: Decision;
  actor_ref: string;
  actor_type: ActorType;
  content_stamp: string | null;
  reason: string | null;
  decided_at: Date;
}

/** `ApprovalRow` plus the full microsecond-precision text rendering of
 * `decided_at`, used ONLY for the pagination cursor (see projectRepo.ts for
 * why: `pg` parses timestamptz into a millisecond JS Date, losing the
 * microsecond precision Postgres actually stores it at). */
interface ApprovalCursorRow extends ApprovalRow {
  cursor_ts: string;
}

export interface ApprovalDTO {
  id: EntityId<'approval'>;
  slug: string;
  flowId: string;
  decision: Decision;
  actorRef: string;
  actorType: ActorType;
  contentStamp: string | null;
  reason: string | null;
  decidedAt: string;
}

export function toApprovalDTO(row: ApprovalRow, slug: string, flowKey: string): ApprovalDTO {
  return {
    id: fromUuid('approval', row.id),
    slug,
    flowId: flowKey,
    decision: row.decision,
    actorRef: row.actor_ref,
    actorType: row.actor_type,
    contentStamp: row.content_stamp,
    reason: row.reason,
    decidedAt: row.decided_at.toISOString(),
  };
}

export interface InsertApprovalInput {
  flowId: string;
  decision: Decision;
  actorRef: string;
  actorType: ActorType;
  contentStamp: string | null;
  reason: string | null;
}

export async function insertApproval(input: InsertApprovalInput, log: ReqLogger): Promise<ApprovalRow> {
  const id = mintId('approval');
  const { rows } = await query<ApprovalRow>(
    `insert into design_frames.approval (id, flow_id, decision, actor_ref, actor_type, content_stamp, reason)
     values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [toUuid(id), input.flowId, input.decision, input.actorRef, input.actorType, input.contentStamp, input.reason],
    log
  );
  return rows[0];
}

export async function latestApproval(flowId: string, log: ReqLogger): Promise<ApprovalRow | null> {
  const { rows } = await query<ApprovalRow>(
    `select * from design_frames.approval where flow_id = $1 order by decided_at desc, id desc limit 1`,
    [flowId],
    log
  );
  return rows[0] ?? null;
}

/** Latest approval per flow, for every flow of a feature — used to project the manifest. */
export async function latestApprovalsByFeature(
  featureId: string,
  log: ReqLogger
): Promise<Map<string, ApprovalRow & { flow_key: string }>> {
  const { rows } = await query<ApprovalRow & { flow_key: string }>(
    `select distinct on (f.flow_key) a.*, f.flow_key
       from design_frames.approval a
       join design_frames.flow f on f.id = a.flow_id
      where f.feature_id = $1
      order by f.flow_key, a.decided_at desc, a.id desc`,
    [featureId],
    log
  );
  return new Map(rows.map((r) => [r.flow_key, r]));
}

export async function listApprovals(
  flowId: string,
  slug: string,
  flowKey: string,
  page: PageParams,
  log: ReqLogger
): Promise<Page<ApprovalDTO>> {
  const params: unknown[] = [flowId];
  let extraWhere = '';
  if (page.cursor) {
    const { v, id } = decodeCursor(page.cursor);
    params.push(v, toUuid(id as EntityId<'approval'>));
    // Explicit ::timestamptz cast — the cursor's `v` carries FULL
    // microsecond precision (see cursor_ts below), so bind it back at that
    // same precision rather than relying on an implicit/ambiguous cast.
    extraWhere = ` and (decided_at, id) < ($2::timestamptz, $3)`; // newest-first: strictly older than the cursor row
  }
  params.push(page.limit + 1);
  const { rows } = await query<ApprovalCursorRow>(
    `select *, decided_at::text as cursor_ts from design_frames.approval where flow_id = $1${extraWhere}
     order by decided_at desc, id desc limit $${params.length}`,
    params,
    log
  );
  return buildPage(
    rows,
    page.limit,
    (row) => toApprovalDTO(row, slug, flowKey),
    (row) => ({ v: row.cursor_ts, id: fromUuid('approval', row.id) })
  );
}
