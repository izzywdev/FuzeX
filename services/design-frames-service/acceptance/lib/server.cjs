'use strict';

/**
 * server.cjs — boots the REAL Postgres lifecycle-tier backend
 * (backend/dist/app.js) in-process against a REAL local Postgres, for the
 * INDEPENDENT acceptance suite. Deliberately separate module/process per
 * test file (node --test runs each *.test.cjs in its own process), and
 * deliberately NOT the backend's own tests/integration.test.cjs — this is
 * an independent verifier, so it re-derives its own server bootstrap
 * instead of importing the implementer's test harness.
 *
 * Requires DATABASE_URL to point at an already-migrated scratch database
 * (see ../../db/migrate.sh). If unset, `requireDatabase()` throws a clear
 * skip-reason a test file can catch to self-skip (mirroring the backend's
 * own tests/integration.test.cjs convention) rather than failing opaquely.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');

const ACCEPTANCE_TOKEN = 'acceptance-suite-bearer-token';

function requireDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL not set — see services/design-frames-service/db/README.md. ' +
        'Export it to point at a migrated scratch Postgres to run this suite.'
    );
  }
  return url;
}

async function truncateAll(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `TRUNCATE design_frames.comment, design_frames.discussion, design_frames.approval,
                design_frames.frame_ref, design_frames.flow, design_frames.feature,
                design_frames.project RESTART IDENTITY CASCADE`
    );
  } finally {
    await client.end();
  }
}

/**
 * Boots one isolated server instance: fresh tmp data dir (content tier),
 * truncated Postgres lifecycle tables, a fixed bearer token so both the
 * authenticated and unauthenticated paths are exercisable in the same run.
 */
async function bootServer() {
  const databaseUrl = requireDatabase();
  await truncateAll(databaseUrl);

  const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfx-acceptance-data-'));
  process.env.DATABASE_URL = databaseUrl;
  process.env.DESIGN_FRAMES_DATA_DIR = tmpDataDir;
  process.env.DESIGN_FRAMES_API_TOKENS = ACCEPTANCE_TOKEN;
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

  const backendDistApp = path.join(__dirname, '..', '..', 'backend', 'dist', 'app.js');
  if (!fs.existsSync(backendDistApp)) {
    throw new Error(
      `${backendDistApp} not found — run "npm run build" in services/design-frames-service/backend first.`
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createApp } = require(backendDistApp);
  const app = createApp();

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    baseUrl,
    token: ACCEPTANCE_TOKEN,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDataDir, { recursive: true, force: true });
    },
  };
}

module.exports = { bootServer, requireDatabase, ACCEPTANCE_TOKEN };
