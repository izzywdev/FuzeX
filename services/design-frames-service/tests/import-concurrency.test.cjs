'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('independent processes cannot both publish an import based on the same stamp', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fuzex-import-race-'));
  const storePath = require.resolve('../lib/store');
  const previousDataDir = process.env.DESIGN_FRAMES_DATA_DIR;
  const manifest = { name: 'Initial', description: 'd', designSystem: 'ds', entry: 'index.html', frames: [], build: { flows: [] } };
  const children = [];
  try {
    process.env.DESIGN_FRAMES_DATA_DIR = directory;
    delete require.cache[storePath];
    const store = require(storePath);
    const first = await store.importFeature('example', manifest, new Map([['index.html', 'Initial']]), null);
    const startWriter = (name) => {
      const script = `
        const store = require(process.env.FUZEX_TEST_STORE);
        process.stdout.write('ready\\n');
        process.stdin.once('data', async () => {
          try {
            const result = await store.importFeature('example', JSON.parse(process.env.FUZEX_TEST_MANIFEST), new Map([['index.html', process.env.FUZEX_TEST_NAME]]), process.env.FUZEX_TEST_BASE);
            process.stdout.write(JSON.stringify({ stamp: result.stamp }) + '\\n');
          } catch (err) { process.stdout.write(JSON.stringify({ code: err.code }) + '\\n'); }
          process.exit(0);
        });`;
      const child = spawn(process.execPath, ['-e', script], { env: {
        ...process.env, FUZEX_TEST_STORE: storePath, FUZEX_TEST_BASE: first.stamp,
        FUZEX_TEST_MANIFEST: JSON.stringify({ ...manifest, name }), FUZEX_TEST_NAME: name,
      } });
      children.push(child);
      let output = '';
      let errors = '';
      let readyResolve;
      const ready = new Promise((resolve) => { readyResolve = resolve; });
      child.stdout.on('data', (data) => {
        output += data.toString();
        if (output.includes('ready\n')) readyResolve();
      });
      child.stderr.on('data', (data) => { errors += data.toString(); });
      const completed = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0) return reject(new Error(`writer exited ${code}: ${errors}`));
          resolve(JSON.parse(output.trim().split('\n').at(-1)));
        });
      });
      return { child, ready, completed };
    };
    const writers = [startWriter('Writer A'), startWriter('Writer B')];
    await Promise.all(writers.map((writer) => writer.ready));
    writers.forEach((writer) => writer.child.stdin.write('go\n'));
    const outcomes = await Promise.all(writers.map((writer) => writer.completed));
    assert.equal(outcomes.filter((result) => result.stamp).length, 1);
    assert.equal(outcomes.filter((result) => result.code === 'STAMP_CONFLICT').length, 1);
    const feature = await store.getFeature('example');
    assert.equal(feature.frames.get('index.html'), feature.manifest.name, 'current pointer publishes one complete writer snapshot');
    const revision = await store.getRevision('example', feature.manifest.stamp);
    assert.equal(revision.frames.get('index.html'), revision.manifest.name);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    if (previousDataDir === undefined) delete process.env.DESIGN_FRAMES_DATA_DIR;
    else process.env.DESIGN_FRAMES_DATA_DIR = previousDataDir;
    delete require.cache[storePath];
    await fs.rm(directory, { recursive: true, force: true });
  }
});
