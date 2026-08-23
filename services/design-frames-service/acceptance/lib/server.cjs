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
 *
 * Isolation: `node --test tests/*.test.cjs` runs test FILES concurrently
 * (one process per file, several files in flight at once). Sharing one
 * DATABASE_URL and truncating it per-file used to corrupt whatever a
 * sibling file was mid-assertion on — a different test flaked on every
 * parallel run, deterministic only at --test-concurrency=1. Instead, each
 * bootServer() call provisions its OWN throwaway database (cloned schema
 * via db/migrate.sh, same script FuzeInfra runs in every real environment)
 * on the same Postgres server DATABASE_URL points at, and drops it again in
 * close(). Every file gets a private `design_frames` schema in a private
 * database, so parallel execution is safe by construction — no shared
 * mutable state between files, and no serial pin required.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const ACCEPTANCE_TOKEN = 'acceptance-suite-bearer-token';

const MIGRATE_SCRIPT = path.join(__dirname, '..', '..', 'db', 'migrate.sh');

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

/** Builds a connection string identical to `baseUrl` but pointed at `dbName`. */
function withDatabaseName(baseUrl, dbName) {
  const u = new URL(baseUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

/**
 * Creates a fresh, uniquely-named database on the same Postgres server as
 * `baseDatabaseUrl` (connecting to `baseDatabaseUrl`'s own database as the
 * maintenance connection — any already-existing database works for issuing
 * CREATE DATABASE), then runs the real db/migrate.sh against it so its
 * `design_frames` schema is identical to what every other environment gets.
 * Returns the new database's own connection string.
 */
async function provisionEphemeralDatabase(baseDatabaseUrl) {
  const dbName = `dfx_acc_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
  const admin = new Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  const ephemeralUrl = withDatabaseName(baseDatabaseUrl, dbName);
  execFileSync('bash', [MIGRATE_SCRIPT], {
    env: { ...process.env, DATABASE_URL: ephemeralUrl },
    stdio: 'pipe',
  });

  return { url: ephemeralUrl, name: dbName };
}

/** Drops the ephemeral database created by provisionEphemeralDatabase(). */
async function dropDatabase(baseDatabaseUrl, dbName) {
  const admin = new Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  try {
    // WITH (FORCE) (PG 13+) terminates any lingering backends first — a
    // belt-and-braces safety net on top of us always closing the app's own
    // pg Pool before calling this, so a slow-to-release connection never
    // leaves the ephemeral database (and the disk space it holds) stranded.
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

/**
 * Boots one isolated server instance: fresh tmp data dir (content tier),
 * a private, freshly-migrated Postgres database (lifecycle tier), a fixed
 * bearer token so both the authenticated and unauthenticated paths are
 * exercisable in the same run.
 */
async function bootServer() {
  const baseDatabaseUrl = requireDatabase();
  const { url: ephemeralUrl, name: ephemeralDbName } = await provisionEphemeralDatabase(
    baseDatabaseUrl
  );

  const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfx-acceptance-data-'));
  process.env.DATABASE_URL = ephemeralUrl;
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { closePool } = require(path.join(__dirname, '..', '..', 'backend', 'dist', 'lib', 'db.js'));
  const app = createApp();

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    baseUrl,
    token: ACCEPTANCE_TOKEN,
    // The per-file ephemeral database this running server is actually
    // backed by — tests that need to reach past the HTTP boundary (see
    // lib/db.cjs) must query THIS, not the base DATABASE_URL, now that each
    // file owns its own database.
    databaseUrl: ephemeralUrl,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      // Release the backend's pg Pool BEFORE dropping the ephemeral database
      // it points at — otherwise DROP DATABASE races an open connection.
      await closePool();
      fs.rmSync(tmpDataDir, { recursive: true, force: true });
      await dropDatabase(baseDatabaseUrl, ephemeralDbName);
    },
  };
}

module.exports = { bootServer, requireDatabase, ACCEPTANCE_TOKEN };
