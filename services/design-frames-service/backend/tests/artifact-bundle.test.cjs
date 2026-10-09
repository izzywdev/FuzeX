'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArtifactBundleCreate, assertSafeArtifactPath } = require('../dist/lib/artifactBundle.js');
const { S3CompatibleArtifactObjectStore, artifactStorageConfigFromEnv } = require('../dist/lib/artifactStore.js');

const digest = 'a'.repeat(64);
const input = () => ({ flowKey: 'checkout', displayName: 'Checkout', contentSha256: digest, objects: [
  { path: 'index.html', contentType: 'text/html', byteSize: 12, sha256: digest },
  { path: 'assets/app.js', contentType: 'text/javascript', byteSize: 1, sha256: 'b'.repeat(64) },
] });

test('artifact bundle declaration only accepts bounded, immutable object metadata', () => {
  const parsed = parseArtifactBundleCreate(input(), 'user-1', 'private-fuzex');
  assert.equal(parsed.flowKey, 'checkout');
  assert.equal(parsed.objects.length, 2);
  for (const bad of [
    { ...input(), objects: [{ ...input().objects[0], path: '../secret' }] },
    { ...input(), contentSha256: 'UPPER' },
    { ...input(), objects: [input().objects[0], input().objects[0]] },
    { ...input(), createdBy: 'spoofed' },
  ]) assert.throws(() => parseArtifactBundleCreate(bad, 'user-1', 'private-fuzex'), /invalid artifact bundle/);
  assert.equal(assertSafeArtifactPath('assets/app.js'), 'assets/app.js');
  assert.throws(() => assertSafeArtifactPath('../x'), /invalid artifact object path/);
});

test('S3-compatible storage adapter is injected and never requires browser credentials', async () => {
  const calls = [];
  const store = new S3CompatibleArtifactObjectStore(
    { provider: 's3', bucket: 'private-fuzex', region: 'us-east-1', endpoint: 'https://minio.internal' },
    {
      async put(value) { calls.push(['put', value]); },
      async head(value) { calls.push(['head', value]); return { sha256: digest }; },
      async get(value) { calls.push(['get', value]); return { body: new Uint8Array([1]), contentType: 'text/plain' }; },
    }
  );
  await store.putObject({ key: 'private/key', body: new Uint8Array([1]), contentType: 'text/plain', sha256: digest });
  assert.equal(await store.objectExists('private/key', digest), true);
  assert.equal((await store.getObject('private/key')).contentType, 'text/plain');
  assert.deepEqual(calls.map(([op]) => op), ['put', 'head', 'get']);
  assert.throws(() => artifactStorageConfigFromEnv({ ARTIFACT_STORAGE_PROVIDER: 's3', ARTIFACT_STORAGE_BUCKET: 'b', ARTIFACT_STORAGE_REGION: 'r', ARTIFACT_STORAGE_ENDPOINT: 'http://minio' }), /https/);
});
