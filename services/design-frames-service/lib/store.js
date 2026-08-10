'use strict';

/**
 * store.js — file-backed persistence for design-frames-service.
 *
 * Layout mirrors FuzeFront's design/frames/<feature>/ convention on purpose
 * (manifest.json + one file per frame) so a feature can be exported/imported
 * 1:1 between the two repos later, even though nothing here reads or writes
 * FuzeFront's disk directly. One JSON file + one HTML file per frame — no
 * database — matching this repo's dependency-light, no-build-step ethos
 * (see bridge-server.js). Concurrent writes to the same feature are
 * serialized per-slug so two requests can't interleave a manifest write.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { existsSync } = require('node:fs');

const DATA_DIR = process.env.DESIGN_FRAMES_DATA_DIR
  ? path.resolve(process.env.DESIGN_FRAMES_DATA_DIR)
  : path.join(__dirname, '..', 'data', 'features');

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.code = 'NOT_FOUND';
  }
}
class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.code = 'CONFLICT';
  }
}
class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.code = 'VALIDATION';
    this.details = details || [];
  }
}

function assertSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new ValidationError(`slug must match ${SLUG_RE}: got '${slug}'`);
  }
}

/** Per-slug write queue so concurrent requests never interleave a manifest read-modify-write. */
const queues = new Map();
function serialize(slug, fn) {
  const prev = queues.get(slug) || Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(slug, next.catch(() => {}));
  return next;
}

function featureDir(slug) {
  return path.join(DATA_DIR, slug);
}
function manifestPath(slug) {
  return path.join(featureDir(slug), 'manifest.json');
}
function framesDir(slug) {
  return path.join(featureDir(slug), 'frames');
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function listFeatures() {
  await ensureDataDir();
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const mp = manifestPath(e.name);
    if (!existsSync(mp)) continue;
    const manifest = JSON.parse(await fs.readFile(mp, 'utf8'));
    const flows = (manifest.build && manifest.build.flows) || [];
    out.push({
      slug: e.name,
      name: manifest.name,
      description: manifest.description,
      sourceRepo: manifest.sourceRepo || null,
      stamp: manifest.stamp || null,
      frameCount: Array.isArray(manifest.frames) ? manifest.frames.length : 0,
      flows: flows.map((f) => ({ id: f.id, approved: !!f.approved })),
    });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

async function featureExists(slug) {
  return existsSync(manifestPath(slug));
}

async function createFeature(slug, manifest) {
  assertSlug(slug);
  return serialize(slug, async () => {
    if (await featureExists(slug)) {
      throw new ConflictError(`feature '${slug}' already exists`);
    }
    await fs.mkdir(framesDir(slug), { recursive: true });
    await fs.writeFile(manifestPath(slug), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    return getFeature(slug);
  });
}

async function getManifest(slug) {
  assertSlug(slug);
  if (!(await featureExists(slug))) throw new NotFoundError(`feature '${slug}' not found`);
  return JSON.parse(await fs.readFile(manifestPath(slug), 'utf8'));
}

async function listFrameFiles(slug) {
  const dir = framesDir(slug);
  if (!existsSync(dir)) return [];
  return (await fs.readdir(dir)).filter((f) => f.endsWith('.html')).sort();
}

async function getFeature(slug) {
  const manifest = await getManifest(slug);
  const frames = new Map();
  for (const file of await listFrameFiles(slug)) {
    frames.set(file, await fs.readFile(path.join(framesDir(slug), file), 'utf8'));
  }
  return { slug, manifest, frames };
}

async function putManifest(slug, manifest) {
  assertSlug(slug);
  return serialize(slug, async () => {
    if (!(await featureExists(slug))) throw new NotFoundError(`feature '${slug}' not found`);
    await fs.writeFile(manifestPath(slug), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    return getFeature(slug);
  });
}

async function putFrame(slug, file, html) {
  assertSlug(slug);
  if (!/\.html$/.test(file) || file.includes('/') || file.includes('..')) {
    throw new ValidationError(`invalid frame file '${file}'`);
  }
  return serialize(slug, async () => {
    if (!(await featureExists(slug))) throw new NotFoundError(`feature '${slug}' not found`);
    await fs.mkdir(framesDir(slug), { recursive: true });
    await fs.writeFile(path.join(framesDir(slug), file), html, 'utf8');
  });
}

async function getFrame(slug, file) {
  assertSlug(slug);
  const p = path.join(framesDir(slug), file);
  if (!existsSync(p)) throw new NotFoundError(`frame '${file}' not found in '${slug}'`);
  return fs.readFile(p, 'utf8');
}

async function deleteFrame(slug, file) {
  assertSlug(slug);
  return serialize(slug, async () => {
    const p = path.join(framesDir(slug), file);
    if (!existsSync(p)) throw new NotFoundError(`frame '${file}' not found in '${slug}'`);
    await fs.unlink(p);
  });
}

async function setStamp(slug, stamp) {
  assertSlug(slug);
  return serialize(slug, async () => {
    if (!(await featureExists(slug))) throw new NotFoundError(`feature '${slug}' not found`);
    const manifest = JSON.parse(await fs.readFile(manifestPath(slug), 'utf8'));
    manifest.stamp = stamp;
    await fs.writeFile(manifestPath(slug), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    return manifest;
  });
}

async function setFlowApproval(slug, flowId, approval) {
  assertSlug(slug);
  return serialize(slug, async () => {
    if (!(await featureExists(slug))) throw new NotFoundError(`feature '${slug}' not found`);
    const manifest = JSON.parse(await fs.readFile(manifestPath(slug), 'utf8'));
    const flows = (manifest.build && manifest.build.flows) || [];
    const flow = flows.find((f) => f.id === flowId);
    if (!flow) throw new NotFoundError(`flow '${flowId}' not found in feature '${slug}'`);
    Object.assign(flow, approval);
    await fs.writeFile(manifestPath(slug), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    return flow;
  });
}

module.exports = {
  DATA_DIR,
  listFeatures,
  featureExists,
  createFeature,
  getManifest,
  getFeature,
  putManifest,
  putFrame,
  getFrame,
  deleteFrame,
  setStamp,
  setFlowApproval,
  NotFoundError,
  ConflictError,
  ValidationError,
};
