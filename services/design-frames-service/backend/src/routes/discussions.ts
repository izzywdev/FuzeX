// routes/discussions.ts — /api/v1/discussions (+ nested comments) and the
// GET /api/v1/features/{slug}/discussions convenience route.

import { Router, type Request } from 'express';
import * as discussionRepo from '../repositories/discussionRepo';
import * as commentRepo from '../repositories/commentRepo';
import { requireFeatureRowBySlug } from '../repositories/featureRepo';
import {
  assertRef,
  fromUuid,
  toUuid,
  DISCUSSION_TARGET_ENTITY_TYPE,
  type DiscussionTargetType,
  type EntityId,
} from '../lib/identity';
import { NotFoundError, ValidationError } from '../lib/errors';
import { parsePageParams } from '../lib/pagination';
import { query } from '../lib/db';
import type { LoggedRequest } from '../lib/logger';

export const discussionsRouter = Router();
export const featureDiscussionsRouter = Router();

const VALID_TARGET_TYPES = new Set<DiscussionTargetType>(['project', 'feature', 'flow', 'frame', 'element']);

function log(req: Request) {
  return (req as LoggedRequest).log!;
}

// The Comment author reference is SERVER-DERIVED, never client-chosen
// (identifier-standard: "an id is never a capability" — a client must not
// be able to name who authored a row; openapi.yaml's CommentCreate is
// additionalProperties:false and declares NO `authorRef` property, only
// `body`/`parentCommentId`/`authorType`). This service authenticates writes
// with a single SHARED bearer token (middleware/auth.ts) rather than a
// per-user principal, so there is no real per-user identity to derive from
// yet — this constant stands in for "the authenticated service actor" until
// the auth model carries one. See PR description: a richer per-user
// authorRef needs a per-user auth model upstream of this service.
const SERVICE_ACTOR_REF = 'service-actor';

function resolveActor(body: Record<string, unknown>): { authorRef: string; authorType: 'user' | 'agent' } {
  const authorType = body.authorType === 'agent' ? 'agent' : 'user';
  return { authorRef: SERVICE_ACTOR_REF, authorType };
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
  const comments = await commentRepo.listByDiscussion(row.id, log(req));
  res.status(200).json({ ...toWireDiscussion(row), comments: comments.map(commentRepo.toCommentDTO) });
});

// PATCH /api/v1/discussions/:id — { resolved: boolean }
discussionsRouter.patch('/:id', async (req, res) => {
  const id = assertRef('discussion', req.params.id) as EntityId<'discussion'>;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.resolved !== 'boolean') throw new ValidationError('resolved (boolean) is required');
  const row = await discussionRepo.setResolved(id, body.resolved, log(req));
  res.status(200).json(toWireDiscussion(row));
});

// POST /api/v1/discussions/:id/comments — CommentCreate.
discussionsRouter.post('/:id/comments', async (req, res) => {
  const id = assertRef('discussion', req.params.id) as EntityId<'discussion'>;
  const discussion = await discussionRepo.getDiscussion(id, log(req));
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

  const { authorRef, authorType } = resolveActor(body);
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
  const featureRow = await requireFeatureRowBySlug(req.params.slug, log(req));
  const resolvedParam = req.query.resolved;
  const resolved = resolvedParam === undefined ? null : resolvedParam === 'true';
  const page = parsePageParams(req.query as Record<string, unknown>);
  const result = await discussionRepo.listByTarget('feature', featureRow.id, resolved, page, log(req));
  res.status(200).json({ items: result.items.map(toWireDiscussion), page: result.page });
});
