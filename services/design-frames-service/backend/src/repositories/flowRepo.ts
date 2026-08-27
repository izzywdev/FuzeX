// flowRepo.ts — design_frames.flow. Internal fxdf_flw_* row; the wire
// {flowId} path param is flow_key (the pre-existing manifest
// build.flows[].id string — see db/migrations/0005_create_flow.sql).
// Create-on-first-use: a flow is not explicitly POSTed, it is materialized
// the first time it is approved/rejected/queried.

import { query } from '../lib/db';
import { mintId, toUuid } from '../lib/identity';
import type { ReqLogger } from '../lib/logger';

const UNIQUE_VIOLATION = '23505';

export interface FlowRow {
  id: string;
  feature_id: string;
  flow_key: string;
  created_at: Date;
  updated_at: Date;
}

export async function findFlow(featureId: string, flowKey: string, log: ReqLogger): Promise<FlowRow | null> {
  const { rows } = await query<FlowRow>(
    `select * from design_frames.flow where feature_id = $1 and flow_key = $2`,
    [featureId, flowKey],
    log
  );
  return rows[0] ?? null;
}

export async function findOrCreateFlow(featureId: string, flowKey: string, log: ReqLogger): Promise<FlowRow> {
  const existing = await findFlow(featureId, flowKey, log);
  if (existing) return existing;
  const id = mintId('flow');
  try {
    const { rows } = await query<FlowRow>(
      `insert into design_frames.flow (id, feature_id, flow_key) values ($1, $2, $3) returning *`,
      [toUuid(id), featureId, flowKey],
      log
    );
    return rows[0];
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      const retry = await findFlow(featureId, flowKey, log);
      if (retry) return retry;
    }
    throw err;
  }
}

export async function listFlowsByFeature(featureId: string, log: ReqLogger): Promise<FlowRow[]> {
  const { rows } = await query<FlowRow>(
    `select * from design_frames.flow where feature_id = $1`,
    [featureId],
    log
  );
  return rows;
}
