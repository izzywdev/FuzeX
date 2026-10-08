import { ValidationError } from './errors';

export interface DesignSystemComponent {
  key: string;
  name: string;
  description?: string;
  selector?: string;
  usage?: string;
  status?: 'draft' | 'approved' | 'rejected';
  reason?: string;
}

export interface DesignSystemRevisionInput {
  expectedRevision: number;
  name: string;
  description: string | null;
  tokens: Record<string, unknown>;
  components: DesignSystemComponent[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate snapshots before beginning a transaction; never accept identity or
 * audit fields from the caller. Tokens permit nested standard token formats. */
export function parseDesignSystemRevision(value: unknown): DesignSystemRevisionInput {
  if (!isObject(value)) throw new ValidationError('design system revision must be an object');
  const errors: string[] = [];
  const allowed = new Set(['expectedRevision', 'name', 'description', 'tokens', 'components']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`unexpected property: ${key}`);
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0 || Number(value.expectedRevision) >= 2147483647) {
    errors.push('expectedRevision must be a non-negative integer below 2147483647');
  }
  if (typeof value.name !== 'string' || !value.name.trim()) errors.push('name must be a non-empty string');
  if (value.description !== undefined && value.description !== null && typeof value.description !== 'string') {
    errors.push('description must be a string or null');
  }
  if (!isObject(value.tokens)) errors.push('tokens must be an object');
  if (!Array.isArray(value.components)) errors.push('components must be an array');
  else {
    const keys = new Set<string>();
    const componentFields = new Set(['key', 'name', 'description', 'selector', 'usage', 'status', 'reason']);
    value.components.forEach((component, index) => {
      const prefix = `components[${index}]`;
      if (!isObject(component)) { errors.push(`${prefix} must be an object`); return; }
      for (const key of Object.keys(component)) if (!componentFields.has(key)) errors.push(`${prefix}: unexpected property: ${key}`);
      if (typeof component.key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(component.key)) {
        errors.push(`${prefix}.key must be a stable alphanumeric component key`);
      } else if (keys.has(component.key)) errors.push(`${prefix}.key duplicates ${component.key}`);
      else keys.add(component.key);
      if (typeof component.name !== 'string' || !component.name.trim()) errors.push(`${prefix}.name must be non-empty`);
      for (const key of ['description', 'selector', 'usage', 'reason']) {
        if (component[key] !== undefined && typeof component[key] !== 'string') errors.push(`${prefix}.${key} must be a string`);
      }
      if (component.status !== undefined && (typeof component.status !== 'string' || !['draft', 'approved', 'rejected'].includes(component.status))) {
        errors.push(`${prefix}.status must be draft, approved, or rejected`);
      }
      if (component.status === 'rejected' && (typeof component.reason !== 'string' || !component.reason.trim())) {
        errors.push(`${prefix}.reason is required when rejected`);
      }
    });
  }
  if (errors.length) throw new ValidationError('invalid design system revision', errors);
  return {
    expectedRevision: value.expectedRevision as number,
    name: (value.name as string).trim(),
    description: (value.description as string | null | undefined) ?? null,
    tokens: value.tokens as Record<string, unknown>,
    components: value.components as DesignSystemComponent[],
  };
}

export function parseRevisionNumber(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) {
    throw new ValidationError('revision must be a positive integer below 2147483648');
  }
  return Number(value);
}
