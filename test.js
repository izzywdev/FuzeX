#!/usr/bin/env node

/**
 * Simple test script to verify the Figma MCP Bridge Server
 */

const http = require('http');

console.log('🧪 Testing Figma MCP Bridge Server...\n');

// Test health endpoint
function testHealth() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3015,
            path: '/health',
            method: 'GET'
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    console.log('✅ Health check passed:', data);
                    resolve(data);
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            console.log('❌ Health check failed:', error.message);
            reject(error);
        });

        req.end();
    });
}

// Test MCP initialize
function testMcpInitialize() {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: {
                    name: 'test-script',
                    version: '1.0.0'
                }
            }
        });

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
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    console.log('✅ MCP Initialize:', response.result.serverInfo);
                    resolve(response);
                } catch (error) {
                    reject(error);
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

// Test tools list
function testToolsList() {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list'
        });

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
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    console.log(`✅ Found ${response.result.tools.length} tools available`);
                    response.result.tools.forEach(tool => {
                        console.log(`   - ${tool.name}`);
                    });
                    resolve(response);
                } catch (error) {
                    reject(error);
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

// Run tests
async function runTests() {
    try {
        console.log('1. Testing health endpoint...');
        await testHealth();
        
        console.log('\n2. Testing MCP initialize...');
        await testMcpInitialize();
        
        console.log('\n3. Testing tools list...');
        await testToolsList();
        
        console.log('\n🎉 All tests passed! The bridge server is working correctly.');
        console.log('\n💡 Next steps:');
        console.log('   1. Install the Figma plugin using manifest.json');
        console.log('   2. Open the plugin in Figma and start the server');
        console.log('   3. Use the test client: node examples/test-client.js');
        console.log('   4. Open examples/sse-client.html in a browser');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.log('\n💡 Make sure the bridge server is running:');
        console.log('   npm start');
        process.exit(1);
    }
}

runTests(); 
