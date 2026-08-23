'use strict';

/**
 * openapiSchemas.cjs — loads ../../openapi.yaml (the FROZEN contract, v0.2.0)
 * and compiles Ajv validators for its named schemas, so tests can assert a
 * response matches the contract's own shape rather than a hand-copied
 * expectation that could drift from it silently.
 */

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const Ajv = require('ajv').default;
const addFormats = require('ajv-formats').default;

const OPENAPI_PATH = path.join(__dirname, '..', '..', 'openapi.yaml');
const rawDoc = yaml.load(fs.readFileSync(OPENAPI_PATH, 'utf8'));

if (rawDoc.info.version !== '0.2.0') {
  throw new Error(
    `acceptance suite is pinned to openapi.yaml v0.2.0 — found ${rawDoc.info.version}. ` +
      'If the contract changed, review this suite before trusting a green run.'
  );
}

/**
 * OpenAPI 3.0's `nullable: true` is NOT native JSON Schema, and Ajv's
 * (limited) built-in support for it requires a sibling `type` keyword on
 * the SAME schema object — it does not look through `allOf`/`$ref`. This
 * contract deliberately uses `allOf: [$ref] + nullable: true` for every
 * typed-nullable field (ProjectId/CommentId refs, optional strings, …), so
 * a plain Ajv compile throws "nullable cannot be used without type" on
 * several schemas. Rather than loosen validation, rewrite `nullable: true`
 * into the JSON-Schema-native `anyOf: [<rest of schema>, {type:'null'}]`
 * recursively at load time — this changes NOTHING about what the contract
 * accepts, it just expresses the same constraint in a form Ajv understands.
 */
function denullify(node) {
  if (Array.isArray(node)) {
    node.forEach(denullify);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const value of Object.values(node)) denullify(value);
  if (node.nullable === true) {
    delete node.nullable;
    const rest = { ...node };
    for (const key of Object.keys(node)) delete node[key];
    if (typeof rest.type === 'string') {
      node.type = [rest.type, 'null'];
      for (const [k, v] of Object.entries(rest)) if (k !== 'type') node[k] = v;
    } else {
      node.anyOf = [rest, { type: 'null' }];
    }
  }
}

const doc = JSON.parse(JSON.stringify(rawDoc));
denullify(doc);

// allErrors: false (the default) — Ajv stops at the first schema violation
// instead of collecting every one. This suite only asserts *whether* a
// response matches its schema (assertMatchesSchema throws on the first
// mismatch either way); it never depends on the full multi-error list, so
// there is no behavioural loss. `allErrors: true` also disables Ajv's
// short-circuiting optimizations, which is the standing
// `ajv-allerrors-true` Semgrep finding this clears.
const ajv = new Ajv({ strict: false });
addFormats(ajv);

// Register the whole (denullified) document as the schema root so `$ref:
// '#/components/schemas/X'` resolves; then compile one validator per named
// schema via a tiny per-schema $ref wrapper.
ajv.addSchema(doc, 'openapi.yaml');

const compiled = new Map();

function schemaValidator(name) {
  if (!doc.components.schemas[name]) {
    throw new Error(`openapi.yaml has no components.schemas.${name}`);
  }
  if (!compiled.has(name)) {
    compiled.set(
      name,
      ajv.compile({ $ref: `openapi.yaml#/components/schemas/${name}` })
    );
  }
  return compiled.get(name);
}

/**
 * Asserts `data` matches components.schemas[name] in openapi.yaml. Throws
 * with the Ajv error list (path + message) on mismatch, so a failing
 * assertion tells you exactly which field diverged from the frozen contract.
 */
function assertMatchesSchema(name, data) {
  const validate = schemaValidator(name);
  const ok = validate(data);
  if (!ok) {
    const details = (validate.errors || [])
      .map((e) => `${e.instancePath || '(root)'} ${e.message}`)
      .join('; ');
    throw new Error(`response does not match openapi.yaml#/components/schemas/${name}: ${details}`);
  }
}

/** Builds a validator for an inline page-envelope shape: { items: [itemSchema], page: PageInfo }. */
function assertMatchesPageEnvelope(itemSchemaName, data) {
  if (typeof data !== 'object' || data === null) throw new Error('page envelope must be an object');
  if (!Array.isArray(data.items)) throw new Error('page envelope missing items[]');
  assertMatchesSchema('PageInfo', data.page);
  data.items.forEach((item, i) => {
    try {
      assertMatchesSchema(itemSchemaName, item);
    } catch (err) {
      throw new Error(`items[${i}]: ${err.message}`);
    }
  });
}

module.exports = { doc, assertMatchesSchema, assertMatchesPageEnvelope };
