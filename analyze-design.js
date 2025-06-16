const http = require('http');

async function makeRequest(toolName, args = {}) {
    const request = {
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 1000),
        method: 'tools/call',
        params: {
            name: toolName,
            arguments: args
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
                    if (response.error) {
                        reject(new Error(response.error.message));
                    } else {
                        const result = JSON.parse(response.result.content[0].text);
                        resolve(result);
                    }
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

async function analyzeDesign() {
    console.log('🎨 Analyzing your website design for componentization...\n');
    
    try {
        // Get basic document info
        console.log('📋 Document Overview:');
        const docInfo = await makeRequest('get_document_info');
        console.log(`   Document: ${docInfo.name}`);
        console.log(`   Type: ${docInfo.type}`);
        console.log(`   Total Pages: ${docInfo.children}\n`);

        // Get all pages
        const pages = await makeRequest('get_pages');
        console.log('📄 Pages in document:');
        pages.forEach((page, index) => {
            console.log(`   ${index + 1}. ${page.name} (${page.children} elements)`);
        });
        console.log('');

        // Analyze current page nodes (frames, etc.)
        console.log('🖼️  Current Page Structure:');
        const nodes = await makeRequest('get_nodes');
        
        const frames = nodes.filter(node => node.type === 'FRAME');
        const components = nodes.filter(node => node.type === 'COMPONENT');
        const groups = nodes.filter(node => node.type === 'GROUP');
        
        console.log(`   📦 Frames: ${frames.length}`);
        console.log(`   🧩 Components: ${components.length}`);
        console.log(`   📁 Groups: ${groups.length}`);
        console.log(`   📊 Total Elements: ${nodes.length}\n`);

        // Detailed frame analysis
        if (frames.length > 0) {
            console.log('🎯 Frame Analysis (Website Sections):');
            frames.forEach((frame, index) => {
                console.log(`\n   Frame ${index + 1}: "${frame.name}"`);
                console.log(`   ├─ Size: ${frame.width}×${frame.height}px`);
                console.log(`   ├─ Position: (${frame.x}, ${frame.y})`);
                console.log(`   ├─ Children: ${frame.children} elements`);
                console.log(`   └─ ID: ${frame.id}`);
            });
        }

        // Check for existing components
        if (components.length > 0) {
            console.log('\n✨ Existing Components Found:');
            components.forEach((comp, index) => {
                console.log(`   ${index + 1}. ${comp.name} (${comp.width}×${comp.height}px)`);
            });
        } else {
            console.log('\n💡 No existing components found - perfect for componentization!');
        }

        // Design System Recommendations
        console.log('\n🎨 Design System Componentization Plan:');
        console.log('');
        console.log('📋 Recommended Component Hierarchy:');
        console.log('   🔹 ATOMS (Basic Elements):');
        console.log('     • Buttons, Text styles, Icons, Input fields');
        console.log('     • Colors, Typography, Spacing tokens');
        console.log('');
        console.log('   🔹 MOLECULES (Simple Components):');
        console.log('     • Cards, Form groups, Navigation items');
        console.log('     • Search bars, Breadcrumbs, Tags');
        console.log('');
        console.log('   🔹 ORGANISMS (Complex Components):');
        console.log('     • Headers, Footers, Sidebars');
        console.log('     • Hero sections, Feature grids');
        console.log('');
        console.log('   🔹 TEMPLATES (Page Layouts):');
        console.log('     • Landing page, Product page, Blog post');
        console.log('     • Dashboard, Settings, Profile pages');

        console.log('\n🚀 Next Steps:');
        console.log('   1. Identify repeated UI patterns in your frames');
        console.log('   2. Extract common design tokens (colors, fonts, spacing)');
        console.log('   3. Create components starting with atoms');
        console.log('   4. Build up to molecules and organisms');
        console.log('   5. Organize components in a design system library');

        return { docInfo, pages, nodes, frames, components };

    } catch (error) {
        console.error('❌ Error analyzing design:', error.message);
        console.log('\n💡 Make sure:');
        console.log('   1. Figma plugin is running and connected');
        console.log('   2. You have a document open with your website design');
        console.log('   3. Bridge server is running on port 3015');
    }
}

// Run the analysis
analyzeDesign(); 