const http = require('http');

async function enumeratePageContent() {
    console.log('🔍 Enumerating Real Page Content');
    console.log('=================================\n');

    try {
        console.log('1. Getting pages...');
        const pages = await makeToolCall('get_pages');
        console.log(`   📑 Found ${pages.length} pages:`);
        pages.forEach((page, i) => {
            console.log(`      ${i+1}. "${page.name}" (ID: ${page.id}, Children: ${page.children || 0})`);
        });

        // Enumerate content of each page
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            console.log(`\n${'='.repeat(60)}`);
            console.log(`📄 ANALYZING PAGE: "${page.name}"`);
            console.log(`${'='.repeat(60)}`);
            
            await enumeratePageElements(page, 0);
        }

        console.log('\n🎯 SUMMARY OF DESIGN ELEMENTS FOUND:');
        console.log('=====================================');

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

async function enumeratePageElements(page, depth = 0) {
    const indent = '  '.repeat(depth);
    
    try {
        console.log(`${indent}🔍 Getting nodes for: ${page.name}`);
        const nodes = await makeToolCall('get_nodes', { nodeId: page.id });
        
        if (nodes && nodes.children && nodes.children.length > 0) {
            console.log(`${indent}   Found ${nodes.children.length} direct children:`);
            
            for (let i = 0; i < nodes.children.length; i++) {
                const child = nodes.children[i];
                await analyzeElement(child, depth + 1, i + 1);
            }
        } else {
            console.log(`${indent}   No children found or empty page`);
        }
    } catch (error) {
        console.log(`${indent}   ❌ Error getting nodes: ${error.message}`);
    }
}

async function analyzeElement(element, depth, index) {
    const indent = '  '.repeat(depth);
    
    console.log(`${indent}${index}. 📦 "${element.name}" (${element.type})`);
    console.log(`${indent}   ID: ${element.id}`);
    
    // Try to get more detailed properties
    try {
        const properties = await makeToolCall('get_node_properties', { nodeId: element.id });
        if (properties) {
            // Show key properties
            if (properties.width && properties.height) {
                console.log(`${indent}   Size: ${Math.round(properties.width)}×${Math.round(properties.height)}px`);
            }
            if (properties.x !== undefined && properties.y !== undefined) {
                console.log(`${indent}   Position: (${Math.round(properties.x)}, ${Math.round(properties.y)})`);
            }
            if (properties.fills && properties.fills.length > 0) {
                const fill = properties.fills[0];
                if (fill.type === 'SOLID' && fill.color) {
                    const color = rgbToHex(fill.color);
                    console.log(`${indent}   Color: ${color}`);
                }
            }
            if (properties.fontName && properties.fontSize) {
                console.log(`${indent}   Font: ${properties.fontName.family} ${properties.fontSize}px`);
            }
            if (properties.characters) {
                const text = properties.characters.substring(0, 50);
                console.log(`${indent}   Text: "${text}${properties.characters.length > 50 ? '...' : ''}"`);
            }
        }
    } catch (error) {
        // Properties might not be available for all elements
    }

    // If this element has children, analyze them too (but limit depth to avoid overwhelming output)
    if (element.children && element.children.length > 0 && depth < 4) {
        console.log(`${indent}   └─ ${element.children.length} children:`);
        
        for (let i = 0; i < Math.min(element.children.length, 10); i++) { // Limit to first 10 children
            const child = element.children[i];
            await analyzeElement(child, depth + 1, i + 1);
        }
        
        if (element.children.length > 10) {
            console.log(`${indent}      ... and ${element.children.length - 10} more children`);
        }
    }
}

function rgbToHex(rgb) {
    const toHex = (c) => {
        const hex = Math.round(c * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
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

enumeratePageContent().catch(console.error); 