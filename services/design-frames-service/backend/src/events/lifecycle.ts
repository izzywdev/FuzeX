// Downstream FuzeFront lifecycle consumer. This module intentionally has no
// Permit/OPAL client: FuzeFront Security remains the sole authorization
// decision point. FuzeX keeps only revocation/tombstone projections.

import { createHash } from 'node:crypto';
import { Kafka, logLevel, type Consumer, type Producer } from 'kafkajs';
import type { PoolClient } from 'pg';
import { withTransaction } from '../lib/db';
import { logger } from '../lib/logger';

export const LIFECYCLE_TOPICS = [
  'identity.org.created',
  'identity.org.deleted',
  'identity.user.deleted',
  'identity.membership.added',
  'identity.membership.removed',
  'identity.authorization.changed',
] as const;

export type LifecycleTopic = (typeof LIFECYCLE_TOPICS)[number];

type Envelope = { version: '1.0'; topic: LifecycleTopic; correlationId: string; occurredAt: string; payload: Record<string, unknown> };
type OrgCreated = { organizationId: string; slug: string; name: string; isActive: boolean };
type OrgDeleted = { organizationId: string; cascade: 'soft' | 'hard' };
type UserDeleted = { userId: string; cascade: 'soft' | 'hard' };
type Membership = { organizationId: string; userId: string; role: string };
type AuthorizationChanged = { organizationId: string; subjectId: string; change: 'membership_added' | 'membership_removed' | 'membership_role_changed'; role?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const uuid = (value: unknown): value is string => nonEmpty(value) && UUID.test(value);

/** Strict, dependency-free validation so FuzeX does not need to import FuzeFront implementation code. */
export function parseLifecycleEnvelope(raw: unknown, expectedTopic?: LifecycleTopic): Envelope {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('event must be an object');
  const value = raw as Record<string, unknown>;
  if (value.version !== '1.0' || !LIFECYCLE_TOPICS.includes(value.topic as LifecycleTopic) ||
      !nonEmpty(value.correlationId) || !nonEmpty(value.occurredAt) || !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload) ||
      Number.isNaN(Date.parse(value.occurredAt))) throw new Error('invalid lifecycle event envelope');
  if (expectedTopic && value.topic !== expectedTopic) throw new Error('event topic does not match Kafka topic');
  return value as Envelope;
}

function payload<T>(event: Envelope, validate: (p: Record<string, unknown>) => p is T): T {
  if (!validate(event.payload)) throw new Error(`invalid ${event.topic} payload`);
  return event.payload;
}
const orgCreated = (p: Record<string, unknown>): p is OrgCreated => uuid(p.organizationId) && nonEmpty(p.slug) && nonEmpty(p.name) && typeof p.isActive === 'boolean';
const orgDeleted = (p: Record<string, unknown>): p is OrgDeleted => uuid(p.organizationId) && (p.cascade === 'soft' || p.cascade === 'hard');
const userDeleted = (p: Record<string, unknown>): p is UserDeleted => uuid(p.userId) && (p.cascade === 'soft' || p.cascade === 'hard');
const membership = (p: Record<string, unknown>): p is Membership => uuid(p.organizationId) && uuid(p.userId) && nonEmpty(p.role);
const authorizationChanged = (p: Record<string, unknown>): p is AuthorizationChanged =>
  uuid(p.organizationId) && uuid(p.subjectId) &&
  (p.change === 'membership_added' || p.change === 'membership_removed' || p.change === 'membership_role_changed') &&
  (p.role === undefined || nonEmpty(p.role));

async function once(client: PoolClient, event: Envelope): Promise<boolean> {
  const receipt = await client.query(
    `insert into design_frames.lifecycle_event_receipt (topic, correlation_id, occurred_at)
     values ($1, $2, $3::timestamptz) on conflict do nothing returning correlation_id`,
    [event.topic, event.correlationId, event.occurredAt],
  );
  return (receipt.rowCount ?? 0) === 1;
}

async function ensureTenant(client: PoolClient, organizationId: string, at: string): Promise<void> {
  await client.query(
    `insert into design_frames.tenant_lifecycle_state (organization_id, is_active, last_event_at)
     values ($1, true, $2::timestamptz) on conflict (organization_id) do nothing`, [organizationId, at],
  );
}

async function isHardDeleted(client: PoolClient, organizationId: string): Promise<boolean> {
  const result = await client.query<{ deleted_cascade: string | null }>(
    'select deleted_cascade from design_frames.tenant_lifecycle_state where organization_id = $1', [organizationId],
  );
  return result.rows[0]?.deleted_cascade === 'hard';
}

async function applyEvent(client: PoolClient, event: Envelope): Promise<void> {
  if (!(await once(client, event))) return;
  switch (event.topic) {
    case 'identity.org.created': {
      const p = payload(event, orgCreated);
      await client.query(
        `insert into design_frames.tenant_lifecycle_state (organization_id, slug, name, is_active, deleted_at, deleted_cascade, last_event_at)
         values ($1, $2, $3, $4, null, null, $5::timestamptz)
         on conflict (organization_id) do update set slug = excluded.slug, name = excluded.name,
           is_active = excluded.is_active, deleted_at = null, deleted_cascade = null,
           last_event_at = excluded.last_event_at, updated_at = now()
         where excluded.last_event_at >= design_frames.tenant_lifecycle_state.last_event_at
           and design_frames.tenant_lifecycle_state.deleted_cascade is distinct from 'hard'`,
        [p.organizationId, p.slug, p.name, p.isActive, event.occurredAt],
      );
      return;
    }
    case 'identity.org.deleted': {
      const p = payload(event, orgDeleted);
      await ensureTenant(client, p.organizationId, event.occurredAt);
      await client.query(
        `update design_frames.tenant_lifecycle_state set is_active = false, deleted_at = $2::timestamptz, deleted_cascade = $3,
           last_event_at = $2::timestamptz, updated_at = now()
         where organization_id = $1 and last_event_at <= $2::timestamptz`, [p.organizationId, event.occurredAt, p.cascade],
      );
      await client.query(`update design_frames.tenant_membership_state set is_active = false, last_event_at = $2::timestamptz, updated_at = now()
        where organization_id = $1 and last_event_at <= $2::timestamptz`, [p.organizationId, event.occurredAt]);
      // A hard deletion removes only FuzeX data provably owned by that tenant.
      // Legacy unscoped projects are deliberately not guessed at or deleted.
      if (p.cascade === 'hard') await client.query('delete from design_frames.project where organization_id = $1', [p.organizationId]);
      return;
    }
    case 'identity.user.deleted': {
      const p = payload(event, userDeleted);
      await client.query(`update design_frames.tenant_membership_state set is_active = false, last_event_at = $2::timestamptz, updated_at = now()
        where user_id = $1 and last_event_at <= $2::timestamptz`, [p.userId, event.occurredAt]);
      return;
    }
    case 'identity.membership.added': {
      const p = payload(event, membership);
      await ensureTenant(client, p.organizationId, event.occurredAt);
      if (await isHardDeleted(client, p.organizationId)) return;
      await client.query(
        `insert into design_frames.tenant_membership_state (organization_id, user_id, role, is_active, last_event_at)
         values ($1, $2, $3, true, $4::timestamptz)
         on conflict (organization_id, user_id) do update set role = excluded.role, is_active = true,
           last_event_at = excluded.last_event_at, updated_at = now()
         where excluded.last_event_at >= design_frames.tenant_membership_state.last_event_at`,
        [p.organizationId, p.userId, p.role, event.occurredAt],
      );
      return;
    }
    case 'identity.membership.removed': {
      const p = payload(event, membership);
      await ensureTenant(client, p.organizationId, event.occurredAt);
      await client.query(
        `insert into design_frames.tenant_membership_state (organization_id, user_id, role, is_active, last_event_at)
         values ($1, $2, $3, false, $4::timestamptz)
         on conflict (organization_id, user_id) do update set role = excluded.role, is_active = false,
           last_event_at = excluded.last_event_at, updated_at = now()
         where excluded.last_event_at >= design_frames.tenant_membership_state.last_event_at`,
        [p.organizationId, p.userId, p.role, event.occurredAt],
      );
      return;
    }
    case 'identity.authorization.changed': {
      const p = payload(event, authorizationChanged);
      await ensureTenant(client, p.organizationId, event.occurredAt);
      // Never turn this event into a local grant. A removal is a safe local
      // revocation; additions/role changes stay evidence only while FuzeFront
      // Security continues making the live decision.
      if (p.change === 'membership_removed') {
        await client.query(
          `update design_frames.tenant_membership_state set is_active = false, last_event_at = $3::timestamptz, updated_at = now()
           where organization_id = $1 and user_id = $2 and last_event_at <= $3::timestamptz`,
          [p.organizationId, p.subjectId, event.occurredAt],
        );
      }
      await client.query(
        `insert into design_frames.authorization_change_epoch (organization_id, subject_id, change, changed_at, correlation_id)
         values ($1, $2, $3, $4::timestamptz, $5)
         on conflict (organization_id, subject_id) do update set change = excluded.change,
           changed_at = excluded.changed_at, correlation_id = excluded.correlation_id, updated_at = now()
         where excluded.changed_at >= design_frames.authorization_change_epoch.changed_at`,
        [p.organizationId, p.subjectId, p.change, event.occurredAt, event.correlationId],
      );
      return;
    }
  }
}

export async function handleLifecycleEvent(event: Envelope): Promise<void> {
  await withTransaction((client) => applyEvent(client, event));
}

export interface LifecycleConsumer { disconnect(): Promise<void>; }

export async function startLifecycleConsumer(): Promise<LifecycleConsumer | null> {
  const brokers = (process.env.KAFKA_BROKERS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!brokers.length || process.env.FUZEX_LIFECYCLE_EVENTS_ENABLED !== 'true') return null;
  const kafka = new Kafka({ clientId: 'fuzex-design-frames', brokers, logLevel: logLevel.NOTHING });
  const consumer: Consumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP_ID ?? 'fuzex-lifecycle-v1' });
  const producer: Producer = kafka.producer();
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topics: [...LIFECYCLE_TOPICS], fromBeginning: false });
  await consumer.run({ eachMessage: async ({ topic, message }) => {
    try {
      const event = parseLifecycleEnvelope(JSON.parse(message.value?.toString('utf8') ?? 'null'), topic as LifecycleTopic);
      await handleLifecycleEvent(event);
    } catch (error) {
      // Validation errors are parked. Database/handler failures are rethrown so
      // Kafka retries instead of acknowledging a revocation we did not apply.
      if (error instanceof SyntaxError || (error instanceof Error && (error.message.startsWith('invalid ') || error.message === 'event must be an object' || error.message === 'event topic does not match Kafka topic'))) {
        const raw = message.value?.toString('utf8') ?? '';
        const reason = error instanceof Error ? error.message : 'invalid event JSON';
        await producer.send({ topic: `${topic}.dlq`, messages: [{ key: message.key?.toString(), value: JSON.stringify({ sourceTopic: topic, reason, rawSha256: createHash('sha256').update(raw).digest('hex') }) }] });
        logger.warn({ topic, reason }, 'lifecycle event dead-lettered');
        return;
      }
      throw error;
    }
  }});
  return { disconnect: async () => { await Promise.all([consumer.disconnect(), producer.disconnect()]); } };
}

export const __testables = { applyEvent, orgCreated, orgDeleted, userDeleted, membership, authorizationChanged };
