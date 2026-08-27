// commentRepo.ts — design_frames.comment (fxdf_cmt_*). APPEND-ONLY +
// threaded (nullable self-FK) + soft-delete. This repo never issues an
// UPDATE/DELETE itself — comment_guard() (db/migrations/0002_functions.sql)
// enforces the invariant at the database layer; soft-delete is intentionally
// NOT exposed by any route in this contract version (openapi.yaml has no
// DELETE .../comments/{id}), so this repo only INSERTs and SELECTs.

import { query } from '../lib/db';
import { mintId, toUuid, fromUuid, type EntityId } from '../lib/identity';
import type { ReqLogger } from '../lib/logger';

export type AuthorType = 'user' | 'agent';

export interface CommentRow {
  id: string;
  discussion_id: string;
  parent_comment_id: string | null;
  body: string;
  author_ref: string;
  author_type: AuthorType;
  deleted_at: Date | null;
  created_at: Date;
}

export interface CommentDTO {
  id: EntityId<'comment'>;
  discussionId: EntityId<'discussion'>;
  parentCommentId: EntityId<'comment'> | null;
  body: string;
  authorRef: string;
  authorType: AuthorType;
  deleted: boolean;
  createdAt: string;
}

export function toCommentDTO(row: CommentRow): CommentDTO {
  return {
    id: fromUuid('comment', row.id),
    discussionId: fromUuid('discussion', row.discussion_id),
    parentCommentId: row.parent_comment_id ? fromUuid('comment', row.parent_comment_id) : null,
    body: row.body,
    authorRef: row.author_ref,
    authorType: row.author_type,
    deleted: row.deleted_at !== null,
    createdAt: row.created_at.toISOString(),
  };
}

export interface CommentCreateInput {
  discussionId: string;
  parentCommentId: string | null;
  body: string;
  authorRef: string;
  authorType: AuthorType;
}

export async function insertComment(input: CommentCreateInput, log: ReqLogger): Promise<CommentRow> {
  const id = mintId('comment');
  const { rows } = await query<CommentRow>(
    `insert into design_frames.comment (id, discussion_id, parent_comment_id, body, author_ref, author_type)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [toUuid(id), input.discussionId, input.parentCommentId, input.body, input.authorRef, input.authorType],
    log
  );
  return rows[0];
}

export async function listByDiscussion(discussionId: string, log: ReqLogger): Promise<CommentRow[]> {
  const { rows } = await query<CommentRow>(
    `select * from design_frames.comment where discussion_id = $1 order by created_at asc, id asc`,
    [discussionId],
    log
  );
  return rows;
}
