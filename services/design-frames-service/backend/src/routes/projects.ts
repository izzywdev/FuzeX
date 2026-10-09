// routes/projects.ts — /api/v1/projects CRUD + /{id}/features (openapi.yaml v0.2.0).

import { Router, type Request, type Response } from 'express';
import * as projectRepo from '../repositories/projectRepo';
import { listFeaturesByProject } from '../repositories/featureRepo';
import { assertRef, toUuid, type EntityId } from '../lib/identity';
import { ValidationError } from '../lib/errors';
import { parsePageParams } from '../lib/pagination';
import type { LoggedRequest } from '../lib/logger';
import { authenticatedActor, authenticatedEventContext, type AuthenticatedRequest } from '../middleware/auth';
import * as designSystemRepo from '../repositories/designSystemRepo';
import * as fileStore from '../lib/fileStore';
import { parseDesignSystemRevision, parseRevisionNumber } from '../lib/designSystem';
import { NotFoundError, UnauthorizedError } from '../lib/errors';
import * as nativeFlowRepo from '../repositories/nativeFlowRepo';
import { parseNativeFlowCreate, parseNativeFlowRevision, parseRevisionNumber as parseNativeFlowRevisionNumber } from '../lib/nativeFlow';

export const projectsRouter = Router();

function log(req: Request) {
  return (req as LoggedRequest).log!;
}

function verifiedOrganizationId(req: Request): string {
  const auth = req as AuthenticatedRequest;
  const identity = auth.delegatedIdentity ?? auth.machineIdentity;
  if (!identity?.tenantId) throw new UnauthorizedError('a verified FuzeFront tenant identity is required');
  return identity.tenantId;
}

// GET /api/v1/projects
projectsRouter.get('/', async (req, res) => {
  const page = parsePageParams(req.query as Record<string, unknown>);
  const result = await projectRepo.listProjects(page, log(req), verifiedOrganizationId(req));
  res.status(200).json(result);
});

// POST /api/v1/projects — ProjectCreate: { name, description?, sourceRepo? }.
// additionalProperties:false is enforced here (mirrors openapi.yaml); no
// `id`/`uuid` field is ever read off the body — the server mints it.
projectsRouter.post('/', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const allowed = new Set(['name', 'description', 'sourceRepo']);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  const errors: string[] = [];
  if (unknown.length) errors.push(`unexpected propert${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}`);
  if (typeof body.name !== 'string' || body.name.trim().length === 0) errors.push('name is required (non-empty string)');
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    errors.push('description must be a string or null');
  }
  if (body.sourceRepo !== undefined && body.sourceRepo !== null && typeof body.sourceRepo !== 'string') {
    errors.push('sourceRepo must be a string or null');
  }
  if (errors.length) throw new ValidationError('invalid project create body', errors);

  const created = await projectRepo.createProject(
    { name: body.name as string, description: (body.description as string | null) ?? null, sourceRepo: (body.sourceRepo as string | null) ?? null, organizationId: verifiedOrganizationId(req) },
    log(req), authenticatedEventContext(req as AuthenticatedRequest)
  );
  res.status(201).json(created);
});

// Project-owned operations must never cross a tenant boundary. FuzeFront is
// still consulted for every request; this local ownership check protects the
// FuzeX data plane even if a caller presents an otherwise valid cross-tenant
// identifier. Legacy projects with no verified owner are intentionally hidden.
projectsRouter.use('/:id', async (req, _res, next) => {
  try {
    const id = assertRef('project', req.params.id) as EntityId<'project'>;
    await projectRepo.getProject(id, log(req), verifiedOrganizationId(req));
    next();
  } catch (error) { next(error); }
});

// GET /api/v1/projects/:id
projectsRouter.get('/:id', async (req, res) => {
  const id = assertRef('project', req.params.id) as EntityId<'project'>;
  const project = await projectRepo.getProject(id, log(req));
  res.status(200).json(project);
});

// PATCH /api/v1/projects/:id — ProjectPatch: mutable fields only, minProperties:1.
projectsRouter.patch('/:id', async (req, res) => {
  const id = assertRef('project', req.params.id) as EntityId<'project'>;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const allowed = new Set(['name', 'description', 'sourceRepo']);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  const errors: string[] = [];
  if (unknown.length) errors.push(`unexpected propert${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}`);
  if (Object.keys(body).length === 0) errors.push('at least one field is required');
  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length === 0)) {
    errors.push('name must be a non-empty string');
  }
  for (const key of ['description', 'sourceRepo']) {
    if (body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') {
      errors.push(`${key} must be a string or null`);
    }
  }
  if (errors.length) throw new ValidationError('invalid project patch body', errors);

  const patched = await projectRepo.patchProject(
    id,
    {
      name: body.name as string | undefined,
      description: body.description as string | null | undefined,
      sourceRepo: body.sourceRepo as string | null | undefined,
    },
    log(req), authenticatedEventContext(req as AuthenticatedRequest)
  );
  res.status(200).json(patched);
});

// Repository connections are owned by the App workspace, not by an imported
// manifest. Connecting one also adopts any previously imported frames carrying
// matching provenance, so onboarding does not require re-importing a catalogue.
projectsRouter.get('/:id/repositories', async (req, res) => {
  const id = assertRef('project', req.params.id) as EntityId<'project'>;
  await projectRepo.getProject(id, log(req));
  res.status(200).json({ items: await projectRepo.listProjectRepositories(id, log(req)) });
});

projectsRouter.post('/:id/repositories', async (req, res) => {
  const id = assertRef('project', req.params.id) as EntityId<'project'>;
  await projectRepo.getProject(id, log(req));
  const body = (req.body ?? {}) as Record<string, unknown>;
  const allowed = new Set(['repository', 'framesPath']);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  const repository = typeof body.repository === 'string' ? body.repository.trim() : '';
  const framesPath = typeof body.framesPath === 'string' ? body.framesPath.trim() : 'design/frames';
  if (unknown.length || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !framesPath || framesPath.startsWith('/') || framesPath.includes('..')) {
    throw new ValidationError('invalid repository connection', ['repository must be owner/repository; framesPath must be a relative path']);
  }
  const connected = await projectRepo.connectRepository(id, repository, framesPath, log(req), authenticatedEventContext(req as AuthenticatedRequest));
  const adoptedFeatures = await projectRepo.assignImportedFeaturesForRepository(id, repository, log(req));
  res.status(201).json({ ...connected, adoptedFeatures });
});

// GET /api/v1/projects/:id/features
projectsRouter.get('/:id/features', async (req, res) => {
  const id = assertRef('project', req.params.id) as EntityId<'project'>;
  // Existence check — a project id that parses but doesn't exist is still a 404.
  await projectRepo.getProject(id, log(req));
  const page = parsePageParams(req.query as Record<string, unknown>);
  const result = await listFeaturesByProject(toUuid(id), page, log(req));
  res.status(200).json(result);
});

// Native UX flows are project-owned documents. Unlike /features, they are not
// derived from a repository manifest and therefore remain available after a
// team retires Git as its design-authoring system.
projectsRouter.get('/:id/flows', async (req, res) => {
  const id = assertRef('project', req.params.id) as EntityId<'project'>;
  await projectRepo.getProject(id, log(req));
  res.status(200).json(await nativeFlowRepo.listNativeFlows(id, parsePageParams(req.query as Record<string, unknown>), log(req)));
});

projectsRouter.post('/:id/flows', async (req: AuthenticatedRequest, res) => {
  const id = assertRef('project', req.params.id) as EntityId<'project'>;
  const actor = authenticatedActor(req).actorRef;
  if (!actor) throw new UnauthorizedError('a verified caller is required');
  const created = await nativeFlowRepo.createNativeFlow(id, parseNativeFlowCreate(req.body), actor, log(req), authenticatedEventContext(req));
  res.status(201).json(created);
});

projectsRouter.get('/:id/flows/:flowId', async (req, res) => {
  const projectId = assertRef('project', req.params.id) as EntityId<'project'>;
  const flowId = assertRef('flow', req.params.flowId) as EntityId<'flow'>;
  res.status(200).json(await nativeFlowRepo.getNativeFlow(projectId, flowId, log(req)));
});

projectsRouter.get('/:id/flows/:flowId/revisions', async (req, res) => {
  const projectId = assertRef('project', req.params.id) as EntityId<'project'>;
  const flowId = assertRef('flow', req.params.flowId) as EntityId<'flow'>;
  res.status(200).json(await nativeFlowRepo.listNativeFlowRevisions(projectId, flowId, parsePageParams(req.query as Record<string, unknown>), log(req)));
});

projectsRouter.get('/:id/flows/:flowId/revisions/:revision', async (req, res) => {
  const projectId = assertRef('project', req.params.id) as EntityId<'project'>;
  const flowId = assertRef('flow', req.params.flowId) as EntityId<'flow'>;
  res.status(200).json(await nativeFlowRepo.getNativeFlowRevision(projectId, flowId, parseNativeFlowRevisionNumber(req.params.revision), log(req)));
});

projectsRouter.post('/:id/flows/:flowId/revisions', async (req: AuthenticatedRequest, res) => {
  const projectId = assertRef('project', req.params.id) as EntityId<'project'>;
  const flowId = assertRef('flow', req.params.flowId) as EntityId<'flow'>;
  const actor = authenticatedActor(req).actorRef;
  if (!actor) throw new UnauthorizedError('a verified caller is required');
  res.status(201).json(await nativeFlowRepo.appendNativeFlowRevision(projectId, flowId, parseNativeFlowRevision(req.body), actor, log(req), authenticatedEventContext(req)));
});

// Projects are the hosted application workspaces. Counts use the authoritative
// manifests so untouched flows do not disappear from the workspace summary.
projectsRouter.get('/:id/workspace', async (req, res) => {
  const id = assertRef('project', req.params.id) as EntityId<'project'>;
  const project = await projectRepo.getProject(id, log(req));
  const features = await projectRepo.listFeatureIdsByProject(toUuid(id), log(req));
  let flowCount = await nativeFlowRepo.countNativeFlows(id, log(req));
  let frameCount = 0;
  for (const feature of features) {
    const manifest = await fileStore.getManifest(feature.slug);
    const flows = (manifest.build as { flows?: unknown[] } | undefined)?.flows;
    flowCount += Array.isArray(flows) ? flows.length : 0;
    frameCount += Array.isArray(manifest.frames) ? manifest.frames.length : 0;
  }
  const designSystem = await designSystemRepo.getDesignSystemRevision(id, null, log(req));
  const repositories = await projectRepo.listProjectRepositories(id, log(req));
  const detectedServices = new Map<string, { name: string; openapi: string; featureCount: number }>();
  for (const feature of features) {
    const manifest = await fileStore.getManifest(feature.slug);
    const openapi = (manifest.contract as { openapi?: unknown } | undefined)?.openapi;
    if (typeof openapi === 'string' && openapi.trim()) {
      const name = openapi.split('/').filter(Boolean).at(-2) || openapi;
      const prior = detectedServices.get(openapi);
      detectedServices.set(openapi, { name, openapi, featureCount: (prior?.featureCount ?? 0) + 1 });
    }
  }
  res.status(200).json({ project, repositories, detectedServices: [...detectedServices.values()], featureCount: features.length, flowCount, frameCount, designSystem });
});

projectsRouter.get('/:id/design-system', async (req, res) => {
  const id = assertRef('project', req.params.id) as EntityId<'project'>;
  await projectRepo.getProject(id, log(req));
  const revision = await designSystemRepo.getDesignSystemRevision(id, null, log(req));
  if (!revision) throw new NotFoundError(`project '${id}' has no design system revisions`);
  res.status(200).json(revision);
});

projectsRouter.get('/:id/design-system/revisions', async (req, res) => {
  const id = assertRef('project', req.params.id) as EntityId<'project'>;
  await projectRepo.getProject(id, log(req));
  const page = parsePageParams(req.query as Record<string, unknown>);
  res.status(200).json(await designSystemRepo.listDesignSystemRevisions(id, page, log(req)));
});

projectsRouter.get('/:id/design-system/revisions/:revision', async (req, res) => {
  const id = assertRef('project', req.params.id) as EntityId<'project'>;
  const version = parseRevisionNumber(req.params.revision);
  await projectRepo.getProject(id, log(req));
  const revision = await designSystemRepo.getDesignSystemRevision(id, version, log(req));
  if (!revision) throw new NotFoundError(`design system revision '${version}' not found for project '${id}'`);
  res.status(200).json(revision);
});

projectsRouter.post('/:id/design-system/revisions', async (req: AuthenticatedRequest, res) => {
  const id = assertRef('project', req.params.id) as EntityId<'project'>;
  const input = parseDesignSystemRevision(req.body);
  const actor = authenticatedActor(req).actorRef;
  if (!actor) throw new UnauthorizedError('a verified caller is required');
  res.status(201).json(await designSystemRepo.createDesignSystemRevision(id, input, actor, log(req), authenticatedEventContext(req)));
});
