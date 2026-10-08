import { Router, type Request } from 'express';
import * as fileStore from '../lib/fileStore';
import { computeStamp } from '../lib/stampLib';
import { generateDraft } from '../lib/generationLib';
import { assertRef, fromUuid, toUuid } from '../lib/identity';
import { ConflictError, StampConflictError, ValidationError } from '../lib/errors';
import type { LoggedRequest } from '../lib/logger';
import { authenticatedActor, type AuthenticatedRequest } from '../middleware/auth';
import * as featureRepo from '../repositories/featureRepo';
import * as generationRepo from '../repositories/generationRepo';
import * as flowRepo from '../repositories/flowRepo';
import * as frameRefRepo from '../repositories/frameRefRepo';

export const generationsRouter = Router();
const log = (req: Request) => (req as LoggedRequest).log!;
const generationUuid = (value: string) => toUuid(assertRef('generation', value));

function wire(row: generationRepo.GenerationRow, includeFrames = true) {
  return {
    id: fromUuid('generation', row.id), status: row.status,
    baseStamp: row.base_stamp, resultStamp: row.result_stamp, actorRef: row.actor_ref,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    ...(includeFrames ? { draft: row.draft } : {
      engine: row.draft.engine, flowId: row.draft.flow.id, title: row.draft.brief.title, frameCount: row.draft.frames.length,
    }),
  };
}

function strictBody(input: unknown, fields: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('body must be an object');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !fields.includes(key))) throw new ValidationError('unexpected generation body fields');
  return body;
}

function baseStamp(body: Record<string, unknown>): string {
  if (typeof body.baseStamp !== 'string' || !/^[a-f0-9]{64}$/.test(body.baseStamp)) {
    throw new ValidationError('baseStamp must be a lowercase sha256 digest');
  }
  return body.baseStamp;
}

// Generation previews are drafts and never change the active feature or approvals.
generationsRouter.post('/:slug/generations', async (req, res) => {
  const body = strictBody(req.body, ['brief', 'baseStamp']);
  const suppliedStamp = baseStamp(body);
  const feature = await fileStore.getFeature(req.params.slug);
  const currentStamp = computeStamp(feature);
  if (suppliedStamp !== currentStamp) throw new StampConflictError(currentStamp, suppliedStamp);
  const draft = generateDraft(body.brief, { baseStamp: suppliedStamp, designSystem: feature.manifest.designSystem });
  const flows = (feature.manifest.build as { flows?: Array<{ id: string }> } | undefined)?.flows ?? [];
  if (flows.some((flow) => flow.id === draft.flow.id)) throw new ConflictError('flowId already exists; choose a new flow key');
  if (draft.frames.some((frame) => feature.frames.has(frame.file))) throw new ConflictError('generated frame filename already exists');
  const featureRow = await featureRepo.requireFeatureRowBySlug(req.params.slug, log(req));
  const actor = authenticatedActor(req as AuthenticatedRequest).actorRef;
  if (!actor) throw new ValidationError('verified actor identity is required');
  const row = await generationRepo.createGeneration(featureRow.id, draft, actor, log(req));
  res.status(201).json(wire(row));
});

generationsRouter.get('/:slug/generations', async (req, res) => {
  const feature = await featureRepo.requireFeatureRowBySlug(req.params.slug, log(req));
  res.json({ generations: (await generationRepo.listGenerations(feature.id, log(req))).map((row) => wire(row, false)) });
});

generationsRouter.get('/:slug/generations/:generationId', async (req, res) => {
  const feature = await featureRepo.requireFeatureRowBySlug(req.params.slug, log(req));
  res.json(wire(await generationRepo.getGeneration(feature.id, generationUuid(req.params.generationId), log(req))));
});

generationsRouter.post('/:slug/generations/:generationId/dismiss', async (req, res) => {
  strictBody(req.body ?? {}, []);
  const feature = await featureRepo.requireFeatureRowBySlug(req.params.slug, log(req));
  const row = await generationRepo.transitionGeneration(feature.id, generationUuid(req.params.generationId), async (current) => {
    if (current.status === 'applied') throw new ConflictError('applied generations cannot be dismissed');
    return { status: 'dismissed', resultStamp: null };
  }, log(req));
  res.json(wire(row));
});

// Explicit publication accepts only the reviewed base. It remains an unapproved flow.
generationsRouter.post('/:slug/generations/:generationId/apply', async (req, res) => {
  const suppliedStamp = baseStamp(strictBody(req.body, ['baseStamp']));
  const featureRow = await featureRepo.requireFeatureRowBySlug(req.params.slug, log(req));
  const row = await generationRepo.transitionGeneration(featureRow.id, generationUuid(req.params.generationId), async (current) => {
    if (suppliedStamp !== current.base_stamp) throw new StampConflictError(current.base_stamp, suppliedStamp);
    if (current.status === 'dismissed') throw new ConflictError('dismissed generation cannot be applied');
    if (current.status === 'applied') return { status: current.status, resultStamp: current.result_stamp };
    const feature = await fileStore.getFeature(req.params.slug);
    const draft = current.draft;
    const build = (feature.manifest.build as Record<string, unknown> | undefined) ?? {};
    const flows = (build.flows as Array<Record<string, unknown>> | undefined) ?? [];
    const prior = flows.find((flow) => flow.generationId === fromUuid('generation', current.id));
    let revision: fileStore.StoreRevision;
    if (prior) {
      // Recover if content publication succeeded but database completion failed.
      const snapshots = await fileStore.listRevisions(req.params.slug);
      let published: fileStore.StoreRevision | undefined;
      for (const snapshot of snapshots.reverse()) {
        const candidate = await fileStore.getRevision(req.params.slug, snapshot.stamp);
        const candidateFlows = (candidate.manifest.build as { flows?: Array<Record<string, unknown>> } | undefined)?.flows ?? [];
        if (candidateFlows.some((flow) => flow.id === draft.flow.id && flow.generationId === fromUuid('generation', current.id))
          && draft.frames.every((frame) => candidate.frames.get(frame.file) === frame.html)) {
          published = candidate;
          break;
        }
      }
      if (!published) throw new ConflictError('generation publication has no immutable revision');
      revision = published;
    } else {
      const currentStamp = computeStamp(feature);
      if (currentStamp !== suppliedStamp) throw new StampConflictError(currentStamp, suppliedStamp);
      if (flows.some((flow) => flow.id === draft.flow.id) || draft.frames.some((frame) => feature.frames.has(frame.file))) {
        throw new ConflictError('generation collides with existing flow or frames');
      }
      const frameDecls = draft.frames.map(({ html: _html, ...frame }) => frame);
      const manifest = {
        ...feature.manifest,
        entry: typeof feature.manifest.entry === 'string' && feature.frames.has(feature.manifest.entry)
          ? feature.manifest.entry : draft.frames[0].file,
        frames: [...((feature.manifest.frames as Array<Record<string, unknown>> | undefined) ?? []), ...frameDecls],
        build: { ...build, flows: [...flows, { ...draft.flow, generationId: fromUuid('generation', current.id) }] },
      };
      const frames = new Map(feature.frames);
      for (const frame of draft.frames) frames.set(frame.file, frame.html);
      revision = await fileStore.importFeature(req.params.slug, manifest, frames, suppliedStamp);
    }
    const revisionFlows = (revision.manifest.build as { flows?: Array<{ id: string }> } | undefined)?.flows ?? [];
    const flowIds = new Map<string, string>();
    for (const flow of revisionFlows) {
      const indexed = await flowRepo.findOrCreateFlow(featureRow.id, flow.id, log(req));
      flowIds.set(flow.id, indexed.id);
    }
    const declared = new Map(((revision.manifest.frames as Array<{ file: string; flow?: string }> | undefined) ?? []).map((frame) => [frame.file, frame.flow]));
    await frameRefRepo.indexFrameRefsFromManifest(featureRow.id, Array.from(revision.frames.keys()).map((file) => ({ file, flow: declared.get(file) })), flowIds, revision.stamp, log(req));
    return { status: 'applied', resultStamp: revision.stamp };
  }, log(req));
  res.json(wire(row));
});
