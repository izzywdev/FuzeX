import { assertRef, type EntityId } from './identity';
import { ValidationError } from './errors';

export type TraceTargetType = 'project' | 'flow' | 'flowStep' | 'frame' | 'element' | 'designSystemComponent';
export type TraceSourceSystem = 'fuzeplan' | 'fuzequality' | 'fuzex';
export type TraceSourceKind = 'requirement' | 'llm_quote' | 'test_case' | 'design_decision';
const TARGET_TYPES = new Set<TraceTargetType>(['project', 'flow', 'flowStep', 'frame', 'element', 'designSystemComponent']);
const SYSTEMS = new Set<TraceSourceSystem>(['fuzeplan', 'fuzequality', 'fuzex']);
const KINDS = new Set<TraceSourceKind>(['requirement', 'llm_quote', 'test_case', 'design_decision']);

export interface TraceTarget { targetType: TraceTargetType; targetRef: string; selector: string | null; contentStamp: string | null; }
export interface TraceLinkInput extends TraceTarget { sourceSystem: TraceSourceSystem; sourceKind: TraceSourceKind; externalRef: string; externalUrl: string | null; quoteText: string | null; metadata: Record<string, unknown>; }

export function parseTraceLink(body: unknown): TraceLinkInput {
  const value = object(body, 'invalid trace link body');
  rejectUnknown(value, new Set(['targetType', 'targetRef', 'selector', 'contentStamp', 'sourceSystem', 'sourceKind', 'externalRef', 'externalUrl', 'quoteText', 'metadata']));
  const target = parseTarget(value);
  const sourceSystem = enumValue(value.sourceSystem, SYSTEMS, 'sourceSystem');
  const sourceKind = enumValue(value.sourceKind, KINDS, 'sourceKind');
  if (sourceSystem === 'fuzeplan' && !['requirement', 'llm_quote'].includes(sourceKind)) throw new ValidationError('invalid FuzePlan evidence kind');
  if (sourceSystem === 'fuzequality' && sourceKind !== 'test_case') throw new ValidationError('invalid FuzeQuality evidence kind');
  if (sourceSystem === 'fuzex' && sourceKind !== 'design_decision') throw new ValidationError('invalid FuzeX evidence kind');
  const quoteText = nullableText(value.quoteText, 'quoteText');
  if ((sourceKind === 'llm_quote') !== (quoteText !== null) || (sourceKind === 'llm_quote' && !quoteText?.trim())) throw new ValidationError('quoteText is required only for llm_quote evidence');
  return { ...target, sourceSystem, sourceKind, externalRef: requiredText(value.externalRef, 'externalRef'), externalUrl: safeExternalUrl(value.externalUrl), quoteText, metadata: optionalObject(value.metadata, 'metadata') };
}

export function parseTarget(value: Record<string, unknown>): TraceTarget {
  const targetType = enumValue(value.targetType, TARGET_TYPES, 'targetType');
  const targetRef = requiredText(value.targetRef, 'targetRef');
  if (targetType === 'project') assertRef('project', targetRef);
  if (targetType === 'flow' || targetType === 'flowStep') assertRef('flow', targetRef);
  if (targetType === 'frame' || targetType === 'element') assertRef('frameRef', targetRef);
  if (targetType === 'designSystemComponent' && !/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(targetRef)) throw new ValidationError('targetRef must be a design-system component key');
  const selector = nullableText(value.selector, 'selector');
  if ((targetType === 'element' || targetType === 'flowStep') && !selector) throw new ValidationError(`selector is required for a ${targetType} target`);
  const contentStamp = nullableText(value.contentStamp, 'contentStamp');
  if (contentStamp && !/^[0-9a-f]{64}$/.test(contentStamp)) throw new ValidationError('contentStamp must be a sha256 hex value');
  return { targetType, targetRef, selector, contentStamp };
}

export function parsePolicy(body: unknown): TraceTarget & { title: string; instruction: string; traceLinkIds: EntityId<'traceLink'>[] } {
  const value = object(body, 'invalid design policy body');
  rejectUnknown(value, new Set(['targetType', 'targetRef', 'selector', 'contentStamp', 'title', 'instruction', 'traceLinkIds']));
  const traceLinkIds = value.traceLinkIds === undefined ? [] : array(value.traceLinkIds, 'traceLinkIds').map((id) => assertRef('traceLink', id) as EntityId<'traceLink'>);
  return { ...parseTarget(value), title: requiredText(value.title, 'title'), instruction: requiredText(value.instruction, 'instruction'), traceLinkIds };
}

function object(value: unknown, message: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(message); return value as Record<string, unknown>; }
function optionalObject(value: unknown, field: string): Record<string, unknown> { if (value === undefined) return {}; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(`${field} must be an object`); return value as Record<string, unknown>; }
function array(value: unknown, field: string): unknown[] { if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array`); return value; }
function requiredText(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} is required (non-empty string)`); return value.trim(); }
function nullableText(value: unknown, field: string): string | null { if (value === undefined || value === null) return null; if (typeof value !== 'string') throw new ValidationError(`${field} must be a string or null`); return value; }
function enumValue<T extends string>(value: unknown, values: Set<T>, field: string): T { if (typeof value !== 'string' || !values.has(value as T)) throw new ValidationError(`${field} is invalid`); return value as T; }
function rejectUnknown(value: Record<string, unknown>, allowed: Set<string>) { const unknown = Object.keys(value).filter((key) => !allowed.has(key)); if (unknown.length) throw new ValidationError('invalid traceability body', [`unexpected propert${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}`]); }
function safeExternalUrl(value: unknown): string | null { const raw = nullableText(value, 'externalUrl'); if (!raw) return null; try { const url = new URL(raw); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(); return url.toString(); } catch { throw new ValidationError('externalUrl must be an http(s) URL without credentials'); } }
