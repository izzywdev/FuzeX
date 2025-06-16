const http = require('http');

async function searchForElements() {
    console.log('🔍 Searching for Design Elements');
    console.log('=================================\n');

    const searchTerms = [
        'blog', 'Blog', 'BLOG',
        'profile', 'Profile', 'PROFILE', 
        'button', 'Button', 'btn',
        'header', 'Header', 'nav', 'navigation',
        'footer', 'Footer',
        'card', 'Card',
        'menu', 'Menu',
        'sidebar', 'Sidebar',
        'content', 'Content',
        'main', 'Main',
        'section', 'Section'
    ];

    console.log('🎯 Searching for common design elements...\n');

    for (const term of searchTerms) {
        try {
            console.log(`🔍 Searching for: "${term}"`);
            const results = await makeToolCall('search_nodes', { 
                query: term,
                searchType: 'name' 
            });
            
            if (results && Array.isArray(results) && results.length > 0) {
                console.log(`   ✅ Found ${results.length} matches:`);
                results.slice(0, 5).forEach((result, i) => {
                    console.log(`      ${i+1}. "${result.name}" (${result.type}) - ID: ${result.id}`);
                });
                if (results.length > 5) {
                    console.log(`      ... and ${results.length - 5} more`);
                }
            } else {
                console.log(`   ❌ No matches found`);
            }
            console.log('');
        } catch (error) {
            console.log(`   ❌ Search error: ${error.message}\n`);
        }
    }

    // Also try to get document structure differently
    console.log('📄 Trying alternative document analysis...\n');
    
    try {
        const docInfo = await makeToolCall('get_document_info');
        console.log('Document Info:', JSON.stringify(docInfo, null, 2));
        
        // Try to get pages with more detail
        const pages = await makeToolCall('get_pages');
        console.log('\nPages Detail:', JSON.stringify(pages, null, 2));
        
        // Try to get nodes for each page with different approach
        for (const page of pages) {
            console.log(`\n🔍 Trying to get nodes for page: ${page.name} (ID: ${page.id})`);
            try {
                const nodes = await makeToolCall('get_nodes', { nodeId: page.id });
                console.log('Nodes result:', JSON.stringify(nodes, null, 2));
            } catch (error) {
                console.log(`Error getting nodes: ${error.message}`);
            }
        }
        
    } catch (error) {
        console.log(`Document analysis error: ${error.message}`);
    }
}

async function makeToolCall(toolName, args = {}) {
    const mcpRequest = {
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 1000),
        method: 'tools/call',
        params: { name: toolName, arguments: args }
    };

    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3015,
            path: '/mcp/request',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        };

        const req = http.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(responseData);
                    if (response.result && response.result.content && response.result.content[0]) {
                        const data = JSON.parse(response.result.content[0].text);
                        resolve(data);
                    } else {
                        reject(new Error('Invalid response format'));
                    }
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', reject);
        req.write(JSON.stringify(mcpRequest));
        req.end();
    });
}

searchForElements().catch(console.error); 