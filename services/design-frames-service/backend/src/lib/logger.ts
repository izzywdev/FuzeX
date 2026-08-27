// logger.ts — the ONE shared pino logger for this tier (logging skill §1/§5).
// Structured JSON, leveled via LOG_LEVEL (no redeploy needed to go verbose),
// secrets redacted at the logger so no call site has to remember to omit
// them.

import pino from 'pino';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.access_token',
      '*.refresh_token',
      '*.id_token',
      '*.code',
      '*.otp',
      '*.client_secret',
      '*.apiKey',
      '*.secret',
      'password',
      'token',
      'authorization',
      'cookie',
    ],
    censor: '[REDACTED]',
  },
  base: { service: process.env.SERVICE_NAME ?? 'design-frames-service-pg' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type ReqLogger = pino.Logger;

export interface LoggedRequest extends Request {
  reqId?: string;
  log?: ReqLogger;
}

/** Binds a per-request child logger with a correlation id (logging skill §4). */
export function requestLogger(req: LoggedRequest, res: Response, next: NextFunction): void {
  const inbound = req.headers['x-request-id'];
  const reqId = (Array.isArray(inbound) ? inbound[0] : inbound) || randomUUID();
  req.reqId = reqId;
  req.log = logger.child({ reqId, route: req.path, method: req.method });
  req.log.info('request received');
  res.on('finish', () => {
    req.log!.info({ status: res.statusCode }, 'request completed');
  });
  next();
}

/** Boundary helper: every external call (pg, fs) logs start + end + elapsedMs. */
export async function timed<T>(
  log: ReqLogger,
  op: string,
  fn: () => Promise<T>,
  meta: Record<string, unknown> = {}
): Promise<T> {
  const start = performance.now();
  log.debug({ op, ...meta }, `${op} start`);
  try {
    const out = await fn();
    log.debug({ op, elapsedMs: Math.round(performance.now() - start) }, `${op} end`);
    return out;
  } catch (err) {
    log.error({ op, elapsedMs: Math.round(performance.now() - start), err }, `${op} failed`);
    throw err;
  }
}
