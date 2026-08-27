// stampLib.ts — typed wrapper around ../../../lib/stamp.js (computeStamp),
// the sha256 content-stamp algorithm every approval binds to
// (docs/postgres-tier.md "The bind between the two tiers is the content
// stamp"). Never reimplemented — reused as-is so the stamp this tier checks
// against is byte-identical to the one ../server.js and lib/stamp.js's own
// tests already verify.

/* eslint-disable @typescript-eslint/no-var-requires */
import * as path from 'node:path';
import type { StoreFeature } from './fileStore';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const stampLib = require(path.join(__dirname, '..', '..', '..', 'lib', 'stamp.js'));

export const computeStamp: (feature: StoreFeature) => string = stampLib.computeStamp;
