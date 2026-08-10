'use strict';

/**
 * stamp.js — content stamp for one feature's frame set.
 *
 * Reimplementation of the approach pioneered by FuzeFront's
 * scripts/stamp-frames.mjs (design/frames/<feature>/**), ported here so the
 * standalone service can bind an approval to the exact frames a reviewer saw
 * without depending on FuzeFront's repo. Same algorithm, independent code:
 *
 *   stamp = sha256 over every file in the feature (manifest.json + every
 *   frame file), sorted by relative path, each contributing
 *   "<relpath>\0<per-file-hash>\n" to the running hash. manifest.json hashes
 *   its own canonical JSON with the `stamp` field AND the approval-bookkeeping
 *   fields (approved/approvedBy/approvedAt on every build.flows[] entry)
 *   stripped first, so writing the stamp — or approving a flow — never
 *   changes the value it must equal.
 */

const { createHash } = require('node:crypto');

const APPROVAL_KEYS = new Set(['approved', 'approvedBy', 'approvedAt']);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (APPROVAL_KEYS.has(key)) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

const sha256Hex = (input) => createHash('sha256').update(input).digest('hex');

/**
 * @param {{manifest: object, frames: Map<string, Buffer|string>}} feature
 *   `frames` maps each frame's `file` path (as declared in manifest.frames[])
 *   to its raw HTML content.
 */
function computeStamp(feature) {
  const files = new Map();
  const { stamp: _omit, ...manifestRest } = feature.manifest;
  files.set('manifest.json', sha256Hex(JSON.stringify(canonicalize(manifestRest))));
  for (const [file, content] of feature.frames) {
    files.set(file, sha256Hex(Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')));
  }

  const h = createHash('sha256');
  for (const rel of Array.from(files.keys()).sort()) {
    h.update(`${rel}\0${files.get(rel)}\n`);
  }
  return h.digest('hex');
}

module.exports = { computeStamp, canonicalize, APPROVAL_KEYS };
