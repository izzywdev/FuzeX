// routes/projects.ts — /api/v1/projects CRUD + /{id}/features (openapi.yaml v0.2.0).

import { Router, type Request, type Response } from 'express';
import * as projectRepo from '../repositories/projectRepo';
import { listFeaturesByProject } from '../repositories/featureRepo';
import { assertRef, toUuid, type EntityId } from '../lib/identity';
import { ValidationError } from '../lib/errors';
import { parsePageParams } from '../lib/pagination';
import type { LoggedRequest } from '../lib/logger';
import { authenticatedActor, type AuthenticatedRequest } from '../middleware/auth';
import * as designSystemRepo from '../repositories/designSystemRepo';
import * as fileStore from '../lib/fileStore';
import { parseDesignSystemRevision, parseRevisionNumber } from '../lib/designSystem';
import { NotFoundError, UnauthorizedError } from '../lib/errors';

export const projectsRouter = Router();

function log(req: Request) {
  return (req as LoggedRequest).log!;
}

// GET /api/v1/projects
projectsRouter.get('/', async (req, res) => {
  const page = parsePageParams(req.query as Record<string, unknown>);
  const result = await projectRepo.listProjects(page, log(req));
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
    { name: body.name as string, description: (body.description as string | null) ?? null, sourceRepo: (body.sourceRepo as string | null) ?? null },
    log(req)
  );
  res.status(201).json(created);
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
    log(req)
  );
  res.status(200).json(patched);
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

// Projects are the hosted application workspaces. Counts use the authoritative
// manifests so untouched flows do not disappear from the workspace summary.
projectsRouter.get('/:id/workspace', async (req, res) => {
  const id = assertRef('project', req.params.id) as EntityId<'project'>;
  const project = await projectRepo.getProject(id, log(req));
  const features = await projectRepo.listFeatureIdsByProject(toUuid(id), log(req));
  let flowCount = 0;
  let frameCount = 0;
  for (const feature of features) {
    const manifest = await fileStore.getManifest(feature.slug);
    const flows = (manifest.build as { flows?: unknown[] } | undefined)?.flows;
    flowCount += Array.isArray(flows) ? flows.length : 0;
    frameCount += Array.isArray(manifest.frames) ? manifest.frames.length : 0;
  }
  const designSystem = await designSystemRepo.getDesignSystemRevision(id, null, log(req));
  res.status(200).json({ project, featureCount: features.length, flowCount, frameCount, designSystem });
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
  res.status(201).json(await designSystemRepo.createDesignSystemRevision(id, input, actor, log(req)));
});
