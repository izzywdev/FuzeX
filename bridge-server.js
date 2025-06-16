#!/usr/bin/env node

/**
 * Figma MCP Bridge Server
 * This Node.js server acts as a bridge between external MCP clients and the Figma plugin
 * It provides HTTP/SSE endpoints for MCP communication
 */

const http = require('http');
const { v4: uuidv4 } = require('uuid');

class FigmaMcpBridgeServer {
    constructor(port = 3015) {
        this.port = port;
        this.server = null;
        this.sseClients = new Map(); // clientId -> response object
        this.mcpRequests = new Map(); // requestId -> pending request
        this.figmaConnected = false;
        
        console.log(`🚀 Figma MCP Bridge Server initializing on port ${port}`);
    }

    start() {
        this.server = http.createServer((req, res) => {
            this.handleRequest(req, res);
        });

        this.server.listen(this.port, () => {
            console.log(`📡 MCP Bridge Server running on http://localhost:${this.port}`);
            console.log(`🔗 SSE endpoint: http://localhost:${this.port}/mcp/sse`);
            console.log(`📨 Request endpoint: http://localhost:${this.port}/mcp/request`);
            console.log('🔌 Waiting for Figma plugin connection...');
        });

        this.server.on('error', (error) => {
            console.error('❌ Server error:', error);
        });
    }

    stop() {
        if (this.server) {
            this.server.close(() => {
                console.log('🛑 Bridge server stopped');
            });
        }
    }

    handleRequest(req, res) {
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        const url = new URL(req.url, `http://localhost:${this.port}`);
        
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
            case '/health':
                this.handleHealth(req, res);
                break;
            default:
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not found' }));
        }
    }

    handleSSE(req, res) {
        // Server-Sent Events endpoint for MCP clients
        const clientId = uuidv4();
        
        console.log(`🔌 SSE client connecting: ${clientId}`);

        // Set SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        // Send initial connection event
        this.sendSSEMessage(res, 'connected', { clientId, timestamp: Date.now() });

        // Store client connection
        this.sseClients.set(clientId, res);

        // Handle client disconnect
        req.on('close', () => {
            console.log(`🔌 SSE client disconnected: ${clientId}`);
            this.sseClients.delete(clientId);
        });

        req.on('error', (error) => {
            console.error(`❌ SSE client error: ${clientId}`, error);
            this.sseClients.delete(clientId);
        });

        // Send periodic heartbeat
        const heartbeat = setInterval(() => {
            if (this.sseClients.has(clientId)) {
                this.sendSSEMessage(res, 'heartbeat', { timestamp: Date.now() });
            } else {
                clearInterval(heartbeat);
            }
        }, 30000);

        // Send MCP server info
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

        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const mcpRequest = JSON.parse(body);
                this.processMcpRequest(mcpRequest, res);
            } catch (error) {
                console.error('❌ Invalid JSON in MCP request:', error);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: null,
                    error: {
                        code: -32700,
                        message: 'Parse error'
                    }
                }));
            }
        });
    }

    async processMcpRequest(request, res) {
        console.log(`📨 MCP Request: ${request.method} (ID: ${request.id})`);

        try {
            // Handle MCP protocol methods
            if (request.method === 'initialize') {
                const response = {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: {}
                        },
                        serverInfo: {
                            name: 'figma-mcp-bridge-server',
                            version: '1.0.0'
                        }
                    }
                };

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(response));
                return;
            }

            if (request.method === 'tools/list') {
                const tools = [
                    'get_document_info', 'get_pages', 'create_page', 'delete_page',
                    'get_nodes', 'create_frame', 'create_rectangle', 'create_ellipse',
                    'create_text', 'modify_node', 'delete_node', 'move_node',
                    'resize_node', 'set_node_properties', 'get_node_properties',
                    'duplicate_node', 'search_nodes'
                ];

                const response = {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        tools: tools.map(name => ({
                            name,
                            description: `Figma API operation: ${name}`,
                            inputSchema: {
                                type: 'object',
                                properties: {},
                                additionalProperties: true
                            }
                        }))
                    }
                };

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(response));
                return;
            }

            // For tool calls and other operations, we need to communicate with Figma plugin
            if (!this.figmaConnected) {
                throw new Error('Figma plugin not connected');
            }

            // Store pending request and forward to Figma plugin
            const requestId = uuidv4();
            this.mcpRequests.set(requestId, { request, res, timestamp: Date.now() });

            // Store the request for the plugin to pick up
            this.pendingPluginRequests = this.pendingPluginRequests || new Map();
            this.pendingPluginRequests.set(requestId, {
                id: requestId,
                mcpRequest: request,
                timestamp: Date.now()
            });

            console.log(`📨 Stored request ${requestId} for plugin: ${request.params.name}`);

        } catch (error) {
            console.error('❌ MCP request error:', error);
            const errorResponse = {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -32603,
                    message: error.message
                }
            };

            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(errorResponse));
        }
    }

    // Simulation methods removed - now using real Figma plugin communication

    handleStatus(req, res) {
        const status = {
            server: 'running',
            port: this.port,
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

        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                this.figmaConnected = true;
                this.pendingPluginRequests = this.pendingPluginRequests || new Map();
                console.log('🔌 Plugin connected successfully!', data);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    status: 'connected', 
                    message: 'Plugin connected successfully',
                    timestamp: Date.now() 
                }));
            } catch (error) {
                console.error('❌ Plugin connection error:', error);
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

        this.pendingPluginRequests = this.pendingPluginRequests || new Map();
        
        // Return all pending requests
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

        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const { requestId, response } = JSON.parse(body);
                
                // Find the original MCP request
                const pendingRequest = this.mcpRequests.get(requestId);
                if (!pendingRequest) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Request not found' }));
                    return;
                }

                // Send response back to MCP client
                const mcpResponse = {
                    jsonrpc: '2.0',
                    id: pendingRequest.request.id,
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(response, null, 2)
                            }
                        ]
                    }
                };

                pendingRequest.res.writeHead(200, { 'Content-Type': 'application/json' });
                pendingRequest.res.end(JSON.stringify(mcpResponse));

                // Clean up
                this.mcpRequests.delete(requestId);
                this.pendingPluginRequests.delete(requestId);

                console.log(`✅ Real response sent for ${pendingRequest.request.params.name}`);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success' }));
                
            } catch (error) {
                console.error('❌ Plugin response error:', error);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid response data' }));
            }
        });
    }

    handleHealth(req, res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', timestamp: Date.now() }));
    }

    sendSSEMessage(res, event, data) {
        try {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
            console.error('❌ Error sending SSE message:', error);
        }
    }

    broadcastToSSEClients(event, data) {
        this.sseClients.forEach((res, clientId) => {
            this.sendSSEMessage(res, event, { ...data, clientId });
        });
    }
}

// CLI interface
if (require.main === module) {
    const port = parseInt(process.argv[2]) || 3001;
    const server = new FigmaMcpBridgeServer(port);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down bridge server...');
        server.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n🛑 Shutting down bridge server...');
        server.stop();
        process.exit(0);
    });

    server.start();
}

module.exports = FigmaMcpBridgeServer; 