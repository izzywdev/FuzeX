// fileStore.ts — typed wrapper around ../../../lib/store.js, the EXISTING
// flat-file content tier (tier 1 of docs/postgres-tier.md's two-tier model).
// Frame CONTENT never enters Postgres; this module is how the new tier reads
///writes it, so store.js's actual behaviour is reused rather than
// reimplemented. Never rewritten — see docs/postgres-tier.md "Migration
// path" step 3.

/* eslint-disable @typescript-eslint/no-var-requires */
import * as path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = require(path.join(__dirname, '..', '..', '..', 'lib', 'store.js'));

export interface StoreFeature {
  slug: string;
  manifest: Record<string, unknown>;
  frames: Map<string, string>;
}

export interface FeatureSummary {
  slug: string;
  name: string;
  description: string;
  sourceRepo: string | null;
  stamp: string | null;
  frameCount: number;
  flows: Array<{ id: string; approved: boolean }>;
}

export const DATA_DIR: string = store.DATA_DIR;

export const listFeatures: () => Promise<FeatureSummary[]> = store.listFeatures;
export const featureExists: (slug: string) => Promise<boolean> = store.featureExists;
export const createFeature: (
  slug: string,
  manifest: Record<string, unknown>
) => Promise<StoreFeature> = store.createFeature;
export const getManifest: (slug: string) => Promise<Record<string, unknown>> = store.getManifest;
export const getFeature: (slug: string) => Promise<StoreFeature> = store.getFeature;
export const putManifest: (
  slug: string,
  manifest: Record<string, unknown>
) => Promise<StoreFeature> = store.putManifest;
export const putFrame: (slug: string, file: string, html: string) => Promise<void> = store.putFrame;
export const getFrame: (slug: string, file: string) => Promise<string> = store.getFrame;
export const deleteFrame: (slug: string, file: string) => Promise<void> = store.deleteFrame;
export const setStamp: (slug: string, stamp: string) => Promise<Record<string, unknown>> = store.setStamp;

/**
 * Dual-write target for the append-only approval log: keeps
 * manifest.build.flows[].approved/approvedBy/approvedAt in sync so any
 * legacy reader of the flat file (or ../server.js) still sees a sane value,
 * even though — per docs/postgres-tier.md — the Postgres approval table is
 * now the actual source of truth and this is only a projection target.
 */
export const setFlowApproval: (
  slug: string,
  flowId: string,
  approval: Record<string, unknown>
) => Promise<Record<string, unknown>> = store.setFlowApproval;

export const StoreNotFoundError: new (message: string) => Error = store.NotFoundError;
export const StoreConflictError: new (message: string) => Error = store.ConflictError;
export const StoreValidationError: new (message: string, details?: string[]) => Error =
  store.ValidationError;
