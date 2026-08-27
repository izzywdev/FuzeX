// id.ts — mint, parse and assert FuzeX entity identifiers.
//
// Wire form:    fxdf_prj_01h455vb4pex5vsknk084sn02q  (crosses the API boundary)
// Storage form: 0195a8f2-6c3d-7f11-8b2e-...           (native Postgres `uuid`)
//
// Independent re-implementation of @izzywdev/fuzefront-identity's id.ts
// (same shape, same rules — governance/identifier-standard.md), scoped to
// this repo's own registry (./registry.ts). See ../README.md for why this
// module exists instead of depending on the published package.

import {
  bytesToUuid,
  decodeSuffix,
  encodeSuffix,
  isUuid,
  isValidSuffix,
  uuidToBytes,
  uuidv7Bytes,
} from './codec';
import { EntityId, IdentityError } from './brand';
import { EntityType, prefixFor, typeForPrefix } from './registry';

export interface IdentityConfig {
  /** Entity types whose stored rows may still carry a bare UUID (dual-accept window). */
  legacyUuidTypes: ReadonlySet<EntityType>;
}

let config: IdentityConfig = {
  legacyUuidTypes: new Set<EntityType>(),
};

export function configureIdentity(next: Partial<IdentityConfig>): void {
  config = { ...config, ...next };
}

export function getIdentityConfig(): IdentityConfig {
  return config;
}

function split(raw: string): { prefix: string; suffix: string } | null {
  const separator = raw.lastIndexOf('_');
  if (separator <= 0 || separator === raw.length - 1) return null;
  return { prefix: raw.slice(0, separator), suffix: raw.slice(separator + 1) };
}

/** Mints a fresh, server-owned id for `type`. The ONLY id constructor. */
export function mintId<T extends EntityType>(type: T): EntityId<T> {
  return `${prefixFor(type)}_${encodeSuffix(uuidv7Bytes())}` as EntityId<T>;
}

/**
 * Validates that `raw` is an id of `type` and returns it branded. Throws
 * `IdentityError` on any mismatch (wrong type, malformed, unregistered
 * prefix). A string compare — no network, no cache, no database.
 */
export function parseId<T extends EntityType>(type: T, raw: unknown): EntityId<T> {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new IdentityError('MALFORMED_ID', type, `expected a ${type} id, received ${typeof raw}`);
  }

  const parts = split(raw);
  if (!parts) {
    if (isUuid(raw)) {
      if (config.legacyUuidTypes.has(type)) return raw as EntityId<T>;
      throw new IdentityError(
        'LEGACY_NOT_PERMITTED',
        type,
        `bare UUID supplied for ${type}; prefixed ids are required for this type`
      );
    }
    throw new IdentityError('MALFORMED_ID', type, `not a valid ${type} id`);
  }

  const expected = prefixFor(type);
  if (parts.prefix !== expected) {
    const actual = typeForPrefix(parts.prefix);
    throw new IdentityError(
      actual ? 'PREFIX_MISMATCH' : 'UNKNOWN_PREFIX',
      type,
      actual
        ? `expected a ${type} id (${expected}_), received a ${actual} id (${parts.prefix}_)`
        : `expected a ${type} id (${expected}_), received unregistered prefix ${parts.prefix}_`
    );
  }

  if (!isValidSuffix(parts.suffix)) {
    throw new IdentityError('MALFORMED_ID', type, `${type} id has a malformed suffix`);
  }

  return raw as EntityId<T>;
}

/** Validates a REFERENCE to an entity of `type` (L0 check). Alias of parseId. */
export const assertRef = parseId;

export function tryParseId<T extends EntityType>(type: T, raw: unknown): EntityId<T> | null {
  try {
    return parseId(type, raw);
  } catch {
    return null;
  }
}

export function isId<T extends EntityType>(type: T, raw: unknown): raw is EntityId<T> {
  return tryParseId(type, raw) !== null;
}

/** Wire form -> storage form. Accepts a legacy bare UUID unchanged. */
export function toUuid<T extends EntityType>(id: EntityId<T>): string {
  const parts = split(id);
  if (!parts) return id; // legacy bare UUID, already storage-shaped
  return bytesToUuid(decodeSuffix(parts.suffix));
}

/** Storage form -> wire form. The inverse of `toUuid`. */
export function fromUuid<T extends EntityType>(type: T, uuid: string): EntityId<T> {
  return `${prefixFor(type)}_${encodeSuffix(uuidToBytes(uuid))}` as EntityId<T>;
}

/** The entity type `raw` declares itself to be. Never for authorization. */
export function entityTypeOf(raw: string): EntityType | null {
  const parts = split(raw);
  if (!parts || !isValidSuffix(parts.suffix)) return null;
  return typeForPrefix(parts.prefix);
}
