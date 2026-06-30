/**
 * Security unit + integration tests for bridge-server.js
 * Covers all CRITICAL/HIGH/MEDIUM findings from issue #7.
 *
 * Uses Node.js built-in assert + http — no extra test-framework dependency.
 * Run with: node tests/bridge-server-security.test.cjs
 */

'use strict';

const assert = require('assert');
const http = require('http');

const {
    FigmaMcpBridgeServer,
    generateSessionToken,
    safeCompare,
    validateMcpEnvelope,
    isAllowedOrigin,
} = require('../bridge-server');

// ─── Tiny test runner ─────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log('  PASS  ' + name);
    } catch (err) {
        failed++;
        failures.push({ name, err });
        console.error('  FAIL  ' + name);
        console.error('        ' + (err && err.message ? err.message : String(err)));
    }
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function request(options, body) {
    return new Promise(function(resolve, reject) {
        const req = http.request(options, function(res) {
            const chunks = [];
            res.on('data', function(c) { chunks.push(c); });
            res.on('end', function() {
                let data = null;
                try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {}
                resolve({ status: res.statusCode, headers: res.headers, data: data });
            });
        });
        req.on('error', reject);
        if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
        req.end();
    });
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_PORT = 39015;
const KNOWN_TOKEN = 'test-token-' + generateSessionToken().slice(0, 8);

let serverInstance;

function startServer() {
    return new Promise(function(resolve, reject) {
        serverInstance = new FigmaMcpBridgeServer(TEST_PORT, KNOWN_TOKEN);
        serverInstance.server = http.createServer(function(req, res) {
            serverInstance.handleRequest(req, res);
        });
        serverInstance.server.listen(TEST_PORT, '127.0.0.1', resolve);
        serverInstance.server.on('error', reject);
    });
}

function stopServer() {
    return new Promise(function(resolve) {
        if (serverInstance && serverInstance.server) {
            serverInstance.server.close(resolve);
        } else {
            resolve();
        }
    });
}

function opts(method, path, token, extraHeaders) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    Object.assign(headers, extraHeaders || {});
    return { hostname: '127.0.0.1', port: TEST_PORT, path: path, method: method, headers: headers };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {

    // =========================================================================
    // 1. Unit tests (no server needed)
    // =========================================================================

    console.log('\n[1] Unit tests (no server)');

    await test('generateSessionToken returns 64-char hex string', function() {
        const tok = generateSessionToken();
        assert.strictEqual(tok.length, 64);
        assert.ok(/^[0-9a-f]+$/.test(tok), 'should be hex');
    });

    await test('safeCompare: equal strings return true', function() {
        assert.strictEqual(safeCompare('abc123', 'abc123'), true);
    });

    await test('safeCompare: different strings return false', function() {
        assert.strictEqual(safeCompare('abc123', 'abc124'), false);
    });

    await test('safeCompare: different lengths return false without throw', function() {
        assert.strictEqual(safeCompare('short', 'longer-string'), false);
    });

    await test('safeCompare: non-string values return false', function() {
        assert.strictEqual(safeCompare(null, 'x'), false);
        assert.strictEqual(safeCompare('x', undefined), false);
    });

    await test('validateMcpEnvelope: valid envelope passes', function() {
        const err = validateMcpEnvelope({ jsonrpc: '2.0', method: 'initialize', id: 1 });
        assert.strictEqual(err, null);
    });

    await test('validateMcpEnvelope: missing jsonrpc fails', function() {
        const err = validateMcpEnvelope({ method: 'initialize' });
        assert.ok(typeof err === 'string', 'should return error string');
    });

    await test('validateMcpEnvelope: non-string method fails', function() {
        const err = validateMcpEnvelope({ jsonrpc: '2.0', method: 42 });
        assert.ok(typeof err === 'string');
    });

    await test('validateMcpEnvelope: empty method fails', function() {
        const err = validateMcpEnvelope({ jsonrpc: '2.0', method: '' });
        assert.ok(typeof err === 'string');
    });

    await test('validateMcpEnvelope: array params fails', function() {
        const err = validateMcpEnvelope({ jsonrpc: '2.0', method: 'tools/call', params: [1, 2] });
        assert.ok(typeof err === 'string');
    });

    await test('validateMcpEnvelope: object params passes', function() {
        const err = validateMcpEnvelope({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'get_pages' } });
        assert.strictEqual(err, null);
    });

    await test('isAllowedOrigin: http://localhost allowed', function() {
        assert.strictEqual(isAllowedOrigin('http://localhost'), true);
    });

    await test('isAllowedOrigin: http://localhost:3000 allowed', function() {
        assert.strictEqual(isAllowedOrigin('http://localhost:3000'), true);
    });

    await test('isAllowedOrigin: http://127.0.0.1:8080 allowed', function() {
        assert.strictEqual(isAllowedOrigin('http://127.0.0.1:8080'), true);
    });

    await test('isAllowedOrigin: https://evil.com blocked', function() {
        assert.strictEqual(isAllowedOrigin('https://evil.com'), false);
    });

    await test('isAllowedOrigin: empty string returns false', function() {
        assert.strictEqual(isAllowedOrigin(''), false);
    });

    // =========================================================================
    // 2. Integration tests (HTTP server)
    // =========================================================================

    console.log('\n[2] Integration tests (HTTP server on 127.0.0.1:' + TEST_PORT + ')');

    await startServer();

    // [C2] Auth enforcement

    await test('[C2] /status without token -> 401', async function() {
        const r = await request(opts('GET', '/status', null));
        assert.strictEqual(r.status, 401);
    });

    await test('[C2] /status with wrong token -> 401', async function() {
        const r = await request(opts('GET', '/status', 'bad-token'));
        assert.strictEqual(r.status, 401);
    });

    await test('[C2] /status with correct token -> 200', async function() {
        const r = await request(opts('GET', '/status', KNOWN_TOKEN));
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.data.server, 'running');
    });

    await test('[C2] /health is auth-exempt -> 200', async function() {
        const r = await request(opts('GET', '/health', null));
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.data.status, 'healthy');
    });

    await test('[C2] /plugin/get-requests without token -> 401', async function() {
        const r = await request(opts('GET', '/plugin/get-requests', null));
        assert.strictEqual(r.status, 401);
    });

    await test('[C2] /plugin/connect without token -> 401', async function() {
        const r = await request(opts('POST', '/plugin/connect', null), '{}');
        assert.strictEqual(r.status, 401);
    });

    await test('[C2] /plugin/send-response without token -> 401', async function() {
        const r = await request(opts('POST', '/plugin/send-response', null), '{"requestId":"x","response":{}}');
        assert.strictEqual(r.status, 401);
    });

    await test('[C2] /mcp/request without token -> 401', async function() {
        const r = await request(opts('POST', '/mcp/request', null), '{}');
        assert.strictEqual(r.status, 401);
    });

    // [C3] CORS

    await test('[C3] allowed origin reflected in CORS header', async function() {
        const r = await request(opts('GET', '/health', null, { Origin: 'http://localhost:3000' }));
        const acao = r.headers['access-control-allow-origin'];
        assert.strictEqual(acao, 'http://localhost:3000', 'expected origin to be reflected; got: ' + acao);
    });

    await test('[C3] disallowed origin NOT reflected in CORS header', async function() {
        const r = await request(opts('GET', '/health', null, { Origin: 'https://evil.com' }));
        const acao = r.headers['access-control-allow-origin'];
        assert.ok(!acao || acao === undefined, 'evil origin should NOT be in ACAO; got: ' + acao);
    });

    // [M1] Envelope validation

    await test('[M1] /mcp/request with non-2.0 jsonrpc -> 400', async function() {
        const r = await request(
            opts('POST', '/mcp/request', KNOWN_TOKEN),
            JSON.stringify({ jsonrpc: '1.0', method: 'initialize' })
        );
        assert.strictEqual(r.status, 400);
    });

    await test('[M1] /mcp/request with missing method -> 400', async function() {
        const r = await request(
            opts('POST', '/mcp/request', KNOWN_TOKEN),
            JSON.stringify({ jsonrpc: '2.0' })
        );
        assert.strictEqual(r.status, 400);
    });

    await test('[M1] /mcp/request with invalid JSON -> 400', async function() {
        const r = await request(opts('POST', '/mcp/request', KNOWN_TOKEN), 'not-json{');
        assert.strictEqual(r.status, 400);
    });

    // [M2] Body size cap

    await test('[M2] oversized body on /mcp/request -> 413', async function() {
        const big = JSON.stringify({ jsonrpc: '2.0', method: 'x', data: 'A'.repeat(70 * 1024) });
        const r = await request(opts('POST', '/mcp/request', KNOWN_TOKEN), big);
        assert.strictEqual(r.status, 413);
    });

    await test('[M2] oversized body on /plugin/send-response -> 413', async function() {
        const big = JSON.stringify({ requestId: 'x', response: { data: 'A'.repeat(70 * 1024) } });
        const r = await request(opts('POST', '/plugin/send-response', KNOWN_TOKEN), big);
        assert.strictEqual(r.status, 413);
    });

    // [H2] requestId ownership

    await test('[H2] send-response with non-existent requestId -> 404', async function() {
        const r = await request(
            opts('POST', '/plugin/send-response', KNOWN_TOKEN),
            JSON.stringify({ requestId: 'does-not-exist-' + Date.now(), response: { ok: true } })
        );
        assert.strictEqual(r.status, 404);
    });

    await test('[H2] send-response with empty requestId -> 400', async function() {
        const r = await request(
            opts('POST', '/plugin/send-response', KNOWN_TOKEN),
            JSON.stringify({ requestId: '', response: {} })
        );
        assert.strictEqual(r.status, 400);
    });

    await test('[H2] send-response without response field -> 400', async function() {
        const r = await request(
            opts('POST', '/plugin/send-response', KNOWN_TOKEN),
            JSON.stringify({ requestId: 'some-id' })
        );
        assert.strictEqual(r.status, 400);
    });

    // [H1] plugin/get-requests requires auth

    await test('[H1] get-requests with correct token -> 200 with requests array', async function() {
        const r = await request(opts('GET', '/plugin/get-requests', KNOWN_TOKEN));
        assert.strictEqual(r.status, 200);
        assert.ok(Array.isArray(r.data.requests));
    });

    // [H3] plugin/connect requires auth

    await test('[H3] plugin/connect with correct token -> 200', async function() {
        const r = await request(opts('POST', '/plugin/connect', KNOWN_TOKEN), JSON.stringify({}));
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.data.status, 'connected');
    });

    // MCP protocol happy paths

    await test('initialize -> 200 with protocol version', async function() {
        const r = await request(
            opts('POST', '/mcp/request', KNOWN_TOKEN),
            JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 })
        );
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.data.result.protocolVersion, '2024-11-05');
    });

    await test('tools/list -> 200 with tools array', async function() {
        const r = await request(
            opts('POST', '/mcp/request', KNOWN_TOKEN),
            JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 })
        );
        assert.strictEqual(r.status, 200);
        assert.ok(Array.isArray(r.data.result.tools));
        assert.ok(r.data.result.tools.length > 0);
    });

    await test('unknown tool without plugin connected -> 500 JSON-RPC error', async function() {
        serverInstance.figmaConnected = false;
        const r = await request(
            opts('POST', '/mcp/request', KNOWN_TOKEN),
            JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: 3, params: { name: 'get_pages' } })
        );
        assert.strictEqual(r.status, 500);
        assert.ok(r.data.error, 'should have JSON-RPC error');
    });

    // Teardown

    await stopServer();

    // Summary

    console.log('\n' + '─'.repeat(50));
    if (failed === 0) {
        console.log('All ' + passed + ' tests passed.');
    } else {
        console.log(passed + ' passed, ' + failed + ' FAILED.');
        failures.forEach(function(f) {
            console.error('\nFAIL: ' + f.name);
            console.error(f.err && f.err.stack ? f.err.stack : String(f.err));
        });
    }
    console.log('─'.repeat(50) + '\n');

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(function(err) {
    console.error('Fatal:', err);
    process.exit(1);
});
