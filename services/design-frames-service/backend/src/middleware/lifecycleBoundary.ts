import type { NextFunction, Response } from 'express';
import { query } from '../lib/db';
import { ForbiddenError } from '../lib/errors';
import type { AuthenticatedRequest } from './auth';

/**
 * Fail closed only on a known local revocation/tombstone. A missing projection
 * is permitted for rollout/backfill; authorization itself is still evaluated
 * live by FuzeFront Security in requireFuzeFrontAuthorization.
 */
export async function requireLifecycleBoundary(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    const identity = req.delegatedIdentity ?? req.machineIdentity;
    const organizationId = identity?.tenantId;
    if (!identity || !organizationId) throw new ForbiddenError('FuzeX requires a tenant-scoped FuzeFront identity');
    const tenant = await query<{ is_active: boolean; deleted_at: Date | null }>(
      'select is_active, deleted_at from design_frames.tenant_lifecycle_state where organization_id = $1', [organizationId],
    );
    if (tenant.rows[0] && (!tenant.rows[0].is_active || tenant.rows[0].deleted_at)) throw new ForbiddenError('FuzeX tenant is inactive or deleted');
    if (req.delegatedIdentity) {
      const membership = await query<{ is_active: boolean }>(
        'select is_active from design_frames.tenant_membership_state where organization_id = $1 and user_id = $2', [organizationId, req.delegatedIdentity.subject],
      );
      if (membership.rows[0] && !membership.rows[0].is_active) throw new ForbiddenError('FuzeX membership has been revoked');
    }
    next();
  } catch (error) { next(error); }
}

