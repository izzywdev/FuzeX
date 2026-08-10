'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-frames-mcp-test-'));
  process.env.DESIGN_FRAMES_DATA_DIR = tmp;
  delete require.cache[require.resolve('../lib/store')];
  const { handleMessage, HANDLERS } = require('../mcp/server');

  assert.ok(HANDLERS.list_features, 'list_features handler is registered');
  assert.ok(HANDLERS.propose_frame, 'propose_frame handler is registered');

  const responses = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { responses.push(JSON.parse(chunk)); return true; };

  try {
    await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.ok(responses[0].result.tools.some((t) => t.name === 'create_feature'), 'tools/list includes create_feature');

    await handleMessage({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'create_feature', arguments: { slug: 'mcp-test', name: 'MCP Test', description: 'via mcp' } },
    });
    assert.strictEqual(responses[1].error, undefined, 'create_feature via MCP succeeds');

    await handleMessage({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: {
        name: 'propose_frame',
        arguments: { slug: 'mcp-test', id: '01-a', file: '01-a.html', label: 'A', summary: 'first screen', testHooks: ["[data-frame='a']"], html: '<p>a</p>' },
      },
    });
    assert.strictEqual(responses[2].error, undefined, 'propose_frame via MCP succeeds');

    await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_feature', arguments: { slug: 'mcp-test' } } });
    const feature = JSON.parse(responses[3].result.content[0].text);
    assert.strictEqual(feature.manifest.frames.length, 1, 'proposed frame appears in manifest.frames');
    assert.strictEqual(feature.frames['01-a.html'], '<p>a</p>', 'frame content stored');

    await handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_feature', arguments: { slug: 'does-not-exist' } } });
    assert.strictEqual(responses[4].error.code, -32001, 'unknown slug maps to a NOT_FOUND JSON-RPC error');
  } finally {
    process.stdout.write = origWrite;
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('mcp.test.cjs: all assertions passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
