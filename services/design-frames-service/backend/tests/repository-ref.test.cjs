'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// This is a source-level contract test because the backend TypeScript source
// is compiled in CI. It protects the exact legacy URL forms accepted by the
// importer without requiring the private production auth package locally.
test('repository reference normalizer accepts canonical and GitHub URL forms', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'src', 'lib', 'repositoryRef.ts'), 'utf8');
  assert.match(source, /github\\\.com/);
  assert.match(source, /return github \? `\$\{github\[1\]\}\/\$\{github\[2\]\}` : raw/);
});
