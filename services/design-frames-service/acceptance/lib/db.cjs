'use strict';

/**
 * db.cjs — a direct pg connection for the small number of acceptance checks
 * that must look past the HTTP boundary (specifically: proving an
 * API-documented capability is unreachable because no route ever populates
 * the row it depends on — see tests/frame-refs.test.cjs). Everything else
 * in this suite talks to the service over HTTP only.
 */

const { Client } = require('pg');

async function withClient(databaseUrl, fn) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

module.exports = { withClient };
