// manifestSchema.ts — typed wrapper around ../../../lib/schema.js. Reused,
// never reimplemented (same reasoning as fileStore.ts/stampLib.ts).

/* eslint-disable @typescript-eslint/no-var-requires */
import * as path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const schema = require(path.join(__dirname, '..', '..', '..', 'lib', 'schema.js'));

export const validateManifest: (manifest: unknown) => string[] = schema.validateManifest;
