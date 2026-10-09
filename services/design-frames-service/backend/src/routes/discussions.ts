// routes/discussions.ts — /api/v1/discussions (+ nested comments) and the
// GET /api/v1/features/{slug}/discussions convenience route.

import { Router, type Request } from 'express';
import * as discussionRepo from '../repositories/discussionRepo';
import * as commentRepo from '../repositories/commentRepo';
import * as frameRefRepo from '../repositories/frameRefRepo';
import * as featureRepo from '../repositories/featureRepo';
import * as fileStore from '../lib/fileStore';
import {
  assertRef,
  fromUuid,
  toUuid,
  DISCUSSION_TARGET_ENTITY_TYPE,
  type DiscussionTargetType,
  type EntityId,
} from '../lib/identity';
import { NotFoundError, UnauthorizedError, ValidationError } from '../lib/errors';
import { parsePageParams } from '../lib/pagination';
import { query } from '../lib/db';
import type { LoggedRequest } from '../lib/logger';
import { authenticatedActor, type AuthenticatedRequest } from '../middleware/auth';

export const discussionsRouter = Router();
export const featureDiscussionsRouter = Router();

const VALID_TARGET_TYPES = new Set<DiscussionTargetType>(['project', 'feature', 'flow', 'frame', 'element']);

function log(req: Request) {
  return (req as LoggedRequest).log!;
}

function verifiedOrganizationId(req: Request): string {
  const auth = req as AuthenticatedRequest;
  const identity = auth.delegatedIdentity ?? auth.machineIdentity;
  if (!identity?.tenantId) throw new UnauthorizedError('a verified FuzeFront tenant identity is required');
  return identity.tenantId;
}

/**
 * Discussions are globally-addressable by TypeID, but the target they describe
 * is not.  Keep the ownership check local as defense in depth alongside the
 * live FuzeFront Security decision; never expose a target merely because its
 * identifier is well formed.
 */
async function requireTenantTarget(
  targetType: DiscussionTargetType,
  targetRefUuid: string,
  organizationId: string,
  reqLog: ReturnType<typeof log>,
): Promise<void> {
  const ownershipSql: Record<DiscussionTargetType, string> = {
    project: `select 1 from design_frames.project p where p.id = $1 and p.organization_id = $2`,
    feature: `select 1 from design_frames.feature f join design_frames.project p on p.id = f.project_id where f.id = $1 and p.organization_id = $2`,
    flow: `select 1 from design_frames.flow f
             left join design_frames.project direct_project on direct_project.id = f.project_id
             left join design_frames.feature feature on feature.id = f.feature_id
             left join design_frames.project feature_project on feature_project.id = feature.project_id
            where f.id = $1 and (direct_project.organization_id = $2 or feature_project.organization_id = $2)`,
    frame: `select 1 from design_frames.frame_ref r join design_frames.feature f on f.id = r.feature_id join design_frames.project p on p.id = f.project_id where r.id = $1 and p.organization_id = $2`,
    element: `select 1 from design_frames.frame_ref r join design_frames.feature f on f.id = r.feature_id join design_frames.project p on p.id = f.project_id where r.id = $1 and p.organization_id = $2`,
  };
  const { rows } = await query<{ exists: boolean }>(
    `select exists(${ownershipSql[targetType]}) as exists`,
    [targetRefUuid, organizationId],
    reqLog,
  );
  if (!rows[0]?.exists) throw new NotFoundError(`${targetType} not found`);
}

// Client authorType remains accepted for compatibility, but cannot override
// the verified delegated user or machine principal used for audit records.
function resolveActor(req: Request): { authorRef: string; authorType: 'user' | 'agent' } {
  const { actorRef, actorType } = authenticatedActor(req);
  return { authorRef: actorRef, authorType: actorType };
}

function toWireDiscussion(row: discussionRepo.DiscussionRow): ReturnType<typeof discussionRepo.toDiscussionDTO> {
  const entityType = DISCUSSION_TARGET_ENTITY_TYPE[row.target_type];
  return discussionRepo.toDiscussionDTO(row, fromUuid(entityType, row.target_ref));
}

// GET /api/v1/discussions?targetType=&targetRef=&resolved=&limit=&cursor=
discussionsRouter.get('/', async (req, res) => {
  const targetType = req.query.targetType as string | undefined;
  const targetRef = req.query.targetRef as string | undefined;
  if (!targetType || !VALID_TARGET_TYPES.has(targetType as DiscussionTargetType)) {
    throw new ValidationError('targetType is required and must be one of project|feature|flow|frame|element');
  }
  if (!targetRef) throw new ValidationError('targetRef is required');
  const entityType = DISCUSSION_TARGET_ENTITY_TYPE[targetType as DiscussionTargetType];
  let targetRefUuid: string;
  try {
    targetRefUuid = toUuid(assertRef(entityType, targetRef));
  } catch {
    throw new ValidationError(`targetRef is not a valid ${targetType} id`);
  }
  const resolvedParam = req.query.resolved;
  const resolved = resolvedParam === undefined ? null : resolvedParam === 'true';
  const page = parsePageParams(req.query as Record<string, unknown>);
  await requireTenantTarget(targetType as DiscussionTargetType, targetRefUuid, verifiedOrganizationId(req), log(req));
  const result = await discussionRepo.listByTarget(targetType as DiscussionTargetType, targetRefUuid, resolved, page, log(req));
  res.status(200).json({ items: result.items.map(toWireDiscussion), page: result.page });
});

// POST /api/v1/discussions — DiscussionCreate.
discussionsRouter.post('/', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const allowed = new Set(['targetType', 'targetRef', 'targetSelector', 'title']);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  const errors: string[] = [];
  if (unknown.length) errors.push(`unexpected propert${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}`);
  const targetType = body.targetType as string | undefined;
  if (!targetType || !VALID_TARGET_TYPES.has(targetType as DiscussionTargetType)) {
    errors.push('targetType is required and must be one of project|feature|flow|frame|element');
  }
  if (typeof body.targetRef !== 'string' || body.targetRef.length === 0) {
    errors.push('targetRef is required');
  }
  if (targetType === 'element' && !body.targetSelector) {
    errors.push('targetSelector is required when targetType=element');
  }
  if (errors.length) throw new ValidationError('invalid discussion create body', errors);

  const entityType = DISCUSSION_TARGET_ENTITY_TYPE[targetType as DiscussionTargetType];
  let targetRefId: EntityId<typeof entityType>;
  try {
    targetRefId = assertRef(entityType, body.targetRef);
  } catch {
    throw new ValidationError(`targetRef is not a valid ${targetType} id`);
  }
  const targetRefUuid = toUuid(targetRefId);

  // L0 (type) is enforced by assertRef above; a lightweight L1 existence
  // check keeps the documented 404 meaningful rather than always succeeding
  // for a well-formed-but-nonexistent reference.
  const exists = await targetExists(targetType as DiscussionTargetType, targetRefUuid, log(req));
  if (!exists) throw new NotFoundError(`${targetType} '${body.targetRef}' not found`);
  await requireTenantTarget(targetType as DiscussionTargetType, targetRefUuid, verifiedOrganizationId(req), log(req));

  if (targetType === 'element') {
    await assertSelectorExistsInRevision(targetRefUuid, body.targetSelector as string, log(req));
  }

  const row = await discussionRepo.createDiscussion(
    {
      targetType: targetType as DiscussionTargetType,
      targetRefUuid,
      targetSelector: (body.targetSelector as string | null) ?? null,
      title: (body.title as string | null) ?? null,
    },
    log(req)
  );
  res.status(201).json(toWireDiscussion(row));
});

async function assertSelectorExistsInRevision(frameRefUuid: string, selector: string, reqLog: ReturnType<typeof log>) {
  const frame = await frameRefRepo.resolveFrameRef(frameRefUuid, reqLog);
  if (!frame) throw new NotFoundError(`frame '${frameRefUuid}' not found`);
  const revision = await fileStore.getRevision(frame.feature_slug, frame.content_stamp);
  const html = revision.frames.get(frame.file);
  if (!html) throw new NotFoundError(`frame '${frame.file}' is not available in revision '${frame.content_stamp}'`);

  // The design-frames contract exposes component anchors as data-testhook or
  // data-testid attributes. Limiting discussion anchors to these selectors (or
  // `body` for frame-level feedback) keeps them portable across versions and
  // makes validation possible without executing arbitrary selector engines.
  if (selector === 'body') return;
  const match = /^\[data-(?:testhook|testid)=(?:"([^"]+)"|'([^']+)'|([^\]]+))\]$/.exec(selector);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!value) {
    throw new ValidationError('targetSelector must be body, [data-testhook=<value>], or [data-testid=<value>]');
  }
  const attr = selector.startsWith('[data-testhook=') ? 'data-testhook' : 'data-testid';
  const attribute = new RegExp(`\\b${attr}\\s*=\\s*(["'])${escapeRegExp(value)}\\1|\\b${attr}\\s*=\\s*${escapeRegExp(value)}(?=\\s|>|/)`, 'i');
  if (!attribute.test(html)) {
    throw new ValidationError(`targetSelector '${selector}' does not exist in revision '${frame.content_stamp}'`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function targetExists(targetType: DiscussionTargetType, uuid: string, reqLog: ReturnType<typeof log>): Promise<boolean> {
  const table =
    targetType === 'project' ? 'project' : targetType === 'feature' ? 'feature' : targetType === 'flow' ? 'flow' : 'frame_ref';
  const { rows } = await query<{ exists: boolean }>(
    `select exists(select 1 from design_frames.${table} where id = $1) as exists`,
    [uuid],
    reqLog
  );
  return rows[0]?.exists === true;
}

// GET /api/v1/discussions/:id
discussionsRouter.get('/:id', async (req, res) => {
  const id = assertRef('discussion', req.params.id) as EntityId<'discussion'>;
  const row = await discussionRepo.getDiscussion(id, log(req));
  await requireTenantTarget(row.target_type, row.target_ref, verifiedOrganizationId(req), log(req));
  const comments = await commentRepo.listByDiscussion(row.id, log(req));
  res.status(200).json({ ...toWireDiscussion(row), comments: comments.map(commentRepo.toCommentDTO) });
});

// PATCH /api/v1/discussions/:id — { resolved: boolean }
discussionsRouter.patch('/:id', async (req, res) => {
  const id = assertRef('discussion', req.params.id) as EntityId<'discussion'>;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.resolved !== 'boolean') throw new ValidationError('resolved (boolean) is required');
  const existing = await discussionRepo.getDiscussion(id, log(req));
  await requireTenantTarget(existing.target_type, existing.target_ref, verifiedOrganizationId(req), log(req));
  const row = await discussionRepo.setResolved(id, body.resolved, log(req));
  res.status(200).json(toWireDiscussion(row));
});

// POST /api/v1/discussions/:id/comments — CommentCreate.
discussionsRouter.post('/:id/comments', async (req, res) => {
  const id = assertRef('discussion', req.params.id) as EntityId<'discussion'>;
  const discussion = await discussionRepo.getDiscussion(id, log(req));
  await requireTenantTarget(discussion.target_type, discussion.target_ref, verifiedOrganizationId(req), log(req));
  const body = (req.body ?? {}) as Record<string, unknown>;
  // openapi.yaml CommentCreate: additionalProperties:false, properties
  // body/parentCommentId/authorType ONLY — no `authorRef` (see
  // resolveActor() above for why).
  const allowed = new Set(['body', 'parentCommentId', 'authorType']);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  const errors: string[] = [];
  if (unknown.length) errors.push(`unexpected propert${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}`);
  if (typeof body.body !== 'string' || body.body.length === 0) errors.push('body is required (non-empty string)');
  let parentCommentUuid: string | null = null;
  if (body.parentCommentId !== undefined && body.parentCommentId !== null) {
    try {
      parentCommentUuid = toUuid(assertRef('comment', body.parentCommentId));
    } catch {
      errors.push('parentCommentId is not a valid comment id');
    }
  }
  if (errors.length) throw new ValidationError('invalid comment create body', errors);

  const { authorRef, authorType } = resolveActor(req);
  const row = await commentRepo.insertComment(
    {
      discussionId: discussion.id,
      parentCommentId: parentCommentUuid,
      body: body.body as string,
      authorRef,
      authorType,
    },
    log(req)
  );
  res.status(201).json(commentRepo.toCommentDTO(row));
});

// GET /api/v1/features/:slug/discussions — convenience wrapper.
featureDiscussionsRouter.get('/:slug/discussions', async (req, res) => {
  const featureRow = await featureRepo.requireFeatureOwnedByOrganization(req.params.slug, verifiedOrganizationId(req), log(req));
  const resolvedParam = req.query.resolved;
  const resolved = resolvedParam === undefined ? null : resolvedParam === 'true';
  const page = parsePageParams(req.query as Record<string, unknown>);
  const result = await discussionRepo.listByTarget('feature', featureRow.id, resolved, page, log(req));
  res.status(200).json({ items: result.items.map(toWireDiscussion), page: result.page });
});
