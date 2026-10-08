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
const { randomUUID } = require('node:crypto');
const { computeStamp } = require('./stamp');

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
  const locked = async () => {
    await fs.mkdir(path.join(DATA_DIR, '.locks'), { recursive: true });
    const lock = path.join(DATA_DIR, '.locks', slug);
    const deadline = Date.now() + 10000;
    for (;;) {
      try { await fs.mkdir(lock); break; } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        if (Date.now() >= deadline) throw new ConflictError(`feature '${slug}' is locked by another writer`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    try { return await fn(); } finally { await fs.rmdir(lock); }
  };
  const next = prev.then(locked, locked);
  const tail = next.catch(() => {});
  queues.set(slug, tail);
  void tail.then(() => { if (queues.get(slug) === tail) queues.delete(slug); });
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
function revisionsDir(slug) {
  return path.join(featureDir(slug), 'revisions');
}
function revisionDir(slug, stamp) {
  return path.join(revisionsDir(slug), stamp);
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function listFeatures() {
  await ensureDataDir();
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || !SLUG_RE.test(e.name)) continue;
    const mp = manifestPath(e.name);
    if (!existsSync(mp)) continue;
    const manifest = await getManifest(e.name);
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
  assertSlug(slug);
  return existsSync(manifestPath(slug));
}

function assertFile(file) {
  if (typeof file !== 'string' || !/^[^/\\\0]+\.html$/.test(file) || file.includes('..')) {
    throw new ValidationError(`invalid frame file '${file}'`);
  }
}

/** Every published generation is immutable. One atomic pointer switches the
 * complete manifest/frame set, so readers never observe a partial import.
 * Generations are retained because an in-flight reader may still need them.
 */
async function currentDirectory(slug) {
  try {
    const pointer = JSON.parse(await fs.readFile(path.join(featureDir(slug), 'current.json'), 'utf8'));
    if (!/^(?:revisions\/[a-f0-9]{64}|generations\/[a-f0-9-]+)$/.test(pointer.directory)) {
      throw new ValidationError('invalid stored feature pointer');
    }
    return path.join(featureDir(slug), pointer.directory);
  } catch (err) {
    if (err.code === 'ENOENT') return featureDir(slug);
    throw err;
  }
}

async function readFeature(slug) {
  assertSlug(slug);
  if (!(await featureExists(slug))) throw new NotFoundError(`feature '${slug}' not found`);
  const dir = await currentDirectory(slug);
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  const frames = new Map();
  for (const file of (await fs.readdir(path.join(dir, 'frames'))).filter((f) => f.endsWith('.html')).sort()) {
    frames.set(file, await fs.readFile(path.join(dir, 'frames', file), 'utf8'));
  }
  return { slug, manifest, frames };
}

async function writeSnapshot(dir, feature) {
  await fs.mkdir(path.join(dir, 'frames'), { recursive: true });
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(feature.manifest, null, 2) + '\n', 'utf8');
  for (const [file, html] of feature.frames) {
    assertFile(file);
    await fs.writeFile(path.join(dir, 'frames', file), html, 'utf8');
  }
}

async function publishPointer(slug, directory) {
  const temp = path.join(featureDir(slug), `current.${randomUUID()}.tmp`);
  await fs.writeFile(temp, JSON.stringify({ directory }) + '\n', 'utf8');
  await fs.rename(temp, path.join(featureDir(slug), 'current.json'));
}

async function createMarker(slug, manifest) {
  const temp = path.join(featureDir(slug), `manifest.${randomUUID()}.tmp`);
  await fs.writeFile(temp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await fs.rename(temp, manifestPath(slug));
}

async function publishWorking(slug, feature) {
  const directory = `generations/${randomUUID()}`;
  await writeSnapshot(path.join(featureDir(slug), directory), feature);
  await publishPointer(slug, directory);
  return feature;
}

async function createFeature(slug, manifest) {
  assertSlug(slug);
  return serialize(slug, async () => {
    if (await featureExists(slug)) {
      throw new ConflictError(`feature '${slug}' already exists`);
    }
    await fs.mkdir(framesDir(slug), { recursive: true });
    await publishWorking(slug, { slug, manifest, frames: new Map() });
    await createMarker(slug, manifest);
    return getFeature(slug);
  });
}

async function getManifest(slug) {
  assertSlug(slug);
  if (!(await featureExists(slug))) throw new NotFoundError(`feature '${slug}' not found`);
  const dir = await currentDirectory(slug);
  return JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
}

async function listFrameFiles(slug) {
  const dir = framesDir(slug);
  if (!existsSync(dir)) return [];
  return (await fs.readdir(dir)).filter((f) => f.endsWith('.html')).sort();
}

async function getFeature(slug) {
  return readFeature(slug);
}

async function putManifest(slug, manifest) {
  assertSlug(slug);
  return serialize(slug, async () => {
    if (!(await featureExists(slug))) throw new NotFoundError(`feature '${slug}' not found`);
    const feature = await readFeature(slug);
    feature.manifest = manifest;
    return publishWorking(slug, feature);
  });
}

async function putFrame(slug, file, html) {
  assertSlug(slug);
  assertFile(file);
  return serialize(slug, async () => {
    if (!(await featureExists(slug))) throw new NotFoundError(`feature '${slug}' not found`);
    const feature = await readFeature(slug);
    feature.frames.set(file, html);
    await publishWorking(slug, feature);
  });
}

async function getFrame(slug, file) {
  assertSlug(slug);
  assertFile(file);
  const p = path.join(await currentDirectory(slug), 'frames', file);
  if (!existsSync(p)) throw new NotFoundError(`frame '${file}' not found in '${slug}'`);
  return fs.readFile(p, 'utf8');
}

async function deleteFrame(slug, file) {
  assertSlug(slug);
  assertFile(file);
  return serialize(slug, async () => {
    const feature = await readFeature(slug);
    if (!feature.frames.delete(file)) throw new NotFoundError(`frame '${file}' not found in '${slug}'`);
    await publishWorking(slug, feature);
  });
}

async function setStamp(slug, stamp) {
  assertSlug(slug);
  if (typeof stamp !== 'string' || !/^[a-f0-9]{64}$/i.test(stamp)) {
    throw new ValidationError('stamp must be a sha256 hex digest');
  }
  return serialize(slug, async () => {
    if (!(await featureExists(slug))) throw new NotFoundError(`feature '${slug}' not found`);
    const feature = await readFeature(slug);
    const actual = computeStamp(feature);
    if (actual !== stamp) throw stampConflict(actual, stamp);
    feature.manifest.stamp = stamp;
    await snapshotRevision(slug, stamp, feature);
    await publishPointer(slug, `revisions/${stamp}`);
    return feature.manifest;
  });
}

/**
 * Persist the exact reviewable bytes for a content stamp. The mutable feature
 * directory remains the current working projection, while revisions are
 * immutable snapshots. This lets approvals, comments, and later comparisons
 * keep referring to the screen a reviewer actually saw after the next sync.
 */
async function snapshotRevision(slug, stamp, feature) {
  const target = revisionDir(slug, stamp);
  if (existsSync(target)) {
    const existing = await getRevision(slug, stamp);
    if (computeStamp(existing) !== stamp) throw new ConflictError(`stored revision '${stamp}' failed integrity verification`);
    return; // Content-addressed and therefore idempotent.
  }

  const staging = `${target}.tmp-${randomUUID()}`;
  await writeSnapshot(staging, feature);
  await fs.writeFile(
    path.join(staging, 'revision.json'),
    JSON.stringify({
      stamp, createdAt: new Date().toISOString(), sourceRepo: feature.manifest.sourceRepo || null,
      sourceStamp: feature.manifest.sourceStamp || null, importerVersion: feature.manifest.importerVersion || null,
    }, null, 2) + '\n',
    'utf8'
  );
  await fs.mkdir(revisionsDir(slug), { recursive: true });
  try {
    await fs.rename(staging, target);
  } catch (err) {
    // A second process may have completed the same content-addressed snapshot.
    await fs.rm(staging, { recursive: true, force: true });
    if (!existsSync(target)) throw err;
  }
}

async function listRevisions(slug) {
  assertSlug(slug);
  if (!(await featureExists(slug))) throw new NotFoundError(`feature '${slug}' not found`);
  const dir = revisionsDir(slug);
  if (!existsSync(dir)) return [];
  const revisions = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/i.test(entry.name)) continue;
    const metadataPath = path.join(dir, entry.name, 'revision.json');
    if (!existsSync(metadataPath)) continue;
    revisions.push(JSON.parse(await fs.readFile(metadataPath, 'utf8')));
  }
  return revisions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function getRevision(slug, stamp) {
  assertSlug(slug);
  if (typeof stamp !== 'string' || !/^[a-f0-9]{64}$/i.test(stamp)) {
    throw new ValidationError('revision stamp must be a sha256 hex digest');
  }
  const dir = revisionDir(slug, stamp);
  if (!existsSync(dir)) throw new NotFoundError(`revision '${stamp}' not found for feature '${slug}'`);
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  const frames = new Map();
  const snapshotFrames = path.join(dir, 'frames');
  for (const file of (await fs.readdir(snapshotFrames)).filter((name) => name.endsWith('.html')).sort()) {
    frames.set(file, await fs.readFile(path.join(snapshotFrames, file), 'utf8'));
  }
  const metadata = JSON.parse(await fs.readFile(path.join(dir, 'revision.json'), 'utf8'));
  return { slug, stamp, metadata, manifest, frames };
}

async function setFlowApproval(slug, flowId, approval) {
  assertSlug(slug);
  return serialize(slug, async () => {
    if (!(await featureExists(slug))) throw new NotFoundError(`feature '${slug}' not found`);
    const feature = await readFeature(slug);
    const manifest = feature.manifest;
    const flows = (manifest.build && manifest.build.flows) || [];
    const flow = flows.find((f) => f.id === flowId);
    if (!flow) throw new NotFoundError(`flow '${flowId}' not found in feature '${slug}'`);
    Object.assign(flow, approval);
    await publishWorking(slug, feature);
    return flow;
  });
}

function stampConflict(expectedStamp, suppliedStamp) {
  const err = new ConflictError('supplied contentStamp does not match the current feature (stale review)');
  err.code = 'STAMP_CONFLICT';
  err.expectedStamp = expectedStamp;
  err.suppliedStamp = suppliedStamp;
  return err;
}

/** Replace an entire import in one publication; absent files are removed.
 * expectedStamp is optional (unconditional), a digest (CAS), or null (create-only).
 */
async function importFeature(slug, manifest, frames, expectedStamp) {
  assertSlug(slug);
  if (!(frames instanceof Map)) throw new ValidationError('frames must be a Map');
  for (const [file, html] of frames) {
    assertFile(file);
    if (typeof html !== 'string') throw new ValidationError(`frame '${file}' must contain HTML`);
  }
  // Detach from caller-owned references before waiting for the write queue.
  const feature = { slug, manifest: JSON.parse(JSON.stringify(manifest)), frames: new Map(frames) };
  return serialize(slug, async () => {
    const exists = await featureExists(slug);
    const current = exists ? computeStamp(await readFeature(slug)) : null;
    if (expectedStamp !== undefined && expectedStamp !== current) throw stampConflict(current, expectedStamp);
    const stamp = computeStamp(feature);
    feature.manifest.stamp = stamp;
    await fs.mkdir(featureDir(slug), { recursive: true });
    await snapshotRevision(slug, stamp, feature);
    // Legacy existence marker. The pointer is the sole current-content source.
    await publishPointer(slug, `revisions/${stamp}`);
    if (!exists) await createMarker(slug, feature.manifest);
    return getRevision(slug, stamp);
  });
}

async function commitRevision(slug) {
  assertSlug(slug);
  return serialize(slug, async () => {
    const feature = await readFeature(slug);
    const stamp = computeStamp(feature);
    feature.manifest.stamp = stamp;
    await snapshotRevision(slug, stamp, feature);
    await publishPointer(slug, `revisions/${stamp}`);
    return getRevision(slug, stamp);
  });
}

/** Hold the content guard through append-only DB decisions. The callback must
 * not invoke a mutating store operation (which would acquire this lock again).
 */
async function withCurrentRevision(slug, expectedStamp, callback, approval) {
  assertSlug(slug);
  return serialize(slug, async () => {
    const feature = await readFeature(slug);
    const stamp = computeStamp(feature);
    if (expectedStamp !== undefined && expectedStamp !== stamp) throw stampConflict(stamp, expectedStamp);
    feature.manifest.stamp = stamp;
    await snapshotRevision(slug, stamp, feature);
    const result = await callback(feature, stamp);
    if (approval) {
      const flow = feature.manifest.build?.flows?.find((candidate) => candidate.id === approval.flowKey);
      if (flow) {
        Object.assign(flow, approval.value);
        await publishWorking(slug, feature);
      }
    }
    return result;
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
  importFeature,
  commitRevision,
  withCurrentRevision,
  listRevisions,
  getRevision,
  setFlowApproval,
  NotFoundError,
  ConflictError,
  ValidationError,
};
