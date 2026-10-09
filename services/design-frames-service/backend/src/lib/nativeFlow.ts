import { ValidationError } from './errors';

export function parseNativeFlowCreate(body: unknown): {
  key: string; name: string; description: string | null; document: Record<string, unknown>; message: string | null;
} {
  const value = requireObject(body, 'invalid native flow create body');
  rejectUnknown(value, new Set(['key', 'name', 'description', 'document', 'message']));
  return {
    key: requiredKey(value.key, 'key'), name: requiredText(value.name, 'name'),
    description: nullableText(value.description, 'description'), document: documentObject(value.document),
    message: nullableText(value.message, 'message'),
  };
}

export function parseNativeFlowRevision(body: unknown): { expectedRevision: number; document: Record<string, unknown>; message: string | null } {
  const value = requireObject(body, 'invalid flow revision body');
  rejectUnknown(value, new Set(['expectedRevision', 'document', 'message']));
  if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 1) {
    throw new ValidationError('expectedRevision must be a positive integer');
  }
  return { expectedRevision: value.expectedRevision as number, document: documentObject(value.document), message: nullableText(value.message, 'message') };
}

export function parseRevisionNumber(value: string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new ValidationError('revision must be a positive integer');
  return revision;
}

function requireObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(message);
  return value as Record<string, unknown>;
}
function rejectUnknown(value: Record<string, unknown>, allowed: Set<string>) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new ValidationError('invalid native flow body', [`unexpected propert${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}`]);
}
function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} is required (non-empty string)`);
  return value.trim();
}
function requiredKey(value: unknown, field: string): string {
  const key = requiredText(value, field);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) throw new ValidationError(`${field} must be a lowercase slug`);
  return key;
}
function nullableText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string or null`);
  return value;
}
function documentObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('document is required and must be an object');
  return value as Record<string, unknown>;
}
