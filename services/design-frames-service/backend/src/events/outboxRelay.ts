// At-least-once Kafka relay. Consumers deduplicate with payload.eventId.
import { Kafka, logLevel, type Producer } from 'kafkajs';
import { getPool } from '../lib/db';
import { logger } from '../lib/logger';
import type { FuzeXEvent } from '../lib/events';

interface Row { id: string; tenant_id: string; topic: string; payload: FuzeXEvent; attempts: number; }
function config(): { brokers: string[]; clientId: string; ssl: boolean } | null {
  const brokers = (process.env.KAFKA_BROKERS ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  return brokers.length ? { brokers, clientId: process.env.KAFKA_CLIENT_ID?.trim() || 'fuzex-design-frames', ssl: process.env.KAFKA_SSL === 'true' } : null;
}
function backoffMs(attempts: number): number { return Math.min(60_000, 500 * 2 ** Math.min(attempts, 8)); }
async function claimOne(): Promise<Row | null> {
  const client = await getPool().connect();
  try { await client.query('begin'); await client.query("update design_frames.event_outbox set status='pending', locked_at=null where status='sending' and locked_at < clock_timestamp() - interval '5 minutes'");
    const result = await client.query<Row>(`select e.id,e.tenant_id,e.topic,e.payload,e.attempts
      from design_frames.event_outbox e where e.status='pending' and e.available_at <= clock_timestamp()
      and not exists (select 1 from design_frames.event_outbox older
        where older.tenant_id=e.tenant_id and older.status in ('pending','sending')
        and (older.created_at,older.id) < (e.created_at,e.id))
      order by e.created_at,e.id limit 1 for update skip locked`); const row = result.rows[0];
    if (!row) { await client.query('commit'); return null; }
    await client.query("update design_frames.event_outbox set status='sending',locked_at=clock_timestamp(),attempts=attempts+1 where id=$1", [row.id]); await client.query('commit'); return { ...row, attempts: row.attempts + 1 };
  } catch (error) { await client.query('rollback').catch(() => undefined); throw error; } finally { client.release(); }
}
async function settle(row: Row, error: unknown, maxAttempts: number): Promise<void> {
  if (!error) { await getPool().query("update design_frames.event_outbox set status='sent',sent_at=clock_timestamp(),locked_at=null,last_error=null where id=$1", [row.id]); return; }
  const detail = (error instanceof Error ? error.message : 'publish failed').slice(0, 512);
  await getPool().query("update design_frames.event_outbox set status=$2,locked_at=null,last_error=$3,available_at=clock_timestamp()+($4::text || ' milliseconds')::interval where id=$1", [row.id, row.attempts >= maxAttempts ? 'failed' : 'pending', detail, backoffMs(row.attempts)]);
}
export async function drainOutboxOnce(producer: Producer, maxAttempts = 10): Promise<boolean> {
  const row = await claimOne(); if (!row) return false;
  try { await producer.send({ topic: row.topic, messages: [{ key: row.tenant_id, value: JSON.stringify(row.payload) }] }); await settle(row, null, maxAttempts); }
  catch (error) { await settle(row, error, maxAttempts); logger.warn({ eventId: row.id, topic: row.topic, attempts: row.attempts }, 'FuzeX event publish failed'); }
  return true;
}
export async function startOutboxRelay(): Promise<(() => Promise<void>) | null> {
  const options = config(); if (!options) return null;
  const producer = new Kafka({ ...options, logLevel: logLevel.NOTHING }).producer({ allowAutoTopicCreation: false }); await producer.connect();
  const intervalMs = Math.max(100, Number(process.env.FUZE_X_OUTBOX_RELAY_INTERVAL_MS ?? 1000)); const maxAttempts = Math.max(1, Number(process.env.FUZE_X_OUTBOX_MAX_ATTEMPTS ?? 10)); let draining = false;
  const tick = async () => { if (draining) return; draining = true; try { while (await drainOutboxOnce(producer, maxAttempts)) { /* drain */ } } catch (error) { logger.error({ err: error }, 'FuzeX outbox relay pass failed'); } finally { draining = false; } };
  const timer = setInterval(() => void tick(), intervalMs); void tick(); logger.info({ brokers: options.brokers, intervalMs }, 'FuzeX event outbox relay started'); return async () => { clearInterval(timer); await producer.disconnect(); };
}
export const __testables = { backoffMs, config };
