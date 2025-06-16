const http = require('http');

async function quickElementCheck() {
    console.log('🔍 Quick Element Check - Real Figma Data');
    console.log('=========================================\n');

    try {
        // Wait a moment for server to start
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('1. Testing server connection...');
        const status = await makeRequest('GET', '/status');
        console.log(`   ✅ Server running, Plugin connected: ${status.figmaConnected}\n`);

        console.log('2. Getting document info...');
        const docInfo = await makeToolCall('get_document_info');
        console.log(`   📄 Document: "${docInfo.name}" (ID: ${docInfo.id})`);
        
        // Check if this is real data
        if (docInfo.name === 'Example Document') {
            console.log('   ⚠️  Still getting simulated data - plugin may not be connected properly');
        } else {
            console.log('   🎉 Getting REAL Figma data!');
        }

        console.log('\n3. Getting pages...');
        const pages = await makeToolCall('get_pages');
        console.log(`   📑 Found ${pages.length} pages:`);
        pages.forEach((page, i) => {
            console.log(`      ${i+1}. "${page.name}" (${page.children || 0} children)`);
        });

        // If we have real data, let's dive deeper
        if (pages.length > 0 && pages[0].name !== 'Page 1') {
            console.log('\n4. Analyzing first page elements...');
            const firstPage = pages[0];
            
            try {
                const nodes = await makeToolCall('get_nodes', { nodeId: firstPage.id });
                if (nodes && nodes.children) {
                    console.log(`   🔍 Found ${nodes.children.length} top-level elements:`);
                    nodes.children.forEach((child, i) => {
                        console.log(`      ${i+1}. "${child.name}" (${child.type})`);
                    });

                    // Look for your specific elements
                    const blogElement = nodes.children.find(child => 
                        child.name.toLowerCase().includes('blog'));
                    const profileElement = nodes.children.find(child => 
                        child.name.toLowerCase().includes('profile'));

                    if (blogElement || profileElement) {
                        console.log('\n   🎯 Found your website elements:');
                        if (blogElement) console.log(`      • Blog: "${blogElement.name}"`);
                        if (profileElement) console.log(`      • Profile: "${profileElement.name}"`);
                    }
                }
            } catch (error) {
                console.log(`   ❌ Error getting nodes: ${error.message}`);
            }
        }

        console.log('\n5. Testing search functionality...');
        try {
            const searchResults = await makeToolCall('search_nodes', { 
                query: 'button',
                searchType: 'name' 
            });
            console.log(`   🔍 Found ${searchResults.length} elements with 'button' in name`);
            searchResults.slice(0, 5).forEach((result, i) => {
                console.log(`      ${i+1}. "${result.name}" (${result.type})`);
            });
        } catch (error) {
            console.log(`   ❌ Search failed: ${error.message}`);
        }

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.log('\n💡 Troubleshooting:');
        console.log('   1. Make sure Figma plugin is running and connected');
        console.log('   2. Check that you have a Figma file open');
        console.log('   3. Verify the bridge server is running on port 3015');
    }
}

function makeRequest(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3015,
            path: path,
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };
        
        const req = http.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(responseData));
                } catch (error) {
                    resolve(responseData);
                }
            });
        });
        
        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

async function makeToolCall(toolName, args = {}) {
    const mcpRequest = {
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 1000),
        method: 'tools/call',
        params: { name: toolName, arguments: args }
    };

    const response = await makeRequest('POST', '/mcp/request', mcpRequest);
    
    if (response.result && response.result.content && response.result.content[0]) {
        return JSON.parse(response.result.content[0].text);
    } else {
        throw new Error('Invalid response format');
    }
}

quickElementCheck().catch(console.error); 