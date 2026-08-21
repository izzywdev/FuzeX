#!/usr/bin/env node
// scripts/backfill.ts — docs/postgres-tier.md "Migration path" step 4.
//
// Walks data/features/** (via ../lib/fileStore, i.e. lib/store.js), computes
// each feature's content stamp (../lib/stampLib, i.e. lib/stamp.js), and
// seeds project/feature/flow/frame_ref rows + one approval row per
// already-approved flow (stamp = the feature's current stamp) — so a
// feature that existed before this tier is queryable through it without
// waiting for its next write.
//
// Idempotent: feature/flow lookups are find-or-create, frame_ref upsert is
// keyed on its own UNIQUE (feature_id, file, content_stamp), and the
// approval seed is skipped if an approval already exists for that flow (so
// re-running the backfill after real approvals have started flowing through
// the API does not inject a duplicate synthetic one).
//
// Usage: DATABASE_URL=... npm run backfill   (see package.json)

import * as fileStore from '../lib/fileStore';
import { computeStamp } from '../lib/stampLib';
import { query, closePool } from '../lib/db';
import { mintId, toUuid } from '../lib/identity';
import { logger } from '../lib/logger';
import * as featureRepo from '../repositories/featureRepo';
import * as flowRepo from '../repositories/flowRepo';
import * as frameRefRepo from '../repositories/frameRefRepo';
import * as approvalRepo from '../repositories/approvalRepo';

interface ManifestFlow {
  id: string;
  approved?: boolean;
  approvedBy?: string | null;
  approvedAt?: string | null;
}
interface ManifestFrame {
  file: string;
  flow?: string;
}
interface Manifest {
  frames?: ManifestFrame[];
  build?: { flows?: ManifestFlow[] };
}

async function backfillFeature(slug: string): Promise<{ slug: string; flows: number; approvals: number; frames: number }> {
  const featureRow = await featureRepo.findOrCreateFeatureBySlug(slug, logger);
  const feature = await fileStore.getFeature(slug);
  const stamp = computeStamp(feature);
  const manifest = feature.manifest as Manifest;
  const flows = manifest.build?.flows ?? [];
  const frames = manifest.frames ?? [];

  const flowRowByKey = new Map<string, { id: string }>();
  for (const flow of flows) {
    const flowRow = await flowRepo.findOrCreateFlow(featureRow.id, flow.id, logger);
    flowRowByKey.set(flow.id, flowRow);
  }

  let frameCount = 0;
  for (const frame of frames) {
    const flowRow = frame.flow ? flowRowByKey.get(frame.flow) ?? null : null;
    await frameRefRepo.upsertFrameRef(featureRow.id, flowRow?.id ?? null, frame.file, stamp, logger);
    frameCount++;
  }

  let approvalCount = 0;
  for (const flow of flows) {
    if (!flow.approved) continue;
    const flowRow = flowRowByKey.get(flow.id)!;
    const existing = await approvalRepo.latestApproval(flowRow.id, logger);
    if (existing) continue; // already has real history — never inject a synthetic duplicate
    const id = mintId('approval');
    await query(
      `insert into design_frames.approval (id, flow_id, decision, actor_ref, actor_type, content_stamp, reason, decided_at)
       values ($1, $2, 'approve', $3, 'user', $4, null, $5)`,
      [
        toUuid(id),
        flowRow.id,
        flow.approvedBy || 'backfill-unknown-actor',
        stamp,
        flow.approvedAt ? new Date(flow.approvedAt) : new Date(),
      ],
      logger
    );
    approvalCount++;
  }

  return { slug, flows: flows.length, approvals: approvalCount, frames: frameCount };
}

export async function runBackfill(): Promise<void> {
  const summaries = await fileStore.listFeatures();
  logger.info({ count: summaries.length }, 'backfill: starting');
  const results = [];
  for (const summary of summaries) {
    try {
      const result = await backfillFeature(summary.slug);
      logger.info(result, 'backfill: feature indexed');
      results.push(result);
    } catch (err) {
      logger.error({ err, slug: summary.slug }, 'backfill: feature failed');
    }
  }
  logger.info({ total: results.length }, 'backfill: complete');
}

if (require.main === module) {
  runBackfill()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'backfill: fatal');
      process.exit(1);
    });
}
