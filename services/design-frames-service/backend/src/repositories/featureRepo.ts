// featureRepo.ts — design_frames.feature (fxdf_ftr_*). `slug` stays the
// wire-addressable key (v0.1.0 compatibility); `id` is the actual identity.
// A feature that already exists on disk (created via ../../server.js, or
// pre-backfill) but has no Postgres row yet is indexed lazily on first
// touch — the same create-on-first-use pattern db/migrations/0005 documents
// for `flow`.

import { query } from '../lib/db';
import { mintId, toUuid, fromUuid, type EntityId } from '../lib/identity';
import { NotFoundError } from '../lib/errors';
import type { ReqLogger } from '../lib/logger';
import * as fileStore from '../lib/fileStore';
import { buildPage, decodeCursor, type Page, type PageParams } from '../lib/pagination';
import type { FeatureSummary } from '../lib/fileStore';

export interface FeatureRow {
  id: string;
  slug: string;
  project_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const UNIQUE_VIOLATION = '23505';

export async function findFeatureBySlug(slug: string, log: ReqLogger): Promise<FeatureRow | null> {
  const { rows } = await query<FeatureRow>(`select * from design_frames.feature where slug = $1`, [slug], log);
  return rows[0] ?? null;
}

export async function createFeatureRow(
  slug: string,
  projectId: EntityId<'project'> | null,
  log: ReqLogger
): Promise<FeatureRow> {
  const id = mintId('feature');
  const { rows } = await query<FeatureRow>(
    `insert into design_frames.feature (id, slug, project_id) values ($1, $2, $3) returning *`,
    [toUuid(id), slug, projectId ? toUuid(projectId) : null],
    log
  );
  return rows[0];
}

/** Indexes a feature that already exists on disk but has no Postgres row yet. */
export async function findOrCreateFeatureBySlug(slug: string, log: ReqLogger): Promise<FeatureRow> {
  const existing = await findFeatureBySlug(slug, log);
  if (existing) return existing;
  try {
    return await createFeatureRow(slug, null, log);
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      const retry = await findFeatureBySlug(slug, log);
      if (retry) return retry;
    }
    throw err;
  }
}

export async function requireFeatureRowBySlug(slug: string, log: ReqLogger): Promise<FeatureRow> {
  // A feature is only real if the CONTENT tier says so — the file store is
  // the source of truth for existence (docs/postgres-tier.md two-tier model).
  if (!(await fileStore.featureExists(slug))) {
    throw new NotFoundError(`feature '${slug}' not found`);
  }
  return findOrCreateFeatureBySlug(slug, log);
}

export function featureIdWire(row: FeatureRow): EntityId<'feature'> {
  return fromUuid('feature', row.id);
}

export async function listFeaturesByProject(
  projectUuid: string,
  page: PageParams,
  log: ReqLogger
): Promise<Page<FeatureSummary>> {
  const params: unknown[] = [projectUuid];
  let extraWhere = '';
  if (page.cursor) {
    const { v, id } = decodeCursor(page.cursor);
    params.push(v, id);
    extraWhere = ` and (created_at, slug) > ($2, $3)`;
  }
  params.push(page.limit + 1);
  const { rows } = await query<FeatureRow>(
    `select * from design_frames.feature where project_id = $1${extraWhere}
     order by created_at asc, slug asc limit $${params.length}`,
    params,
    log
  );

  const hasMore = rows.length > page.limit;
  const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
  const items: FeatureSummary[] = [];
  for (const row of pageRows) {
    try {
      const manifest = await fileStore.getManifest(row.slug);
      const flows = ((manifest.build as { flows?: Array<{ id: string; approved?: boolean }> } | undefined)?.flows) ?? [];
      items.push({
        slug: row.slug,
        name: String(manifest.name ?? row.slug),
        description: String(manifest.description ?? ''),
        sourceRepo: (manifest.sourceRepo as string | null) ?? null,
        stamp: (manifest.stamp as string | null) ?? null,
        frameCount: Array.isArray(manifest.frames) ? (manifest.frames as unknown[]).length : 0,
        flows: flows.map((f) => ({ id: f.id, approved: !!f.approved })),
      });
    } catch {
      // Postgres row exists but the file content is missing (shouldn't
      // happen outside a broken rollout) — skip rather than 500 the page.
    }
  }
  const nextCursor = hasMore
    ? Buffer.from(
        JSON.stringify({ v: pageRows[pageRows.length - 1].created_at.toISOString(), id: pageRows[pageRows.length - 1].slug }),
        'utf8'
      ).toString('base64url')
    : null;
  return { items, page: { nextCursor, hasMore, total: null } };
}
