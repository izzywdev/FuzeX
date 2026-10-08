#!/usr/bin/env node
/**
 * design-frames-client.mjs — the installable client package for design-frames-service.
 *
 * Frames are authored and version-controlled in EACH CONSUMING REPO, exactly like a
 * `.fig` file lives with the project that uses it — this service never becomes their
 * storage. What it owns is their LIFECYCLE: per-flow approval/reject and a navigable
 * review site. A consuming repo installs this client (copy this file into its own
 * `scripts/`, or `import` it if the repo can depend on this package directly), authors
 * `design/frames/<feature>/**` locally as always, then SYNCS the current content here
 * so design-frames-service can track its lifecycle and serve the navigable review site.
 * Re-run `sync` after any local edit — this is not a one-time migration, it's a
 * publish step, the same way you'd re-push a `.fig` file after editing it locally.
 *
 * Node stdlib `fetch` only, no dependency — mirrors bridge-server.js's dependency-light
 * convention.
 *
 * Config (env):
 *   DESIGN_FRAMES_SERVICE_URL   base URL of the deployed service (required)
 *   DESIGN_FRAMES_API_TOKEN     bearer token for write operations (sync/approve/reject)
 *
 * CLI:
 *   node design-frames-client.mjs list
 *   node design-frames-client.mjs get <slug>
 *   node design-frames-client.mjs stamp <slug>
 *   node design-frames-client.mjs sync <slug> <localFeatureDir> [sourceRepo]
 *   node design-frames-client.mjs approve <slug> <flowId> <approvedBy>
 *   node design-frames-client.mjs reject <slug> <flowId> <notes>
 *
 * Also usable as a module:
 *   import { listFeatures, getFeature, syncFeature, approveFlow } from './design-frames-client.mjs';
 */

function baseUrl() {
  const url = process.env.DESIGN_FRAMES_SERVICE_URL;
  if (!url) throw new Error('DESIGN_FRAMES_SERVICE_URL is not set — point it at the deployed design-frames-service.');
  return url.replace(/\/$/, '');
}

function authHeaders(extra) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  const token = process.env.DESIGN_FRAMES_API_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function call(path, options = {}) {
  const res = await fetch(`${baseUrl()}${path}`, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`design-frames-service ${options.method || 'GET'} ${path} -> ${res.status}: ${body.error || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// ---- reads -----------------------------------------------------------------

export async function listFeatures() {
  return call('/api/v1/features');
}

export async function getFeature(slug) {
  return call(`/api/v1/features/${encodeURIComponent(slug)}`);
}

export async function getStamp(slug) {
  return call(`/api/v1/features/${encodeURIComponent(slug)}/stamp`);
}

export function siteUrl(slug, file) {
  return file
    ? `${baseUrl()}/site/${encodeURIComponent(slug)}/${encodeURIComponent(file)}`
    : `${baseUrl()}/site/${encodeURIComponent(slug)}`;
}

// ---- writes (require DESIGN_FRAMES_API_TOKEN) -------------------------------

export async function createFeature(slug, opts = {}) {
  return call('/api/v1/features', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ slug, ...opts }),
  });
}

export async function putManifest(slug, manifest) {
  return call(`/api/v1/features/${encodeURIComponent(slug)}/manifest`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(manifest),
  });
}

export async function putFrame(slug, file, html) {
  return call(`/api/v1/features/${encodeURIComponent(slug)}/frames/${encodeURIComponent(file)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ html }),
  });
}

export async function commitStamp(slug) {
  return call(`/api/v1/features/${encodeURIComponent(slug)}/stamp`, {
    method: 'POST',
    headers: authHeaders(),
  });
}

export async function approveFlow(slug, flowId, approvedBy, contentStamp) {
  const stamp = contentStamp ?? (await getStamp(slug)).stamp;
  return call(`/api/v1/features/${encodeURIComponent(slug)}/flows/${encodeURIComponent(flowId)}/approve`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ approvedBy, contentStamp: stamp }),
  });
}

export async function rejectFlow(slug, flowId, notes, contentStamp) {
  const stamp = contentStamp ?? (await getStamp(slug)).stamp;
  return call(`/api/v1/features/${encodeURIComponent(slug)}/flows/${encodeURIComponent(flowId)}/reject`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ reason: notes, contentStamp: stamp }),
  });
}

/** Import every static frame set under `design/frames`. This is intentionally
 * filesystem/repository based rather than fetching arbitrary URLs: it imports
 * the authoritative manifest and source HTML, preserves provenance, and avoids
 * turning the hosted API into an SSRF-capable GitHub proxy. */
export async function syncFrameDirectory(framesRoot, { sourceRepo, continueOnError = true } = {}) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const results = [];
  for (const entry of await fs.readdir(framesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const localDir = path.join(framesRoot, entry.name);
    try {
      await fs.access(path.join(localDir, 'manifest.json'));
    } catch {
      continue;
    }
    try {
      results.push({ ...(await syncFeature(entry.name, localDir, { sourceRepo })), status: 'imported' });
    } catch (err) {
      if (!continueOnError) throw err;
      results.push({ slug: entry.name, status: 'failed', error: err.message, httpStatus: err.status ?? null });
    }
  }
  return results.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * syncFeature — publish a locally-authored `design/frames/<slug>/` directory into
 * design-frames-service in one complete, compare-and-swap import. It publishes
 * exactly the source frame set and commits its immutable hosted revision.
 */
export async function syncFeature(slug, localDir, { sourceRepo } = {}) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const sourceFiles = await readSourceSnapshot(fs, path, localDir);
  if (!sourceFiles.has('manifest.json')) throw new Error('source directory is missing manifest.json');
  const manifest = JSON.parse(sourceFiles.get('manifest.json').toString('utf8'));
  const sourceStamp = await stampSourceFiles(sourceFiles, manifest);
  const resolvedSourceRepo = sourceRepo || manifest.sourceRepo || null;
  let expectedStamp = null;
  try { expectedStamp = (await getStamp(slug)).stamp; } catch (err) {
    if (err.status !== 404) throw err;
  }
  const files = new Set((manifest.frames || []).map((f) => f.file));
  if (manifest.entry) files.add(manifest.entry);
  const frames = Object.create(null);
  for (const file of files) {
    if (typeof file !== 'string' || !/^[^/\\\0]+\.html$/.test(file) || file.includes('..')) {
      throw new Error(`unsupported frame path '${file}'; frames must be flat HTML files`);
    }
    frames[file] = await readFrameWithLocalStyles(sourceFiles, file);
  }
  const { stamp } = await call(`/api/v1/features/${encodeURIComponent(slug)}/import`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ manifest: { ...manifest, sourceRepo: resolvedSourceRepo, sourceStamp, importerVersion: 'fuzex-repository-import/1' }, frames, expectedStamp }),
  });
  return { slug, stamp, sourceStamp, framesSynced: files.size, siteUrl: siteUrl(slug) };
}

async function readSourceSnapshot(fs, path, localDir) {
  const files = new Map();
  const visit = async (directory, prefix = '') => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`source symlinks are not supported: '${relative}'`);
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), relative);
      else if (entry.isFile()) files.set(relative, await fs.readFile(path.join(directory, entry.name)));
    }
  };
  await visit(localDir);
  return files;
}

// Original repository provenance uses the FuzeFront source-tree algorithm,
// before adding provenance fields or embedding CSS into hosted HTML.
async function stampSourceFiles(files, manifest) {
  const { createHash } = await import('node:crypto');
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => !['approved', 'approvedBy', 'approvedAt'].includes(key))
      .map((key) => [key, canonical(value[key])]));
  };
  const { stamp: _ignored, ...rest } = manifest;
  const result = createHash('sha256');
  for (const relative of Array.from(files.keys()).sort()) {
    const bytes = relative === 'manifest.json' ? JSON.stringify(canonical(rest)) : files.get(relative);
    const hash = createHash('sha256').update(bytes).digest('hex');
    result.update(`${relative}\0${hash}\n`);
  }
  return result.digest('hex');
}

/**
 * The v1 review API serves HTML frames, not arbitrary repository assets. Make
 * imported Pages frames self-contained by replacing same-directory stylesheet
 * links with their CSS bytes. Remote URLs and parent-directory paths are left
 * alone; importing must never read outside the selected feature directory.
 */
async function readFrameWithLocalStyles(sourceFiles, file) {
  if (!sourceFiles.has(file)) throw new Error(`source directory is missing frame '${file}'`);
  const html = sourceFiles.get(file).toString('utf8');
  const matcher = /<link\b([^>]*?)href=["']([^"']+)["']([^>]*)>/gi;
  let out = '';
  let cursor = 0;
  for (let match; (match = matcher.exec(html)); ) {
    const [tag, before, href, after] = match;
    out += html.slice(cursor, match.index);
    cursor = match.index + tag.length;
    const attrs = `${before} ${after}`;
    const localCss =
      /\brel=["']?stylesheet(?:["'\s]|$)/i.test(attrs) &&
      !href.includes('..') &&
      !href.includes('\\') &&
      !href.startsWith('/') &&
      !/^[a-z][a-z0-9+.-]*:/i.test(href) &&
      href.endsWith('.css');
    if (!localCss) {
      out += tag;
      continue;
    }
    try {
      if (!sourceFiles.has(href)) throw new Error(`missing source stylesheet '${href}'`);
      const css = sourceFiles.get(href).toString('utf8');
      out += `<style data-fuzex-imported-stylesheet="${escapeHtmlAttribute(href)}">${css}</style>`;
    } catch {
      // Preserve a broken source link rather than silently claiming that the
      // imported frame is complete.
      out += tag;
    }
  }
  return out + html.slice(cursor);
}

function escapeHtmlAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ---- CLI ---------------------------------------------------------------------

async function main() {
  const [, , cmd, ...args] = process.argv;
  try {
    switch (cmd) {
      case 'list': {
        const { features } = await listFeatures();
        console.log(JSON.stringify(features, null, 2));
        break;
      }
      case 'get': {
        if (!args[0]) throw new Error('usage: get <slug>');
        console.log(JSON.stringify(await getFeature(args[0]), null, 2));
        break;
      }
      case 'stamp': {
        if (!args[0]) throw new Error('usage: stamp <slug>');
        console.log(JSON.stringify(await getStamp(args[0]), null, 2));
        break;
      }
      case 'sync': {
        const [slug, localDir, sourceRepo] = args;
        if (!slug || !localDir) throw new Error('usage: sync <slug> <localFeatureDir> [sourceRepo]');
        console.log(JSON.stringify(await syncFeature(slug, localDir, { sourceRepo }), null, 2));
        break;
      }
      case 'sync-all': {
        const [framesRoot, sourceRepo] = args;
        if (!framesRoot) throw new Error('usage: sync-all <design/frames directory> [sourceRepo]');
        const results = await syncFrameDirectory(framesRoot, { sourceRepo });
        console.log(JSON.stringify(results, null, 2));
        if (results.some((result) => result.status === 'failed')) process.exitCode = 1;
        break;
      }
      case 'approve': {
        const [slug, flowId, approvedBy] = args;
        if (!slug || !flowId || !approvedBy) throw new Error('usage: approve <slug> <flowId> <approvedBy>');
        console.log(JSON.stringify(await approveFlow(slug, flowId, approvedBy), null, 2));
        break;
      }
      case 'reject': {
        const [slug, flowId, notes] = args;
        if (!slug || !flowId) throw new Error('usage: reject <slug> <flowId> <notes>');
        console.log(JSON.stringify(await rejectFlow(slug, flowId, notes || ''), null, 2));
        break;
      }
      default:
        console.error('usage: design-frames-client.mjs (list | get <slug> | stamp <slug> | sync <slug> <localFeatureDir> [sourceRepo] | sync-all <design/frames directory> [sourceRepo] | approve <slug> <flowId> <approvedBy> | reject <slug> <flowId> <reason>)');
        process.exit(2);
    }
  } catch (err) {
    console.error(err.message ?? err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
