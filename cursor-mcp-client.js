#!/usr/bin/env node

/**
 * Cursor IDE MCP Client for Figma
 * This client allows Cursor IDE to communicate with the Figma MCP server
 */

const { spawn } = require('child_process');
const readline = require('readline');

class CursorFigmaMcpClient {
    constructor() {
        this.serverProcess = null;
        this.requestId = 1;
        this.isConnected = false;
    }

    async start() {
        console.log('🚀 Starting Figma MCP Server for Cursor IDE...');
        
        // Start the bridge server
        this.serverProcess = spawn('node', ['bridge-server.js', '3015'], {
            cwd: process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.serverProcess.stdout.on('data', (data) => {
            console.log(`[SERVER] ${data.toString().trim()}`);
        });

        this.serverProcess.stderr.on('data', (data) => {
            console.error(`[SERVER ERROR] ${data.toString().trim()}`);
        });

        this.serverProcess.on('close', (code) => {
            console.log(`[SERVER] Process exited with code ${code}`);
            this.isConnected = false;
        });

        // Wait for server to start
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Initialize MCP connection
        await this.initialize();
        
        console.log('✅ Figma MCP Server ready for Cursor IDE');
        console.log('📡 Server endpoint: http://localhost:3015');
        console.log('🔗 SSE endpoint: http://localhost:3015/mcp/sse');
    }

    async initialize() {
        try {
            const response = await this.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {
                    tools: {}
                },
                clientInfo: {
                    name: 'cursor-ide-client',
                    version: '1.0.0'
                }
            });

            if (response.error) {
                throw new Error(`Initialization failed: ${response.error.message}`);
            }

            this.isConnected = true;
            console.log('🔌 MCP connection established');
            console.log('Server info:', response.result.serverInfo);
        } catch (error) {
            console.error('❌ Failed to initialize MCP connection:', error.message);
        }
    }

    async sendRequest(method, params = {}) {
        const request = {
            jsonrpc: '2.0',
            id: this.requestId++,
            method: method,
            params: params
        };

        return new Promise((resolve, reject) => {
            const http = require('http');
            const data = JSON.stringify(request);
            
            const options = {
                hostname: 'localhost',
                port: 3015,
                path: '/mcp/request',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            };

            const req = http.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => {
                    body += chunk;
                });
                res.on('end', () => {
                    try {
                        const response = JSON.parse(body);
                        resolve(response);
                    } catch (error) {
                        reject(new Error(`Invalid JSON response: ${body}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(data);
            req.end();
        });
    }

    async callTool(toolName, args = {}) {
        if (!this.isConnected) {
            throw new Error('MCP server not connected');
        }

        return this.sendRequest('tools/call', {
            name: toolName,
            arguments: args
        });
    }

    async listTools() {
        if (!this.isConnected) {
            throw new Error('MCP server not connected');
        }

        return this.sendRequest('tools/list');
    }

    async stop() {
        if (this.serverProcess) {
            console.log('🛑 Stopping Figma MCP Server...');
            this.serverProcess.kill();
            this.serverProcess = null;
            this.isConnected = false;
        }
    }
}

// Handle stdio for MCP protocol
class McpStdioHandler {
    constructor() {
        this.client = new CursorFigmaMcpClient();
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async start() {
        await this.client.start();
        this.handleStdio();
    }

    handleStdio() {
        // Handle MCP protocol over stdio
        process.stdin.on('data', async (data) => {
            try {
                const request = JSON.parse(data.toString());
                let response;

                switch (request.method) {
                    case 'initialize':
                        response = {
                            jsonrpc: '2.0',
                            id: request.id,
                            result: {
                                protocolVersion: '2024-11-05',
                                capabilities: {
                                    tools: {}
                                },
                                serverInfo: {
                                    name: 'figma-mcp-cursor-client',
                                    version: '1.0.0'
                                }
                            }
                        };
                        break;

                    case 'tools/list':
                        const toolsResponse = await this.client.listTools();
                        response = toolsResponse;
                        break;

                    case 'tools/call':
                        const toolResponse = await this.client.callTool(
                            request.params.name,
                            request.params.arguments
                        );
                        response = toolResponse;
                        break;

                    default:
                        response = {
                            jsonrpc: '2.0',
                            id: request.id,
                            error: {
                                code: -32601,
                                message: `Method not found: ${request.method}`
                            }
                        };
                }

                process.stdout.write(JSON.stringify(response) + '\n');
            } catch (error) {
                const errorResponse = {
                    jsonrpc: '2.0',
                    id: null,
                    error: {
                        code: -32700,
                        message: 'Parse error'
                    }
                };
                process.stdout.write(JSON.stringify(errorResponse) + '\n');
            }
        });
    }

    async stop() {
        await this.client.stop();
        this.rl.close();
    }
}

// If running as standalone
if (require.main === module) {
    const handler = new McpStdioHandler();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down...');
        await handler.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\n🛑 Shutting down...');
        await handler.stop();
        process.exit(0);
    });

    handler.start().catch(console.error);
}

module.exports = { CursorFigmaMcpClient, McpStdioHandler }; 