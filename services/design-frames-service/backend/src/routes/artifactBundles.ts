import { Router, type Request, type Response } from 'express';
import express from 'express';
import { createHash } from 'node:crypto';
import { assertRef, type EntityId } from '../lib/identity';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../lib/errors';
import type { LoggedRequest } from '../lib/logger';
import { authenticatedActor, type AuthenticatedRequest } from '../middleware/auth';
import * as projectRepo from '../repositories/projectRepo';
import * as bundleRepo from '../repositories/artifactBundleRepo';
import { assertSafeArtifactPath, parseArtifactBundleCreate } from '../lib/artifactBundle';
import { getArtifactObjectStore } from '../lib/artifactStore';

export const artifactBundlesRouter = Router({ mergeParams: true });
export const artifactBundlePreviewRouter = Router();
function log(req: Request) { return (req as LoggedRequest).log!; }
function verifiedOrganizationId(req: Request): string {
  const auth = req as AuthenticatedRequest;
  const identity = auth.delegatedIdentity ?? auth.machineIdentity;
  if (!identity?.tenantId) throw new UnauthorizedError('a verified FuzeFront tenant identity is required');
  return identity.tenantId;
}
function pathParam(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0 && value.every((part) => typeof part === 'string')) return value.join('/');
  throw new ValidationError(`missing path parameter '${name}'`);
}

artifactBundlesRouter.get('/', async (req, res) => {
  const projectId = assertRef('project', pathParam(req, 'id')) as EntityId<'project'>;
  await projectRepo.getProject(projectId, log(req));
  const flowKey = typeof req.query.flowKey === 'string' ? req.query.flowKey : undefined;
  if (flowKey !== undefined && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(flowKey)) throw new ValidationError('flowKey must be a lowercase slug');
  res.status(200).json({ items: await bundleRepo.listArtifactBundles(projectId, flowKey, log(req)) });
});

artifactBundlesRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const projectId = assertRef('project', pathParam(req, 'id')) as EntityId<'project'>;
  const actor = authenticatedActor(req).actorRef;
  const store = getArtifactObjectStore();
  const input = parseArtifactBundleCreate(req.body, actor, store.config.bucket);
  const created = await bundleRepo.createArtifactBundle(projectId, input, log(req));
  res.status(201).json({ ...created, objects: input.objects });
});

artifactBundlesRouter.get('/:bundleId', async (req, res) => {
  const projectId = assertRef('project', pathParam(req, 'id')) as EntityId<'project'>;
  const bundleId = assertRef('artifactBundle', pathParam(req, 'bundleId')) as EntityId<'artifactBundle'>;
  const bundle = await bundleRepo.getArtifactBundle(bundleId, log(req), true);
  if (bundle.projectId !== projectId) throw new NotFoundError(`artifact bundle '${bundleId}' not found`);
  res.status(200).json(bundle);
});

// Bytes travel through the authenticated FuzeFront proxy to the private
// object-store adapter. This avoids presigned browser credentials entirely.
artifactBundlesRouter.put('/:bundleId/objects/*path', express.raw({ type: '*/*', limit: '1gb' }), async (req: AuthenticatedRequest, res) => {
  const projectId = assertRef('project', pathParam(req, 'id')) as EntityId<'project'>;
  const bundleId = assertRef('artifactBundle', pathParam(req, 'bundleId')) as EntityId<'artifactBundle'>;
  authenticatedActor(req);
  const bundle = await bundleRepo.getArtifactBundle(bundleId, log(req));
  if (bundle.projectId !== projectId) throw new NotFoundError(`artifact bundle '${bundleId}' not found`);
  if (bundle.state !== 'uploading') throw new ConflictError('sealed artifact bundles cannot receive objects');
  const path = assertSafeArtifactPath(pathParam(req, 'path'));
  const object = await bundleRepo.findArtifactObject(bundleId, path, log(req));
  if (!Buffer.isBuffer(req.body)) throw new ValidationError('artifact object body is required');
  const digest = createHash('sha256').update(req.body).digest('hex');
  if (digest !== object.sha256) throw new ValidationError('artifact object checksum does not match declared sha256');
  const contentType = req.headers['content-type'];
  if (contentType !== object.contentType) throw new ValidationError('artifact object content-type does not match declared contentType');
  await getArtifactObjectStore().putObject({ key: object.storageKey, body: req.body, contentType: object.contentType, sha256: object.sha256 });
  res.status(204).end();
});

artifactBundlesRouter.post('/:bundleId/seal', async (req: AuthenticatedRequest, res) => {
  const projectId = assertRef('project', pathParam(req, 'id')) as EntityId<'project'>;
  const bundleId = assertRef('artifactBundle', pathParam(req, 'bundleId')) as EntityId<'artifactBundle'>;
  authenticatedActor(req);
  const bundle = await bundleRepo.getArtifactBundle(bundleId, log(req), true);
  if (bundle.projectId !== projectId) throw new NotFoundError(`artifact bundle '${bundleId}' not found`);
  if (bundle.state === 'sealed') return res.status(200).json(bundle);
  const store = getArtifactObjectStore();
  for (const object of bundle.objects ?? []) {
    const row = await bundleRepo.findArtifactObject(bundleId, object.path, log(req));
    if (!await store.objectExists(row.storageKey, row.sha256)) throw new ConflictError(`declared artifact object '${object.path}' has not been uploaded`);
  }
  res.status(200).json(await bundleRepo.sealArtifactBundle(bundleId, log(req)));
});

// Preview is deliberately an API relay, not an S3 URL. FuzeFront's existing
// authN/authZ gateway evaluates Permit/OPAL before this route. The route only
// serves objects declared in a sealed bundle, so no key/prefix enumeration is
// possible even from a compromised UI.
artifactBundlePreviewRouter.get('/:bundleId/objects/*path', async (req: AuthenticatedRequest, res) => {
  const bundleId = assertRef('artifactBundle', pathParam(req, 'bundleId')) as EntityId<'artifactBundle'>;
  const bundle = await bundleRepo.getArtifactBundle(bundleId, log(req));
  if (bundle.state !== 'sealed') throw new NotFoundError(`artifact bundle '${bundleId}' not found`);
  // This relay is not nested below /projects/:id, so enforce the same
  // database ownership boundary before exposing bytes from private storage.
  // FuzeFront Security still makes the live authorization decision; this
  // prevents a broadly-authorized catalog read from crossing tenant data.
  await projectRepo.getProject(bundle.projectId, log(req), verifiedOrganizationId(req));
  const object = await bundleRepo.findArtifactObject(bundleId, assertSafeArtifactPath(pathParam(req, 'path')), log(req));
  const stored = await getArtifactObjectStore().getObject(object.storageKey);
  res.status(200).type(stored.contentType).setHeader('X-Content-Type-Options', 'nosniff').send(Buffer.from(stored.body));
});
