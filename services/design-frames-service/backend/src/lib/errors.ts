// errors.ts — typed application errors + the Express error-handling middleware.
// `.code` is read by errorStatus() AND happens to match the `.code` shape
// lib/store.js's errors already carry (NOT_FOUND/CONFLICT/VALIDATION), so
// errors bubbling up from the reused file-store code map correctly without
// any remapping.

import type { NextFunction, Request, Response } from 'express';
import type { LoggedRequest } from './logger';

export class NotFoundError extends Error {
  code = 'NOT_FOUND' as const;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  code = 'CONFLICT' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends Error {
  code = 'VALIDATION' as const;
  details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export class UnauthorizedError extends Error {
  code = 'UNAUTHORIZED' as const;
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class StampConflictError extends Error {
  code = 'STAMP_CONFLICT' as const;
  expectedStamp: string;
  suppliedStamp: string;
  constructor(expectedStamp: string, suppliedStamp: string) {
    super("supplied contentStamp does not match the feature's current stamp (stale review)");
    this.name = 'StampConflictError';
    this.expectedStamp = expectedStamp;
    this.suppliedStamp = suppliedStamp;
  }
}

interface CodedError extends Error {
  code?: string;
  details?: string[];
  expectedStamp?: string;
  suppliedStamp?: string;
}

export function errorStatus(err: CodedError): number {
  // @fuzex/identity's assertRef/parseId throws IdentityError (MALFORMED_ID /
  // PREFIX_MISMATCH / UNKNOWN_PREFIX / LEGACY_NOT_PERMITTED) for a
  // malformed or wrong-type reference — always a client error (400), never
  // a server fault.
  if (err.name === 'IdentityError') return 400;
  switch (err.code) {
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
      return 409;
    case 'STAMP_CONFLICT':
      return 409;
    case 'VALIDATION':
    case 'BAD_JSON':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case '23505': // pg unique_violation surfaced without our own wrapper
      return 409;
    case '23514': // pg check_violation
      return 400;
    default:
      return 500;
  }
}

export function errorHandler(
  err: CodedError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const log = (req as LoggedRequest).log ?? undefined;
  const status = errorStatus(err);
  if (log) {
    if (status >= 500) log.error({ err, status }, 'request failed');
    else log.warn({ err: err.message, code: err.code, status }, 'request rejected');
  }
  if (err.code === 'STAMP_CONFLICT') {
    res.status(status).json({
      error: err.message,
      expectedStamp: err.expectedStamp,
      suppliedStamp: err.suppliedStamp,
    });
    return;
  }
  if (status >= 500) {
    res.status(500).json({ error: 'internal server error' });
    return;
  }
  res.status(status).json({ error: err.message, details: err.details });
}
