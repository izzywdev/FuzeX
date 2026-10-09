import type { PoolClient } from 'pg';
import { bytesToUuid, uuidv7Bytes } from '@fuzex/identity';

export const FUZE_X_EVENT_TOPICS = {
  projectCreated: 'fuzex.project.created', projectUpdated: 'fuzex.project.updated', repositoryConnected: 'fuzex.project.repository.connected',
  flowCreated: 'fuzex.flow.created', flowRevisionCreated: 'fuzex.flow.revision.created', flowApprovalRecorded: 'fuzex.flow.approval.recorded',
  designSystemRevisionCreated: 'fuzex.design-system.revision.created', traceLinkCreated: 'fuzex.trace-link.created',
  designPolicyApproved: 'fuzex.design-policy.approved', designPolicySuperseded: 'fuzex.design-policy.superseded',
} as const;
export type FuzeXEventTopic = (typeof FUZE_X_EVENT_TOPICS)[keyof typeof FUZE_X_EVENT_TOPICS];
export interface EventContext { tenantId: string; actor: string; correlationId?: string | null }
export interface FuzeXEvent<T extends Record<string, unknown> = Record<string, unknown>> { eventId: string; type: FuzeXEventTopic; schemaVersion: 1; occurredAt: string; tenantId: string; actor: string; correlationId: string | null; payload: T }
export class EventContractError extends Error { readonly code = 'FUZX_EVENT_CONTRACT_INVALID'; }
const FORBIDDEN = new Set(['html','javascript','script','framecontent','quote','quotetext','content','token','authorization','password','secret','credential','cookie']);
function assertSafeValue(value: unknown, path = 'payload'): void {
  if (typeof value === 'string' && value.length > 4096) throw new EventContractError(`${path} is too large`);
  if (Array.isArray(value)) { if (value.length > 100) throw new EventContractError(`${path} has too many entries`); value.forEach((v, i) => assertSafeValue(v, `${path}[${i}]`)); }
  else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value as Record<string, unknown>)) { if (FORBIDDEN.has(key.replace(/[^a-z]/gi, '').toLowerCase())) throw new EventContractError(`${path}.${key} is not permitted`); assertSafeValue(entry, `${path}.${key}`); }
}
function assertTopicPayload(topic: FuzeXEventTopic, payload: Record<string, unknown>): void {
  const required: Record<FuzeXEventTopic, string[]> = {
    [FUZE_X_EVENT_TOPICS.projectCreated]: ['projectId','name'], [FUZE_X_EVENT_TOPICS.projectUpdated]: ['projectId','changed'], [FUZE_X_EVENT_TOPICS.repositoryConnected]: ['projectId','repository'],
    [FUZE_X_EVENT_TOPICS.flowCreated]: ['projectId','flowId','flowKey','revision'], [FUZE_X_EVENT_TOPICS.flowRevisionCreated]: ['projectId','flowId','revision'], [FUZE_X_EVENT_TOPICS.flowApprovalRecorded]: ['flowId','decision','approvalId'],
    [FUZE_X_EVENT_TOPICS.designSystemRevisionCreated]: ['projectId','revision'], [FUZE_X_EVENT_TOPICS.traceLinkCreated]: ['projectId','traceLinkId','sourceSystem','sourceKind'], [FUZE_X_EVENT_TOPICS.designPolicyApproved]: ['projectId','policyId'], [FUZE_X_EVENT_TOPICS.designPolicySuperseded]: ['projectId','policyId'],
  };
  for (const field of required[topic]) if (payload[field] === undefined || payload[field] === null || payload[field] === '') throw new EventContractError(`${topic} requires payload.${field}`);
  assertSafeValue(payload);
}
export function mintEventId(): string { return bytesToUuid(uuidv7Bytes()); }
export function makeEvent<T extends Record<string, unknown>>(topic: FuzeXEventTopic, context: EventContext, payload: T, occurredAt = new Date()): FuzeXEvent<T> {
  if (!context.tenantId.trim() || !context.actor.trim()) throw new EventContractError('tenantId and actor are required');
  assertTopicPayload(topic, payload);
  return { eventId: mintEventId(), type: topic, schemaVersion: 1, occurredAt: occurredAt.toISOString(), tenantId: context.tenantId, actor: context.actor, correlationId: context.correlationId ?? null, payload };
}
export async function enqueueEvent(client: PoolClient, aggregateKey: string, event: FuzeXEvent): Promise<void> {
  if (!aggregateKey.trim()) throw new EventContractError('aggregateKey is required');
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`fuzex-outbox:${event.tenantId}`]);
  await client.query(`insert into design_frames.event_outbox (id,tenant_id,aggregate_key,topic,schema_version,payload,correlation_id,actor,occurred_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`, [event.eventId,event.tenantId,aggregateKey,event.type,event.schemaVersion,JSON.stringify(event),event.correlationId,event.actor,event.occurredAt]);
}
export const __testables = { assertSafeValue, assertTopicPayload };
