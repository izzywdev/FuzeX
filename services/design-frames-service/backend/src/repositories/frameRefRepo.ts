// frameRefRepo.ts — design_frames.frame_ref (fxdf_frm_*). REF ONLY — never
// holds HTML (db/migrations/0006_create_frame_ref.sql). Idempotent upsert
// keyed on the table's own UNIQUE (feature_id, file, content_stamp).

import { query } from '../lib/db';
import { mintId, toUuid } from '../lib/identity';
import type { ReqLogger } from '../lib/logger';

export interface FrameRefRow {
  id: string;
  feature_id: string;
  flow_id: string | null;
  file: string;
  content_stamp: string;
  created_at: Date;
}

export async function upsertFrameRef(
  featureId: string,
  flowId: string | null,
  file: string,
  contentStamp: string,
  log: ReqLogger
): Promise<FrameRefRow> {
  const id = mintId('frameRef');
  const { rows } = await query<FrameRefRow>(
    `insert into design_frames.frame_ref (id, feature_id, flow_id, file, content_stamp)
     values ($1, $2, $3, $4, $5)
     on conflict (feature_id, file, content_stamp) do update set flow_id = excluded.flow_id
     returning *`,
    [toUuid(id), featureId, flowId, file, contentStamp],
    log
  );
  return rows[0];
}

export async function listByFeature(featureId: string, log: ReqLogger): Promise<FrameRefRow[]> {
  const { rows } = await query<FrameRefRow>(
    `select * from design_frames.frame_ref where feature_id = $1`,
    [featureId],
    log
  );
  return rows;
}

export interface ManifestFrameForIndexing {
  file: string;
  flow?: string;
}

/**
 * Upserts one frame_ref row per frame declared in the feature's manifest, at
 * the given content stamp — the LIVE-route counterpart to
 * scripts/backfill.ts's identical loop, so `frame`/`element` discussion
 * targets (DiscussionTargetType, docs/postgres-tier.md) become discoverable
 * via the running API instead of only after an out-of-band backfill run.
 * Idempotent (the table's own UNIQUE (feature_id, file, content_stamp)
 * upsert-no-op), so calling this on every stamp write is safe.
 */
export async function indexFrameRefsFromManifest(
  featureId: string,
  frames: ManifestFrameForIndexing[],
  flowIdByKey: Map<string, string>,
  contentStamp: string,
  log: ReqLogger
): Promise<number> {
  let count = 0;
  for (const frame of frames) {
    const flowId = frame.flow ? (flowIdByKey.get(frame.flow) ?? null) : null;
    await upsertFrameRef(featureId, flowId, frame.file, contentStamp, log);
    count += 1;
  }
  return count;
}
