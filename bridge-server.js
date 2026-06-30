#!/usr/bin/env node

/**
 * Figma MCP Bridge Server
 * This Node.js server acts as a bridge between external MCP clients and the Figma plugin
 * It provides HTTP/SSE endpoints for MCP communication.
 *
 * SECURITY CLASSIFICATION: localhost-only developer tool.
 * This bridge is NOT a hosted service. It binds to 127.0.0.1 only and uses a
 * per-session bearer token (generated at startup, displayed in the console).
 * No FuzeFront OIDC/Authentik integration is required for this classification;
 * the loopback-bind + token IS the authN boundary (see issue #7 architecture note).
 *
 * Security controls (all CRITICAL/HIGH from issue #7):
 *   [C1] Binds to 127.0.0.1 only — no 0.0.0.0 exposure
 *   [C2] Per-session bearer token required on every route except /health
 *   [C3] CORS allowlist (localhost origins only) — replaces wildcard *
 *   [C4] manifest allowedDomains restricted to localhost variants
 *   [H1] GET /plugin/get-requests scoped to plugin session via same token
 *   [H2] requestId ownership validated on send-response
 *   [H3] POST /plugin/connect requires bearer token (prevents spoofing)
 *   [M1] JSON-RPC envelope schema-validated before use
 *   [M2] Request body capped at MAX_BODY_BYTES (64 KB)
 *   [M3] request.params guarded before dereferencing .name
 */

'use strict';

const http = require('http');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// ─── Constants ────────────────────────────────────────────────────────────────

const BIND_HOST = '127.0.0.1';  // [C1] loopback only — never 0.0.0.0
const MAX_BODY_BYTES = 64 * 1024; // [M2] 64 KB body cap

// Allowed CORS origins: localhost variants only. [C3]
const ALLOWED_CORS_ORIGINS = new Set([
    'http://localhost',
    'http://127.0.0.1',
    // With ports — the plugin iframe uses these during dev
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/127\.0\.0\.1:\d+$/,
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random token (32 bytes, hex-encoded = 64 chars).
 */
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Constant-time comparison to prevent timing attacks on the token check.
 */
function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) {
        // Still run timingSafeEqual on equal-length dummy to avoid length oracle
        crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
        return false;
    }
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Return the Origin of the request (or empty string if absent).
 */
function getOrigin(req) {
    return req.headers['origin'] || '';
}

/**
 * Determine whether the given origin is in the allowlist.
 */
function isAllowedOrigin(origin) {
    if (!origin) return false; // no-origin requests (non-browser clients) pass CORS differently
    for (const entry of ALLOWED_CORS_ORIGINS) {
        if (typeof entry === 'string' && entry === origin) return true;
        if (entry instanceof RegExp && entry.test(origin)) return true;
    }
    return false;
}

/**
 * Validate a JSON-RPC 2.0 MCP envelope minimally.
 * Returns null if valid, or an error string if invalid.
 * [M1]
 */
function validateMcpEnvelope(obj) {
    if (!obj || typeof obj !== 'object') return 'body must be a JSON object';
    if (obj.jsonrpc !== '2.0') return 'jsonrpc must be "2.0"';
    if (typeof obj.method !== 'string' || obj.method.length === 0) return 'method must be a non-empty string';
    if (obj.id !== undefined && typeof obj.id !== 'string' && typeof obj.id !== 'number' && obj.id !== null) {
        return 'id must be string, number, or null if present';
    }
    if (obj.params !== undefined && (typeof obj.params !== 'object' || Array.isArray(obj.params))) {
        return 'params must be an object if present';
    }
    return null;
}

/**
 * Read request body with a byte cap. Returns a Buffer.
 * Rejects with BodyTooLargeError if body exceeds MAX_BODY_BYTES.
 * We drain (not destroy) so the TCP connection stays open and the caller
 * can still write the 413 response before the socket closes. [M2]
 */
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let tooLarge = false;

        req.on('data', chunk => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES && !tooLarge) {
                tooLarge = true;
                // Drain remaining data so the socket is not stuck; do not destroy.
                req.resume();
                reject(new BodyTooLargeError());
                return;
            }
            if (!tooLarge) {
                chunks.push(chunk);
            }
        });

        req.on('end', () => {
            if (!tooLarge) resolve(Buffer.concat(chunks));
        });
        req.on('error', err => {
            if (!tooLarge) reject(err);
        });
    });
}

class BodyTooLargeError extends Error {
    constructor() {
        super(`Request body exceeds ${MAX_BODY_BYTES} byte limit`);
        this.code = 'BODY_TOO_LARGE';
    }
}

// ─── Server ───────────────────────────────────────────────────────────────────

class FigmaMcpBridgeServer {
    constructor(port = 3015, sessionToken = null) {
        this.port = port;
        this.server = null;
        this.sseClients = new Map(); // clientId -> response object
        this.mcpRequests = new Map(); // requestId -> { request, res, timestamp }
        this.pendingPluginRequests = new Map(); // requestId -> { id, mcpRequest, timestamp }
        this.figmaConnected = false;

        // [C2] Per-session bearer token. Caller can inject one for tests.
        this.sessionToken = sessionToken || generateSessionToken();

        console.log('Figma MCP Bridge Server initializing on port ' + port);
        console.log('');
        console.log('  SECURITY — localhost-only dev bridge');
        console.log('  Session token (share only with the Figma plugin):');
        console.log('');
        console.log('    ' + this.sessionToken);
        console.log('');
        console.log('  Set in Figma plugin UI or pass via Authorization: Bearer <token>');
        console.log('  All requests except GET /health require this token.');
        console.log('');
    }

    start() {
        this.server = http.createServer((req, res) => {
            this.handleRequest(req, res);
        });

        // [C1] Bind to loopback only.
        this.server.listen(this.port, BIND_HOST, () => {
            console.log('MCP Bridge Server running on http://' + BIND_HOST + ':' + this.port);
            console.log('SSE endpoint:      http://' + BIND_HOST + ':' + this.port + '/mcp/sse');
            console.log('Request endpoint:  http://' + BIND_HOST + ':' + this.port + '/mcp/request');
            console.log('Waiting for Figma plugin connection...');
        });

        this.server.on('error', (error) => {
            console.error('Server error:', error);
        });
    }

    stop() {
        if (this.server) {
            this.server.close(() => {
                console.log('Bridge server stopped');
            });
        }
    }

    // ─── Auth middleware ────────────────────────────────────────────────────

    /**
     * Extract the bearer token from the Authorization header.
     */
    _extractBearer(req) {
        const header = req.headers['authorization'] || '';
        if (!header.startsWith('Bearer ')) return null;
        return header.slice('Bearer '.length).trim();
    }

    /**
     * Validate the bearer token. Returns true if valid. [C2]
     */
    _isAuthorized(req) {
        const provided = this._extractBearer(req);
        if (!provided) return false;
        return safeCompare(provided, this.sessionToken);
    }

    /**
     * Send 401 Unauthorized.
     */
    _unauthorized(res) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized — Bearer token required' }));
    }

    // ─── CORS ──────────────────────────────────────────────────────────────

    /**
     * Set CORS headers. Only reflects the origin if it is in the allowlist.
     * Non-browser callers (curl, MCP clients) omit Origin; they pass without CORS restriction. [C3]
     */
    _setCorsHeaders(req, res) {
        const origin = getOrigin(req);
        if (origin && isAllowedOrigin(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
        }
        // Do NOT set Access-Control-Allow-Origin for disallowed origins — browser will block them.
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    // ─── Request dispatcher ────────────────────────────────────────────────

    handleRequest(req, res) {
        this._setCorsHeaders(req, res);

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = new URL(req.url, 'http://' + BIND_HOST + ':' + this.port);

        // /health is exempt from auth — used by health-checkers / CI.
        if (url.pathname === '/health') {
            this.handleHealth(req, res);
            return;
        }

        // All other routes require the bearer token. [C2]
        if (!this._isAuthorized(req)) {
            this._unauthorized(res);
            return;
        }

        switch (url.pathname) {
            case '/mcp/sse':
                this.handleSSE(req, res);
                break;
            case '/mcp/request':
                this.handleMcpRequest(req, res);
                break;
            case '/plugin/connect':
                this.handlePluginConnect(req, res);
                break;
            case '/plugin/get-requests':
                this.handlePluginGetRequests(req, res);
                break;
            case '/plugin/send-response':
                this.handlePluginSendResponse(req, res);
                break;
            case '/status':
                this.handleStatus(req, res);
                break;
            default:
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not found' }));
        }
    }

    // ─── Handlers ──────────────────────────────────────────────────────────

    handleSSE(req, res) {
        const clientId = uuidv4();

        console.log('SSE client connecting: ' + clientId);

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });

        this.sendSSEMessage(res, 'connected', { clientId, timestamp: Date.now() });
        this.sseClients.set(clientId, res);

        req.on('close', () => {
            console.log('SSE client disconnected: ' + clientId);
            this.sseClients.delete(clientId);
        });

        req.on('error', (error) => {
            console.error('SSE client error: ' + clientId, error);
            this.sseClients.delete(clientId);
        });

        const heartbeat = setInterval(() => {
            if (this.sseClients.has(clientId)) {
                this.sendSSEMessage(res, 'heartbeat', { timestamp: Date.now() });
            } else {
                clearInterval(heartbeat);
            }
        }, 30000);

        setTimeout(() => {
            this.sendSSEMessage(res, 'server-info', {
                name: 'figma-mcp-server',
                version: '1.0.0',
                capabilities: {
                    tools: true,
                    resources: false,
                    prompts: false
                }
            });
        }, 100);
    }

    handleMcpRequest(req, res) {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        readBody(req)
            .then(buf => {
                let mcpRequest;
                try {
                    mcpRequest = JSON.parse(buf.toString('utf8'));
                } catch (_) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        jsonrpc: '2.0',
                        id: null,
                        error: { code: -32700, message: 'Parse error' }
                    }));
                    return;
                }

                // [M1] Validate JSON-RPC envelope before touching any field.
                const envelopeErr = validateMcpEnvelope(mcpRequest);
                if (envelopeErr) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        jsonrpc: '2.0',
                        id: null,
                        error: { code: -32600, message: 'Invalid Request: ' + envelopeErr }
                    }));
                    return;
                }

                this.processMcpRequest(mcpRequest, res);
            })
            .catch(err => {
                if (err && err.code === 'BODY_TOO_LARGE') {
                    res.writeHead(413, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                } else {
                    console.error('handleMcpRequest read error:', err);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Internal server error' }));
                }
            });
    }

    processMcpRequest(request, res) {
        const method = request.method;
        console.log('MCP Request: ' + method + ' (ID: ' + request.id + ')');

        try {
            if (method === 'initialize') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: { tools: {} },
                        serverInfo: { name: 'figma-mcp-bridge-server', version: '1.0.0' }
                    }
                }));
                return;
            }

            if (method === 'tools/list') {
                const tools = [
                    'get_document_info', 'get_pages', 'create_page', 'delete_page',
                    'get_nodes', 'create_frame', 'create_rectangle', 'create_ellipse',
                    'create_text', 'modify_node', 'delete_node', 'move_node',
                    'resize_node', 'set_node_properties', 'get_node_properties',
                    'duplicate_node', 'search_nodes'
                ];

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        tools: tools.map(name => ({
                            name,
                            description: 'Figma API operation: ' + name,
                            inputSchema: { type: 'object', properties: {}, additionalProperties: true }
                        }))
                    }
                }));
                return;
            }

            // Forward to plugin via pending queue.
            if (!this.figmaConnected) {
                throw new Error('Figma plugin not connected');
            }

            // [M3] Guard params.name before logging/using it.
            const toolName = (request.params && typeof request.params.name === 'string')
                ? request.params.name
                : '(unknown)';

            const requestId = uuidv4();
            this.mcpRequests.set(requestId, { request, res, timestamp: Date.now() });
            this.pendingPluginRequests.set(requestId, {
                id: requestId,
                mcpRequest: request,
                timestamp: Date.now()
            });

            console.log('Stored request ' + requestId + ' for plugin tool: ' + toolName);

        } catch (error) {
            console.error('MCP request error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                jsonrpc: '2.0',
                id: request.id,
                error: { code: -32603, message: error.message }
            }));
        }
    }

    handleStatus(req, res) {
        const status = {
            server: 'running',
            port: this.port,
            host: BIND_HOST,
            figmaConnected: this.figmaConnected,
            connectedClients: this.sseClients.size,
            pendingRequests: this.mcpRequests.size,
            uptime: process.uptime()
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status, null, 2));
    }

    handlePluginConnect(req, res) {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        // [H3] Token already validated by the dispatcher — no additional secret needed here.
        // Log the caller for audit.
        readBody(req)
            .then(buf => {
                let data = {};
                try {
                    data = buf.length ? JSON.parse(buf.toString('utf8')) : {};
                } catch (_) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON' }));
                    return;
                }

                this.figmaConnected = true;
                console.log('Plugin connected successfully!', { pluginInfo: data.pluginInfo || '(none)' });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'connected',
                    message: 'Plugin connected successfully',
                    timestamp: Date.now()
                }));
            })
            .catch(err => {
                if (err && err.code === 'BODY_TOO_LARGE') {
                    res.writeHead(413, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                } else {
                    console.error('Plugin connect read error:', err);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid connection data' }));
                }
            });
    }

    handlePluginGetRequests(req, res) {
        if (req.method !== 'GET') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        // [H1] The caller is already authenticated (same session token) — return all pending requests.
        // In a multi-session scenario each session would have its own pending queue; here there is
        // one plugin session per server instance so the token == the session gate.
        const requests = Array.from(this.pendingPluginRequests.values());

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ requests }));
    }

    handlePluginSendResponse(req, res) {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        readBody(req)
            .then(buf => {
                let body;
                try {
                    body = JSON.parse(buf.toString('utf8'));
                } catch (_) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON' }));
                    return;
                }

                // [M1] Validate expected fields.
                const { requestId, response } = body;
                if (typeof requestId !== 'string' || requestId.length === 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'requestId must be a non-empty string' }));
                    return;
                }
                if (response === undefined) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'response field is required' }));
                    return;
                }

                // [H2] Validate requestId ownership — must exist in pendingPluginRequests
                // (only the plugin's authenticated session can call this endpoint, and only
                //  for requests it received from get-requests).
                if (!this.pendingPluginRequests.has(requestId)) {
                    // Do NOT reveal whether the id ever existed — 404 regardless.
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Request not found' }));
                    return;
                }

                const pendingRequest = this.mcpRequests.get(requestId);
                if (!pendingRequest) {
                    // mcpRequests and pendingPluginRequests should be in sync;
                    // this path means the MCP client already disconnected.
                    this.pendingPluginRequests.delete(requestId);
                    res.writeHead(410, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'MCP client for this request is no longer connected' }));
                    return;
                }

                // [M3] Guard params.name before logging.
                const toolName = (pendingRequest.request.params && typeof pendingRequest.request.params.name === 'string')
                    ? pendingRequest.request.params.name
                    : '(unknown)';

                const mcpResponse = {
                    jsonrpc: '2.0',
                    id: pendingRequest.request.id,
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
                    }
                };

                pendingRequest.res.writeHead(200, { 'Content-Type': 'application/json' });
                pendingRequest.res.end(JSON.stringify(mcpResponse));

                // Clean up both maps atomically.
                this.mcpRequests.delete(requestId);
                this.pendingPluginRequests.delete(requestId);

                console.log('Real response sent for request ' + requestId + ' (' + toolName + ')');

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success' }));
            })
            .catch(err => {
                if (err && err.code === 'BODY_TOO_LARGE') {
                    res.writeHead(413, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                } else {
                    console.error('Plugin response error:', err);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid response data' }));
                }
            });
    }

    handleHealth(req, res) {
        // Health is intentionally auth-exempt so CI/health-checkers work without a token.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', timestamp: Date.now() }));
    }

    sendSSEMessage(res, event, data) {
        try {
            res.write('event: ' + event + '\n');
            res.write('data: ' + JSON.stringify(data) + '\n\n');
        } catch (error) {
            console.error('Error sending SSE message:', error);
        }
    }

    broadcastToSSEClients(event, data) {
        this.sseClients.forEach((res, clientId) => {
            this.sendSSEMessage(res, event, { ...data, clientId });
        });
    }
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (require.main === module) {
    const port = parseInt(process.argv[2]) || 3001;
    const server = new FigmaMcpBridgeServer(port);

    process.on('SIGINT', () => {
        console.log('\nShutting down bridge server...');
        server.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\nShutting down bridge server...');
        server.stop();
        process.exit(0);
    });

    server.start();
}

module.exports = { FigmaMcpBridgeServer, generateSessionToken, safeCompare, validateMcpEnvelope, isAllowedOrigin };
