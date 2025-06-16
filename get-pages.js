const http = require('http');

async function getPages() {
    const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
            name: 'get_pages'
        }
    };

    return new Promise((resolve, reject) => {
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

async function main() {
    console.log('📄 Getting pages from your Figma file...\n');
    
    try {
        const response = await getPages();
        
        if (response.error) {
            console.error('❌ Error:', response.error.message);
            return;
        }

        const pages = JSON.parse(response.result.content[0].text);
        
        console.log('✅ Found pages in your Figma file:\n');
        
        if (pages.length === 0) {
            console.log('   No pages found.');
        } else {
            pages.forEach((page, index) => {
                console.log(`   ${index + 1}. ${page.name}`);
                console.log(`      - ID: ${page.id}`);
                console.log(`      - Type: ${page.type}`);
                console.log(`      - Children: ${page.children} elements`);
                console.log('');
            });
        }
        
        console.log(`📊 Total: ${pages.length} page(s) in the document`);
        
    } catch (error) {
        console.error('❌ Failed to get pages:', error.message);
        console.log('\n💡 Make sure:');
        console.log('   1. Bridge server is running (node bridge-server.js 3015)');
        console.log('   2. Figma plugin is active and started');
        console.log('   3. You have a Figma document open');
    }
}

main(); 