// auth.ts — bearer-token auth for writes, mirroring ../../server.js's
// convention exactly (same env var, same timing-safe compare, same
// no-tokens-configured => open-for-local-dev fallback) so operators do not
// need a second mental model for the two tiers.

import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../lib/errors';

const TOKENS = new Set(
  (process.env.DESIGN_FRAMES_API_TOKENS || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
);

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // constant-time-ish: still do a compare of equal-length buffers so the
    // early return on length doesn't dominate timing for near-miss lengths.
    timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function extractBearer(req: Request): string | null {
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

export function requireAuthForWrites(req: Request, _res: Response, next: NextFunction): void {
  if (!WRITE_METHODS.has(req.method)) return next();
  if (TOKENS.size === 0) return next(); // local dev with no token configured
  const provided = extractBearer(req);
  if (provided) {
    for (const t of TOKENS) {
      if (safeCompare(provided, t)) return next();
    }
  }
  next(new UnauthorizedError('Unauthorized — Bearer token required for write operations'));
}

export const __testables = { safeCompare, extractBearer, TOKENS };
