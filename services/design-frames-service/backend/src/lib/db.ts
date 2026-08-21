// db.ts — the pg connection pool + a query() boundary wrapper.
//
// DATABASE_URL is read from env, sourced from a FuzeInfra-provisioned
// SealedSecret at runtime (see ../../.env.example and ../../../db/README.md
// "Provisioning boundary" — this repo never creates databases/roles/grants).

import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { logger, timed, type ReqLogger } from './logger';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set — see .env.example. FuzeInfra provisions this via a SealedSecret in every real environment; this repo never creates the database itself.'
    );
  }
  pool = new Pool({ connectionString });
  return pool;
}

/** Every pg call logs start + end + elapsedMs (logging skill §3). */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  log: ReqLogger = logger
): Promise<{ rows: T[] }> {
  return timed(
    log,
    'pg.query',
    async () => {
      const result = await getPool().query<T>(text, params as unknown[]);
      return { rows: result.rows };
    },
    { statementPreview: text.replace(/\s+/g, ' ').slice(0, 160) }
  );
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  log: ReqLogger = logger
): Promise<T> {
  return timed(log, 'pg.transaction', async () => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
