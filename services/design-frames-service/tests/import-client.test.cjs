'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

test('repository importer publishes one complete snapshot with original source provenance', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fuzex-import-client-'));
  const originalFetch = global.fetch;
  const originalUrl = process.env.DESIGN_FRAMES_SERVICE_URL;
  const originalToken = process.env.DESIGN_FRAMES_API_TOKEN;
  const manifest = {
    name: 'Example', description: 'Example flow', designSystem: 'example', entry: 'index.html',
    frames: [], build: { flows: [] },
  };
  const html = '<link rel="stylesheet" href="screen.css"><p>Original frame</p>';
  const css = 'p { color: blue; }';
  try {
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    await fs.writeFile(path.join(directory, 'index.html'), html);
    await fs.writeFile(path.join(directory, 'screen.css'), css);
    const canonicalManifest = Object.fromEntries(Object.keys(manifest).sort().map((key) => [key, manifest[key]]));
    const source = new Map([
      ['manifest.json', JSON.stringify(canonicalManifest)], ['index.html', html], ['screen.css', css],
    ]);
    const hash = createHash('sha256');
    for (const filename of Array.from(source.keys()).sort()) {
      hash.update(`${filename}\0${createHash('sha256').update(source.get(filename)).digest('hex')}\n`);
    }
    const expectedSourceStamp = hash.digest('hex');
    const calls = [];
    process.env.DESIGN_FRAMES_SERVICE_URL = 'https://test.invalid';
    process.env.DESIGN_FRAMES_API_TOKEN = 'test-token';
    global.fetch = async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith('/stamp')) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      const body = JSON.parse(options.body);
      assert.equal(body.expectedStamp, null, 'first import is create-only');
      assert.equal(body.manifest.sourceStamp, expectedSourceStamp, 'source hash includes original CSS and original HTML');
      assert.equal(body.manifest.sourceRepo, 'FuzeFront');
      assert.equal(body.manifest.importerVersion, 'fuzex-repository-import/1');
      assert.equal(body.frames['index.html'], `<style data-fuzex-imported-stylesheet="screen.css">${css}</style><p>Original frame</p>`);
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      return new Response(JSON.stringify({ stamp: 'a'.repeat(64) }));
    };
    const client = await import('../client/design-frames-client.mjs');
    const result = await client.syncFeature('example', directory, { sourceRepo: 'FuzeFront' });
    assert.equal(result.sourceStamp, expectedSourceStamp);
    assert.equal(calls.length, 2, 'one read and one atomic import; no per-frame mutation calls');
    assert.equal(calls[1].url, 'https://test.invalid/api/v1/features/example/import');
    assert.equal(calls[1].options.method, 'POST');
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.DESIGN_FRAMES_SERVICE_URL;
    else process.env.DESIGN_FRAMES_SERVICE_URL = originalUrl;
    if (originalToken === undefined) delete process.env.DESIGN_FRAMES_API_TOKEN;
    else process.env.DESIGN_FRAMES_API_TOKEN = originalToken;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('repository importer rejects source links that leave the selected tree', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fuzex-import-links-'));
  try {
    await fs.symlink(path.join(directory, '..'), path.join(directory, 'escape'));
    const client = await import('../client/design-frames-client.mjs');
    await assert.rejects(client.syncFeature('example', directory), /source symlinks are not supported/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
