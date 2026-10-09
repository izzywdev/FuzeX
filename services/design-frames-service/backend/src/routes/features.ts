// routes/features.ts — the v0.1.0 /api/v1/features/** surface, projected
// from the new model (docs/postgres-tier.md "Backward-compatibility"), PLUS
// the v0.2.0 extensions: optional projectId on create, contentStamp-bound
// approve/reject, and the paginated approvals history.

import { Router, type Request } from 'express';
import * as fileStore from '../lib/fileStore';
import { computeStamp } from '../lib/stampLib';
import { validateManifest } from '../lib/manifestSchema';
import { projectManifest, type LatestApprovalForFlow } from '../lib/projection';
import { assertRef, fromUuid, type EntityId } from '../lib/identity';
import * as featureRepo from '../repositories/featureRepo';
import * as flowRepo from '../repositories/flowRepo';
import * as approvalRepo from '../repositories/approvalRepo';
import * as projectRepo from '../repositories/projectRepo';
import * as frameRefRepo from '../repositories/frameRefRepo';
import { ConflictError, ValidationError } from '../lib/errors';
import { parsePageParams } from '../lib/pagination';
import type { LoggedRequest } from '../lib/logger';
import { authenticatedActor } from '../middleware/auth';

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
      contentStamp: row.content_stamp,
    });
  }
  return out;
}

async function indexRevision(revision: fileStore.StoreRevision, req: Request) {
  const featureRow = await featureRepo.findOrCreateFeatureBySlug(revision.slug, log(req));
  const manifest = revision.manifest as {
    frames?: Array<{ file: string; flow?: string }>;
    build?: { flows?: Array<{ id: string }> };
    sourceRepo?: unknown;
  };
  // Manifests carry provenance only. Apps and repository connections are
  // database-managed, so an import joins a workspace only after that repository
  // has been explicitly connected through the App API/UI.
  const sourceRepo = typeof manifest.sourceRepo === 'string' && manifest.sourceRepo.trim()
    ? manifest.sourceRepo.trim() : null;
  await featureRepo.setFeatureSourceRepo(featureRow.id, sourceRepo, log(req));
  if (sourceRepo) {
    const projectId = await projectRepo.findProjectByRepository(sourceRepo, log(req));
    if (projectId) await featureRepo.assignFeatureToProject(featureRow.id, projectId, log(req));
  }
  const flowIdByKey = new Map<string, string>();
  for (const flowDecl of manifest.build?.flows ?? []) {
    const flowRow = await flowRepo.findOrCreateFlow(featureRow.id, flowDecl.id, log(req));
    flowIdByKey.set(flowDecl.id, flowRow.id);
  }
  const flowByFile = new Map((manifest.frames ?? []).map((frame) => [frame.file, frame.flow]));
  const actualFrames = Array.from(revision.frames.keys()).map((file) => ({ file, flow: flowByFile.get(file) }));
  await frameRefRepo.indexFrameRefsFromManifest(featureRow.id, actualFrames, flowIdByKey, revision.stamp, log(req));
}

function suppliedStamp(body: Record<string, unknown>): string | undefined {
  if (body.contentStamp === undefined) return undefined;
  if (typeof body.contentStamp !== 'string' || !/^[a-f0-9]{64}$/.test(body.contentStamp)) {
    throw new ValidationError('contentStamp must be a lowercase sha256 hex digest');
  }
  return body.contentStamp;
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

  // openapi.yaml's feature-create body requires ONLY `slug`; `description`
  // is optional. lib/schema.js's validateManifest, however, requires the
  // manifest's `description` to be a non-empty string (never modify that
  // shared schema per docs/postgres-tier.md — fix the gap here instead): an
  // omitted description must still produce a valid, non-empty manifest
  // field. Fall back to the feature name (itself defaulted to the slug just
  // above), rather than synthesizing '' which fails that validation.
  const resolvedName = (name as string) || slug;
  const manifest = {
    name: resolvedName,
    description: (description as string) || resolvedName,
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
  await featureRepo.createFeatureRow(slug, projectRefId, (sourceRepo as string | null) || null, log(req));
  res.status(201).json({ slug: feature.slug, manifest: feature.manifest });
});

// GET /api/v1/features/:slug — manifest + frame contents, with
// build.flows[].approved* PROJECTED from the latest Postgres approval row.
featuresRouter.get('/:slug', async (req, res) => {
  const feature = await fileStore.getFeature(req.params.slug);
  const featureRow = await featureRepo.findFeatureBySlug(req.params.slug, log(req));
  const latest = featureRow ? await latestApprovalsAsProjectionInput(featureRow.id, log(req)) : new Map();
  const manifest = projectManifest(feature.manifest, latest, computeStamp(feature));
  res.status(200).json({ slug: req.params.slug, manifest, frames: Object.fromEntries(feature.frames) });
});

// A complete repository import is one content transaction. CAS prevents two
// publishers built from the same base from silently overwriting one another.
featuresRouter.post('/:slug/import', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const errors = validateManifest(body.manifest);
  if (errors.length) throw new ValidationError('manifest validation failed', errors);
  if (!body.frames || typeof body.frames !== 'object' || Array.isArray(body.frames)) {
    throw new ValidationError('frames must be an object mapping filenames to HTML');
  }
  if (body.expectedStamp !== undefined && body.expectedStamp !== null &&
      (typeof body.expectedStamp !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedStamp))) {
    throw new ValidationError('expectedStamp must be a lowercase sha256 digest or null');
  }
  const manifest = body.manifest as Record<string, unknown>;
  const frames = new Map(Object.entries(body.frames as Record<string, string>));
  const required = new Set([
    String(manifest.entry),
    ...((manifest.frames as Array<{ file: string }>) ?? []).map((frame) => frame.file),
  ]);
  for (const file of required) {
    if (!frames.has(file)) throw new ValidationError(`import is missing required frame '${file}'`);
  }
  const revision = await fileStore.importFeature(req.params.slug, manifest, frames, body.expectedStamp as string | null | undefined);
  // A retry after a DB outage reuses the immutable snapshot and repairs index rows.
  await indexRevision(revision, req);
  res.status(200).json({ slug: revision.slug, stamp: revision.stamp, frameCount: revision.frames.size, revision: revision.metadata });
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

// Immutable content snapshots. The current feature stays mutable for import
// and authoring; these routes let the hosted reviewer revisit any stamped
// revision without relying on a force-pushed Git branch or old Pages build.
featuresRouter.get('/:slug/revisions', async (req, res) => {
  res.status(200).json({ slug: req.params.slug, revisions: await fileStore.listRevisions(req.params.slug) });
});

featuresRouter.get('/:slug/revisions/:stamp', async (req, res) => {
  const revision = await fileStore.getRevision(req.params.slug, req.params.stamp);
  res.status(200).json({
    slug: revision.slug,
    stamp: revision.stamp,
    revision: revision.metadata,
    manifest: revision.manifest,
    frames: Object.fromEntries(revision.frames),
  });
});

// Frame identity is revision-scoped. Consumers use the returned `id` as the
// targetRef for a frame/element discussion, making an annotation unambiguously
// about the bytes represented by this stamp.
featuresRouter.get('/:slug/revisions/:stamp/frame-refs', async (req, res) => {
  const feature = await featureRepo.requireFeatureRowBySlug(req.params.slug, log(req));
  const revision = await fileStore.getRevision(req.params.slug, req.params.stamp);
  const refs = await frameRefRepo.listByFeatureAndStamp(feature.id, revision.stamp, log(req));
  res.status(200).json({
    slug: revision.slug,
    stamp: revision.stamp,
    frames: refs.map((frame) => ({
      id: fromUuid('frameRef', frame.id),
      file: frame.file,
      flowId: frame.flow_id ? fromUuid('flow', frame.flow_id) : null,
      contentStamp: frame.content_stamp,
    })),
  });
});

// POST /api/v1/features/:slug/stamp — compute AND persist.
featuresRouter.post('/:slug/stamp', async (req, res) => {
  const feature = await fileStore.commitRevision(req.params.slug);
  const stamp = feature.stamp;

  // Index a frame_ref row per ACTUAL frame file at this stamp, so `frame`/
  // `element` discussion targets (DiscussionTargetType, docs/postgres-tier.md)
  // are discoverable via the live API rather than only via the out-of-band
  // scripts/backfill.ts (see repositories/frameRefRepo.ts). Sourced from
  // `feature.frames` (the real files on disk, per lib/store.js#getFeature —
  // the same set computeStamp() just hashed above) rather than
  // `manifest.frames`: a frame written via PUT .../frames/:file never
  // requires the manifest to separately declare it, so keying off the
  // manifest array would miss exactly the case this fix targets.
  await indexRevision(feature, req);

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
  // openapi.yaml's approve body is additionalProperties:false ({ approvedBy,
  // actorType?, contentStamp? }) — reject anything else, mirroring
  // routes/projects.ts's create/patch handlers.
  const allowed = new Set(['approvedBy', 'actorType', 'contentStamp']);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length) {
    throw new ValidationError('invalid approve body', [
      `unexpected propert${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}`,
    ]);
  }
  if (typeof body.approvedBy !== 'string' || body.approvedBy.length === 0) {
    throw new ValidationError('approvedBy is required');
  }
  const { actorRef, actorType } = authenticatedActor(req);
  const contentStamp = suppliedStamp(body);

  const featureRow = await featureRepo.requireFeatureRowBySlug(slug, log(req));
  const flow = await flowRepo.findOrCreateFlow(featureRow.id, flowKey, log(req));
  const decidedAt = new Date();
  const row = await fileStore.withCurrentRevision(slug, contentStamp,
    async (_feature, stamp) => approvalRepo.insertApproval(
      { flowId: flow.id, decision: 'approve', actorRef, actorType, contentStamp: stamp, reason: null }, log(req)
    ),
    { flowKey, value: { approved: true, approvedBy: actorRef, approvedAt: decidedAt.toISOString(), rejectionReason: null } }
  );

  res.status(200).json(approvalRepo.toApprovalDTO(row, slug, flowKey));
});

// POST /api/v1/features/:slug/flows/:flowId/reject — reason now REQUIRED (v0.2.0).
featuresRouter.post('/:slug/flows/:flowId/reject', async (req, res) => {
  const { slug } = req.params;
  const flowKey = decodeURIComponent(req.params.flowId);
  const body = (req.body ?? {}) as Record<string, unknown>;
  // openapi.yaml's reject body is additionalProperties:false ({ reason,
  // rejectedBy?, actorType?, contentStamp? }) — reject anything else,
  // mirroring routes/projects.ts's create/patch handlers.
  const allowed = new Set(['reason', 'rejectedBy', 'actorType', 'contentStamp']);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length) {
    throw new ValidationError('invalid reject body', [
      `unexpected propert${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}`,
    ]);
  }
  if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
    throw new ValidationError('reason is required');
  }
  const { actorRef, actorType } = authenticatedActor(req);
  const contentStamp = suppliedStamp(body);

  const featureRow = await featureRepo.requireFeatureRowBySlug(slug, log(req));
  const flow = await flowRepo.findOrCreateFlow(featureRow.id, flowKey, log(req));
  const reason = body.reason;
  const row = await fileStore.withCurrentRevision(slug, contentStamp,
    async (_feature, stamp) => approvalRepo.insertApproval(
      { flowId: flow.id, decision: 'reject', actorRef, actorType, contentStamp: stamp, reason }, log(req)
    ),
    { flowKey, value: { approved: false, approvedBy: null, approvedAt: null, rejectionReason: reason } }
  );

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
