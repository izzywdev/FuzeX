// routes/features.ts — the v0.1.0 /api/v1/features/** surface, projected
// from the new model (docs/postgres-tier.md "Backward-compatibility"), PLUS
// the v0.2.0 extensions: optional projectId on create, contentStamp-bound
// approve/reject, and the paginated approvals history.

import { Router, type Request } from 'express';
import * as fileStore from '../lib/fileStore';
import { computeStamp } from '../lib/stampLib';
import { validateManifest } from '../lib/manifestSchema';
import { projectManifest, type LatestApprovalForFlow } from '../lib/projection';
import { assertRef, type EntityId } from '../lib/identity';
import * as featureRepo from '../repositories/featureRepo';
import * as flowRepo from '../repositories/flowRepo';
import * as approvalRepo from '../repositories/approvalRepo';
import * as projectRepo from '../repositories/projectRepo';
import { ConflictError, StampConflictError, ValidationError } from '../lib/errors';
import { parsePageParams } from '../lib/pagination';
import type { LoggedRequest } from '../lib/logger';

export const featuresRouter = Router();

function log(req: Request) {
  return (req as LoggedRequest).log!;
}

async function latestApprovalsAsProjectionInput(
  featureId: string,
  reqLog: ReturnType<typeof log>
): Promise<Map<string, LatestApprovalForFlow>> {
  const rows = await approvalRepo.latestApprovalsByFeature(featureId, reqLog);
  const out = new Map<string, LatestApprovalForFlow>();
  for (const [flowKey, row] of rows) {
    out.set(flowKey, {
      decision: row.decision,
      actorRef: row.actor_ref,
      decidedAt: row.decided_at.toISOString(),
    });
  }
  return out;
}

// GET /api/v1/features — byte-compatible with v0.1.0 (unpaginated {features:[...]}).
featuresRouter.get('/', async (_req, res) => {
  res.status(200).json({ features: await fileStore.listFeatures() });
});

// POST /api/v1/features — extended with optional projectId (a REFERENCE, not identity).
featuresRouter.post('/', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { slug, name, description, designSystem, entry, sourceRepo, projectId } = body;
  if (!slug || typeof slug !== 'string') throw new ValidationError('slug is required');

  let projectRefId: EntityId<'project'> | null = null;
  if (projectId !== undefined && projectId !== null) {
    try {
      projectRefId = assertRef('project', projectId);
    } catch {
      throw new ValidationError('projectId is not a valid project id');
    }
    // Existence check — a reference to a project that does not exist is a 404, not a silent orphan.
    await projectRepo.getProject(projectRefId, log(req));
  }

  const manifest = {
    name: (name as string) || slug,
    description: (description as string) || '',
    designSystem: (designSystem as string) || 'fuse-seam (@fuzefront/design-system)',
    entry: (entry as string) || 'index.html',
    sourceRepo: (sourceRepo as string | null) || null,
    frames: [],
    build: { flows: [] },
  };
  const errors = validateManifest(manifest);
  if (errors.length) throw new ValidationError('manifest validation failed', errors);

  if (await fileStore.featureExists(slug)) {
    throw new ConflictError(`feature '${slug}' already exists`);
  }

  const feature = await fileStore.createFeature(slug, manifest);
  await featureRepo.createFeatureRow(slug, projectRefId, log(req));
  res.status(201).json({ slug: feature.slug, manifest: feature.manifest });
});

// GET /api/v1/features/:slug — manifest + frame contents, with
// build.flows[].approved* PROJECTED from the latest Postgres approval row.
featuresRouter.get('/:slug', async (req, res) => {
  const feature = await fileStore.getFeature(req.params.slug);
  const featureRow = await featureRepo.findFeatureBySlug(req.params.slug, log(req));
  const latest = featureRow ? await latestApprovalsAsProjectionInput(featureRow.id, log(req)) : new Map();
  const manifest = projectManifest(feature.manifest, latest);
  res.status(200).json({ slug: req.params.slug, manifest, frames: Object.fromEntries(feature.frames) });
});

// PUT /api/v1/features/:slug/manifest
featuresRouter.put('/:slug/manifest', async (req, res) => {
  const errors = validateManifest(req.body);
  if (errors.length) throw new ValidationError('manifest validation failed', errors);
  const feature = await fileStore.putManifest(req.params.slug, req.body);
  res.status(200).json({ slug: req.params.slug, manifest: feature.manifest });
});

// GET /api/v1/features/:slug/stamp — read-only.
featuresRouter.get('/:slug/stamp', async (req, res) => {
  const feature = await fileStore.getFeature(req.params.slug);
  const stamp = computeStamp(feature);
  res.status(200).json({
    slug: req.params.slug,
    stamp,
    manifestStamp: (feature.manifest.stamp as string | undefined) ?? null,
    current: stamp === feature.manifest.stamp,
  });
});

// POST /api/v1/features/:slug/stamp — compute AND persist.
featuresRouter.post('/:slug/stamp', async (req, res) => {
  const feature = await fileStore.getFeature(req.params.slug);
  const stamp = computeStamp(feature);
  await fileStore.setStamp(req.params.slug, stamp);
  res.status(200).json({ slug: req.params.slug, stamp });
});

// POST /api/v1/features/:slug/verify-stamp
featuresRouter.post('/:slug/verify-stamp', async (req, res) => {
  const feature = await fileStore.getFeature(req.params.slug);
  const expected = computeStamp(feature);
  res.status(200).json({ slug: req.params.slug, valid: req.body?.stamp === expected, expected });
});

// .../frames/:file
featuresRouter.get('/:slug/frames/:file', async (req, res) => {
  const html = await fileStore.getFrame(req.params.slug, decodeURIComponent(req.params.file));
  res.status(200).json({ slug: req.params.slug, file: req.params.file, html });
});
featuresRouter.put('/:slug/frames/:file', async (req, res) => {
  const html = req.body?.html;
  if (typeof html !== 'string') throw new ValidationError('html (string) is required');
  await fileStore.putFrame(req.params.slug, decodeURIComponent(req.params.file), html);
  res.status(200).json({ slug: req.params.slug, file: req.params.file, bytes: Buffer.byteLength(html, 'utf8') });
});
featuresRouter.delete('/:slug/frames/:file', async (req, res) => {
  await fileStore.deleteFrame(req.params.slug, decodeURIComponent(req.params.file));
  res.status(204).send();
});

// POST /api/v1/features/:slug/flows/:flowId/approve — append-only, stamp-bound.
featuresRouter.post('/:slug/flows/:flowId/approve', async (req, res) => {
  const { slug } = req.params;
  const flowKey = decodeURIComponent(req.params.flowId);
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.approvedBy !== 'string' || body.approvedBy.length === 0) {
    throw new ValidationError('approvedBy is required');
  }
  const actorType = body.actorType === 'agent' ? 'agent' : 'user';
  const contentStamp = typeof body.contentStamp === 'string' ? body.contentStamp : null;

  const featureRow = await featureRepo.requireFeatureRowBySlug(slug, log(req));
  const feature = await fileStore.getFeature(slug);
  const currentStamp = computeStamp(feature);
  if (contentStamp !== null && contentStamp !== currentStamp) {
    throw new StampConflictError(currentStamp, contentStamp);
  }

  const flow = await flowRepo.findOrCreateFlow(featureRow.id, flowKey, log(req));
  const decidedAt = new Date();
  const row = await approvalRepo.insertApproval(
    { flowId: flow.id, decision: 'approve', actorRef: body.approvedBy, actorType, contentStamp, reason: null },
    log(req)
  );

  // Dual-write: keep the flat-file projection in sync for any legacy reader.
  await fileStore
    .setFlowApproval(slug, flowKey, { approved: true, approvedBy: body.approvedBy, approvedAt: decidedAt.toISOString() })
    .catch((err) => {
      // A flow the manifest never declared (e.g. approved purely through this
      // tier before the manifest lists it) has nothing to project onto in the
      // file — the Postgres row (the source of truth) still recorded fine.
      log(req).warn({ err, slug, flowKey }, 'dual-write: flat-file flow projection skipped (flow not in manifest)');
    });

  res.status(200).json(approvalRepo.toApprovalDTO(row, slug, flowKey));
});

// POST /api/v1/features/:slug/flows/:flowId/reject — reason now REQUIRED (v0.2.0).
featuresRouter.post('/:slug/flows/:flowId/reject', async (req, res) => {
  const { slug } = req.params;
  const flowKey = decodeURIComponent(req.params.flowId);
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
    throw new ValidationError('reason is required');
  }
  const actorRef = typeof body.rejectedBy === 'string' ? body.rejectedBy : 'unknown';
  const actorType = body.actorType === 'agent' ? 'agent' : 'user';
  const contentStamp = typeof body.contentStamp === 'string' ? body.contentStamp : null;

  const featureRow = await featureRepo.requireFeatureRowBySlug(slug, log(req));
  if (contentStamp !== null) {
    const feature = await fileStore.getFeature(slug);
    const currentStamp = computeStamp(feature);
    if (contentStamp !== currentStamp) throw new StampConflictError(currentStamp, contentStamp);
  }

  const flow = await flowRepo.findOrCreateFlow(featureRow.id, flowKey, log(req));
  const row = await approvalRepo.insertApproval(
    { flowId: flow.id, decision: 'reject', actorRef, actorType, contentStamp, reason: body.reason },
    log(req)
  );

  await fileStore
    .setFlowApproval(slug, flowKey, { approved: false, approvedBy: null, approvedAt: null, rejectionReason: body.reason })
    .catch((err) => {
      log(req).warn({ err, slug, flowKey }, 'dual-write: flat-file flow projection skipped (flow not in manifest)');
    });

  res.status(200).json(approvalRepo.toApprovalDTO(row, slug, flowKey));
});

// GET /api/v1/features/:slug/flows/:flowId/approvals — paginated, newest first.
featuresRouter.get('/:slug/flows/:flowId/approvals', async (req, res) => {
  const { slug } = req.params;
  const flowKey = decodeURIComponent(req.params.flowId);
  const featureRow = await featureRepo.requireFeatureRowBySlug(slug, log(req));
  const flow = await flowRepo.findFlow(featureRow.id, flowKey, log(req));
  const page = parsePageParams(req.query as Record<string, unknown>);
  if (!flow) {
    // create-on-first-use: nothing decided yet is a legitimate empty history, not a 404.
    res.status(200).json({ items: [], page: { nextCursor: null, hasMore: false, total: 0 } });
    return;
  }
  const result = await approvalRepo.listApprovals(flow.id, slug, flowKey, page, log(req));
  res.status(200).json(result);
});
