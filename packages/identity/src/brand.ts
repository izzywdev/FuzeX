// brand.ts — the branded EntityId<T> type. A raw `string` off req.body must
// not compile against a repository/handler signature that takes EntityId<T>
// (governance/identifier-standard.md §9 "compile-time (primary)").

import type { EntityType } from './registry';

declare const __entityIdBrand: unique symbol;

/** Opaque, type-tagged id. Never construct via `as EntityId<T>` — mint or parse. */
export type EntityId<T extends EntityType> = string & { readonly [__entityIdBrand]: T };

export type IdentityErrorCode =
  | 'MALFORMED_ID'
  | 'PREFIX_MISMATCH'
  | 'UNKNOWN_PREFIX'
  | 'LEGACY_NOT_PERMITTED';

export class IdentityError extends Error {
  readonly code: IdentityErrorCode;
  readonly entityType: EntityType;

  constructor(code: IdentityErrorCode, entityType: EntityType, message: string) {
    super(message);
    this.name = 'IdentityError';
    this.code = code;
    this.entityType = entityType;
  }
}
