'use strict';

/**
 * schema.js — hand-rolled validator for manifest.schema.json's load-bearing
 * shape. Deliberately not a full JSON-Schema evaluator (no new dependency,
 * matches this repo's dependency-light convention — see bridge-server.js)
 * — it checks exactly the fields stamping/approval/QA depend on and lets
 * everything else (additionalProperties) through untouched.
 */

const HTML_FILE = /\.html$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FEATURE_FLAG = /^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$/;
const ENDPOINT = /^(GET|POST|PUT|PATCH|DELETE) \//;
const ROUTE = /^\//;

function err(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

/** @returns {string[]} validation errors; empty array means valid. */
function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest must be a JSON object'];
  }

  for (const key of ['name', 'description', 'designSystem', 'entry']) {
    if (typeof manifest[key] !== 'string' || manifest[key].length < 1) {
      err(errors, key, 'required non-empty string');
    }
  }
  if (typeof manifest.entry === 'string' && !HTML_FILE.test(manifest.entry)) {
    err(errors, 'entry', 'must end in .html');
  }
  if (manifest.stamp !== undefined && !SHA256.test(manifest.stamp)) {
    err(errors, 'stamp', 'must be a bare lowercase sha256 hex digest');
  }

  if (!Array.isArray(manifest.frames)) {
    err(errors, 'frames', 'required array (may be empty on a freshly-created feature, before any frame is uploaded)');
  } else {
    const flowIds = new Set((manifest.build && manifest.build.flows || []).map((f) => f.id));
    manifest.frames.forEach((frame, i) => {
      const p = `frames[${i}]`;
      if (!frame || typeof frame !== 'object') return err(errors, p, 'must be an object');
      for (const key of ['id', 'file', 'label', 'summary']) {
        if (typeof frame[key] !== 'string' || frame[key].length < 1) err(errors, `${p}.${key}`, 'required non-empty string');
      }
      if (typeof frame.file === 'string' && !HTML_FILE.test(frame.file)) err(errors, `${p}.file`, 'must end in .html');
      if (!Array.isArray(frame.testHooks) || frame.testHooks.length < 1) {
        err(errors, `${p}.testHooks`, 'required non-empty array of data-* selectors');
      }
      if (frame.flow !== undefined && flowIds.size && !flowIds.has(frame.flow)) {
        err(errors, `${p}.flow`, `references unknown build.flows[].id '${frame.flow}'`);
      }
    });
  }

  if (manifest.contract && typeof manifest.contract === 'object') {
    const c = manifest.contract;
    if (c.featureFlag !== undefined && !FEATURE_FLAG.test(c.featureFlag)) {
      err(errors, 'contract.featureFlag', "must match '<repo>.<domain>.<flag>'");
    }
    if (Array.isArray(c.endpoints)) {
      c.endpoints.forEach((e, i) => {
        if (typeof e !== 'string' || !ENDPOINT.test(e)) err(errors, `contract.endpoints[${i}]`, 'must be "<METHOD> /path"');
      });
    }
  }

  if (manifest.build && typeof manifest.build === 'object' && Array.isArray(manifest.build.flows)) {
    manifest.build.flows.forEach((flow, i) => {
      const p = `build.flows[${i}]`;
      if (!flow || typeof flow !== 'object') return err(errors, p, 'must be an object');
      for (const key of ['id', 'orchestrator']) {
        if (typeof flow[key] !== 'string' || flow[key].length < 1) err(errors, `${p}.${key}`, 'required non-empty string');
      }
      if (typeof flow.route !== 'string' || !ROUTE.test(flow.route)) err(errors, `${p}.route`, "required, must start with '/'");
      if (flow.approved !== undefined && typeof flow.approved !== 'boolean') err(errors, `${p}.approved`, 'must be boolean');
    });
  }

  return errors;
}

module.exports = { validateManifest };
