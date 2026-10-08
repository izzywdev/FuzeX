// auth.ts — write-path authN for the Postgres lifecycle tier.
//
// Callers present a FuzeFront-issued MACHINE token (OAuth2 client-credentials),
// verified per request against FuzeFront's own
// `POST /api/v1/security/tokens/introspect` via the published runtime binding
// `@izzywdev/fuzefront-service-auth`. This tier never talks to the identity
// provider directly.
//
// ─── What this replaced, and why it was worse than it looked ───
//
// The previous implementation matched a bearer against DESIGN_FRAMES_API_TOKENS,
// a comma-separated list of pre-shared secrets, and opened with:
//
//     if (TOKENS.size === 0) return next();   // "local dev with no token configured"
//
// An UNSET secret therefore made every write UNAUTHENTICATED — while
// deploy/helm/fuzex/templates/deployment.yaml mounted it `optional: true` and
// asserted in a comment that absent the secret "EVERY write 401s — a safe
// default". The code did the exact opposite of the deployment's stated
// invariant, so any environment missing the secret served an open write API
// while the documentation said it was closed. Issue #26 called for removing the
// token; the open-by-default path is the reason it could not simply be dropped.
//
// There is no equivalent mode below. No token is a denial. An unverifiable
// token is a denial. A misconfigured service denies everything rather than
// admitting anyone.
//
// ─── Fail-closed: why this cannot branch on the HTTP status ───
//
// Introspection answers HTTP 200 for EVERY token, valid or not — an unknown,
// expired or revoked token comes back `200 { "active": false }`. Treating 200
// as success would accept every token ever presented: a total authentication
// bypass that no happy-path test would catch. `verifyMachineToken` branches on
// the `active` boolean in the response BODY and throws on every ambiguity
// (network error, timeout, non-200, unparsable body, missing or non-boolean
// `active`, missing `subject`). Every one of those becomes a denial here.

import {
  createMachineTokenVerifier,
  type MachineIdentity,
  type MachineTokenVerifier,
} from '@izzywdev/fuzefront-service-auth';
import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';

/** Requests that have passed `requireAuthForWrites` carry the verified caller. */
export interface AuthenticatedRequest extends Request {
  machineIdentity?: MachineIdentity;
  delegatedIdentity?: MachineIdentity;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * FuzeFront's ORIGIN, e.g. `https://app.fuzefront.com` — NOT including `/api`.
 * The verifier appends the full contract path itself, so a value ending in
 * `/api` produces `/api/api/v1/...` and 404s. A 404 is treated as a denial, so
 * getting this wrong fails CLOSED (every write 401s) rather than open.
 */
const FUZEFRONT_API_URL = process.env.FUZEFRONT_API_URL;

/** Scope a machine token must carry to write. */
export const REQUIRED_SCOPE = process.env.DESIGN_FRAMES_REQUIRED_SCOPE || 'fuzex:frames:write';
export const READ_SCOPE = 'fuzex:frames:read';
export const DELEGATION_AUDIENCE = 'service:fuzex';

if (!FUZEFRONT_API_URL && process.env.NODE_ENV === 'production') {
  // Refuse to boot rather than serve writes we cannot authenticate. The
  // mechanism this replaced would, in the same situation, have served them.
  throw new Error('FUZEFRONT_API_URL must be set in production');
}

const verifier: MachineTokenVerifier = createMachineTokenVerifier({
  baseUrl: FUZEFRONT_API_URL || 'http://fuzefront-api.invalid',
  // Resolved at CALL time so a test can install a stub after this module loads.
  fetch: (input, init) => (globalThis.fetch as unknown as typeof fetch)(input, init) as never,
  // POSITIVE results only. The package never caches a negative verdict, so a
  // revocation is visible on the very next request regardless of this value.
  cacheTtlSeconds: Number(process.env.DESIGN_FRAMES_INTROSPECTION_CACHE_SECONDS ?? 5),
});

function extractBearer(req: Request, name = 'authorization'): string | null {
  const header = req.headers[name];
  if (typeof header !== 'string') return null;
  return /^Bearer ([^\s,]+)$/.exec(header)?.[1] ?? null;
}

// Read verified introspection claims from raw as well: older published
// service-auth versions preserve them there without normalizing these fields.
function delegationClaims(identity: MachineIdentity): {
  tokenKind?: string; audience?: string; actor?: { sub?: string };
} {
  return identity.raw as ReturnType<typeof delegationClaims>;
}

/** Audit attribution always comes from a verified principal, never JSON. */
export function authenticatedActor(req: AuthenticatedRequest): { actorRef: string; actorType: 'user' | 'agent' } {
  if (req.delegatedIdentity) return { actorRef: req.delegatedIdentity.subject, actorType: 'user' };
  if (req.machineIdentity) return { actorRef: req.machineIdentity.subject, actorType: 'agent' };
  throw new UnauthorizedError('a verified caller is required');
}

/**
 * Gate every write method behind a verified FuzeFront machine identity.
 *
 * Public reads remain supported. A presented delegation is always checked,
 * including on reads: malformed or invalid credentials never silently become
 * an anonymous request. Hosted browsers carry only their FuzeFront session;
 * its server exchanges it and supplies both credentials below.
 *
 * Errors go to the shared `errorHandler` as typed errors rather than being
 * written here, so this tier keeps ONE error-body shape across every route.
 * That is also why the package's `requireMachineAuth` Express helper is not
 * used directly: it writes its own `{error, code}` response, which would give
 * this service two different error contracts depending on which middleware
 * rejected you. The fail-closed decision logic — the part that actually matters
 * — is `verifyMachineToken`, and that IS the package's.
 */
export function requireAuthForWrites(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  const isWrite = WRITE_METHODS.has(req.method);
  const hasDelegation = req.headers['x-fuze-delegation'] !== undefined;
  if (!isWrite && !hasDelegation) {
    next();
    return;
  }

  const token = extractBearer(req);
  const delegationToken = extractBearer(req, 'x-fuze-delegation');
  if (!token || (hasDelegation && !delegationToken)) {
    next(
      new UnauthorizedError(
        'Unauthorized — a FuzeFront machine token is required for write operations'
      )
    );
    return;
  }

  Promise.all([
    verifier.verifyMachineToken(token),
    delegationToken ? verifier.verifyMachineToken(delegationToken) : Promise.resolve(null),
  ])
    .then(([identity, delegated]) => {
      const machineClaims = delegationClaims(identity);
      if (delegated) {
        const claims = delegationClaims(delegated);
        const requiredScope = isWrite ? REQUIRED_SCOPE : READ_SCOPE;
        if (
          machineClaims.tokenKind !== 'fuze-workload' ||
          claims.tokenKind !== 'fuze-delegation' ||
          claims.audience !== DELEGATION_AUDIENCE ||
          claims.actor?.sub !== identity.subject ||
          !delegated.scopes.includes(requiredScope) ||
          (identity.tenantId !== null && identity.tenantId !== delegated.tenantId)
        ) {
          next(new ForbiddenError('Forbidden — delegation does not authorize this caller or operation'));
          return;
        }
        req.delegatedIdentity = delegated;
      } else if (machineClaims.tokenKind === 'fuze-delegation') {
        next(new ForbiddenError('Forbidden — delegation requires its authenticated service actor'));
        return;
      } else if (!identity.scopes.includes(REQUIRED_SCOPE)) {
        next(new ForbiddenError(`Forbidden — token lacks the ${REQUIRED_SCOPE} scope`));
        return;
      }
      req.machineIdentity = identity;
      next();
    })
    .catch(() => {
      // Deliberately opaque to the caller, and deliberately unconditional: an
      // inactive token, an unreachable FuzeFront, and a malformed introspection
      // body are all the same answer here — no.
      next(new UnauthorizedError('Unauthorized — token could not be verified'));
    });
}

export const __testables = { extractBearer, verifier, REQUIRED_SCOPE };
