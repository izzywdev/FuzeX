import { ValidationError } from './errors';
import type { ArtifactObjectInput, ArtifactBundleCreateInput } from '../repositories/artifactBundleRepo';

const SHA256 = /^[a-f0-9]{64}$/;
const FLOW_KEY = /^[a-z0-9][a-z0-9-]{0,99}$/;
const OBJECT_PATH = /^[a-zA-Z0-9][a-zA-Z0-9!_.*'()/=-]*$/;

export function parseArtifactBundleCreate(value: unknown, createdBy: string, storageBucket: string): ArtifactBundleCreateInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('artifact bundle body must be an object');
  const body = value as Record<string, unknown>;
  const allowed = new Set(['flowKey', 'displayName', 'contentSha256', 'objects']);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  const errors: string[] = unknown.length ? [`unexpected properties: ${unknown.join(', ')}`] : [];
  const flowKey = typeof body.flowKey === 'string' ? body.flowKey.trim() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const contentSha256 = typeof body.contentSha256 === 'string' ? body.contentSha256 : '';
  if (!FLOW_KEY.test(flowKey)) errors.push('flowKey must be a lowercase slug');
  if (!displayName) errors.push('displayName is required');
  if (!SHA256.test(contentSha256)) errors.push('contentSha256 must be a lowercase SHA-256 hex digest');
  if (!Array.isArray(body.objects) || body.objects.length === 0 || body.objects.length > 500) errors.push('objects must contain 1 to 500 objects');
  const paths = new Set<string>();
  const objects: ArtifactObjectInput[] = Array.isArray(body.objects) ? body.objects.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`objects[${index}] must be an object`); return { path: '', contentType: '', byteSize: -1, sha256: '' }; }
    const item = raw as Record<string, unknown>;
    const itemUnknown = Object.keys(item).filter((key) => !['path', 'contentType', 'byteSize', 'sha256'].includes(key));
    if (itemUnknown.length) errors.push(`objects[${index}] has unexpected properties`);
    const path = typeof item.path === 'string' ? item.path : '';
    const contentType = typeof item.contentType === 'string' ? item.contentType : '';
    const byteSize = typeof item.byteSize === 'number' ? item.byteSize : -1;
    const sha256 = typeof item.sha256 === 'string' ? item.sha256 : '';
    if (!OBJECT_PATH.test(path) || path.includes('//') || path.startsWith('.')) errors.push(`objects[${index}].path is not a safe relative object path`);
    if (paths.has(path)) errors.push(`objects[${index}].path is duplicated`); paths.add(path);
    if (!contentType || contentType.length > 255) errors.push(`objects[${index}].contentType is required`);
    if (!Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > 1073741824) errors.push(`objects[${index}].byteSize is invalid`);
    if (!SHA256.test(sha256)) errors.push(`objects[${index}].sha256 must be a lowercase SHA-256 hex digest`);
    return { path, contentType, byteSize, sha256 };
  }) : [];
  if (errors.length) throw new ValidationError('invalid artifact bundle create body', errors);
  return { flowKey, displayName, contentSha256, objects, createdBy, storageBucket };
}

export function assertSafeArtifactPath(path: string): string {
  if (!OBJECT_PATH.test(path) || path.includes('//') || path.startsWith('.')) throw new ValidationError('invalid artifact object path');
  return path;
}
