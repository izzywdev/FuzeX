// registry.ts — FuzeX's OWN entity-type -> wire-prefix map.
//
// governance/identifier-standard.md #2: "Each repo keeps its own registry.
// There is deliberately no central one... Repo names are unique within the
// org, so a product namespace is self-allocating." This repo's namespace is
// declared in .fuze/manifest.json as `identity.namespace = "fxdf"`
// (services/design-frames-service/docs/postgres-tier.md — the frozen
// contract that reserves these prefixes). Every prefix below already carries
// that namespace, so `gate_identifier.py --namespace` (N1b) is satisfied
// without a reserved spine entry.
//
// Adding a type here is the ONLY way to mint ids for it (mintId() below).
// Prefixes are permanent once shipped.

export const ENTITY_PREFIXES = {
  project: 'fxdf_prj',
  feature: 'fxdf_ftr',
  flow: 'fxdf_flw',
  frameRef: 'fxdf_frm',
  approval: 'fxdf_apr',
  discussion: 'fxdf_dsc',
  comment: 'fxdf_cmt',
} as const;

export type EntityType = keyof typeof ENTITY_PREFIXES;
export type EntityPrefix = (typeof ENTITY_PREFIXES)[EntityType];

const TYPE_BY_PREFIX: Record<string, EntityType> = Object.freeze(
  Object.fromEntries(
    Object.entries(ENTITY_PREFIXES).map(([type, prefix]) => [prefix, type as EntityType])
  )
);

export function prefixFor(type: EntityType): EntityPrefix {
  return ENTITY_PREFIXES[type];
}

export function typeForPrefix(prefix: string): EntityType | null {
  return TYPE_BY_PREFIX[prefix] ?? null;
}

export function isEntityType(value: string): value is EntityType {
  return Object.prototype.hasOwnProperty.call(ENTITY_PREFIXES, value);
}

export const ENTITY_TYPES = Object.keys(ENTITY_PREFIXES) as readonly EntityType[];
