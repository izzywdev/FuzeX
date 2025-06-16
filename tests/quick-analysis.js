const http = require('http');

async function makeRequest(toolName, args = {}) {
    const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: toolName, arguments: args }
    };

    return new Promise((resolve, reject) => {
        const data = JSON.stringify(request);
        const options = {
            hostname: 'localhost', port: 3015, path: '/mcp/request', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    if (response.error) {
                        reject(new Error(response.error.message));
                    } else {
                        resolve(JSON.parse(response.result.content[0].text));
                    }
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

(async () => {
    try {
        console.log('Getting document info...');
        const doc = await makeRequest('get_document_info');
        console.log(`Document: ${doc.name}`);
        
        console.log('\nGetting current page nodes...');
        const nodes = await makeRequest('get_nodes');
        console.log(`Total elements: ${nodes.length}`);
        
        const frames = nodes.filter(n => n.type === 'FRAME');
        console.log(`Frames: ${frames.length}`);
        
        frames.forEach((frame, i) => {
            console.log(`${i+1}. ${frame.name} (${frame.width}x${frame.height})`);
        });
        
    } catch (error) {
        console.error('Error:', error.message);
    }
})(); 