// pagination.ts — the baseline cursor-pagination envelope (baseline §4.1 /
// governance/pagination-standard.md): { items, page: { nextCursor, hasMore,
// total? } }, limit default 50 / max 200 (clamped server-side, never
// rejected), opaque forward cursor encoding the sort key + a tiebreaker id
// so concurrent writes can't produce gaps/dupes while walking the full set.

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface PageParams {
  limit: number;
  cursor: string | null;
}

export interface PageInfo {
  nextCursor: string | null;
  hasMore: boolean;
  total?: number | null;
}

export interface Page<T> {
  items: T[];
  page: PageInfo;
}

/** Parses `?limit=&cursor=` off a query object, clamping an over-max limit
 * rather than rejecting it, and falling back to the default for anything
 * non-numeric or below 1. */
export function parsePageParams(query: Record<string, unknown>): PageParams {
  let limit = DEFAULT_LIMIT;
  const raw = query.limit;
  if (raw !== undefined && raw !== null && raw !== '') {
    const n = Number(Array.isArray(raw) ? raw[0] : raw);
    if (Number.isFinite(n) && n >= 1) {
      limit = Math.min(Math.floor(n), MAX_LIMIT);
    }
  }
  const rawCursor = query.cursor;
  const cursor =
    typeof rawCursor === 'string' && rawCursor.length > 0
      ? rawCursor
      : Array.isArray(rawCursor) && typeof rawCursor[0] === 'string' && rawCursor[0].length > 0
        ? (rawCursor[0] as string)
        : null;
  return { limit, cursor };
}

export interface CursorPayload {
  /** The sort-key value (e.g. an ISO timestamp) of the last row on the prior page. */
  v: string;
  /** The tiebreaker id of that same row, so equal sort-key values don't repeat/skip. */
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export class InvalidCursorError extends Error {
  code = 'VALIDATION' as const;
  constructor(message = 'invalid cursor') {
    super(message);
    this.name = 'InvalidCursorError';
  }
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).v !== 'string' ||
      typeof (parsed as Record<string, unknown>).id !== 'string'
    ) {
      throw new Error('shape');
    }
    return parsed as CursorPayload;
  } catch {
    throw new InvalidCursorError();
  }
}

/** Builds the page envelope from a "fetched limit+1 rows" pattern. */
export function buildPage<Row, Item>(
  rows: Row[],
  limit: number,
  toItem: (row: Row) => Item,
  toCursor: (row: Row) => CursorPayload,
  total?: number | null
): Page<Item> {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? encodeCursor(toCursor(pageRows[pageRows.length - 1])) : null;
  return {
    items: pageRows.map(toItem),
    page: { nextCursor, hasMore, total: total ?? null },
  };
}
