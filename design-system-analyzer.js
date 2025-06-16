const http = require('http');

class DesignSystemAnalyzer {
    constructor() {
        this.components = new Map();
        this.colors = new Set();
        this.typography = new Map();
        this.spacing = new Set();
        this.layouts = [];
        this.interactions = [];
    }

    async analyzeDesign() {
        console.log('🎨 Design System Analysis Starting...');
        console.log('=====================================\n');

        try {
            // Step 1: Get document info
            const docInfo = await this.makeToolCall('get_document_info');
            console.log('📄 Document Info:');
            console.log(`   Name: ${docInfo.name}`);
            console.log(`   ID: ${docInfo.id}`);
            console.log(`   Type: ${docInfo.type}\n`);

            // Step 2: Get all pages
            const pages = await this.makeToolCall('get_pages');
            console.log('📑 Pages Found:');
            pages.forEach((page, index) => {
                console.log(`   ${index + 1}. ${page.name} (${page.children} children)`);
            });
            console.log('');

            // Step 3: Analyze each page
            for (const page of pages) {
                await this.analyzePage(page);
            }

            // Step 4: Generate design system recommendations
            this.generateDesignSystem();

        } catch (error) {
            console.error('❌ Analysis failed:', error.message);
        }
    }

    async analyzePage(page) {
        console.log(`🔍 Analyzing Page: ${page.name}`);
        console.log('─'.repeat(50));

        try {
            // Get all nodes on this page
            const nodes = await this.makeToolCall('get_nodes', { nodeId: page.id });
            
            if (nodes && nodes.children) {
                console.log(`   Found ${nodes.children.length} top-level elements:`);
                
                for (const child of nodes.children) {
                    await this.analyzeNode(child, 1);
                }
            }
            console.log('');
        } catch (error) {
            console.log(`   ❌ Error analyzing page: ${error.message}\n`);
        }
    }

    async analyzeNode(node, depth = 0) {
        const indent = '  '.repeat(depth);
        const nodeInfo = `${indent}📦 ${node.name} (${node.type})`;
        
        console.log(nodeInfo);

        // Analyze node properties for design system
        await this.extractDesignTokens(node, depth);

        // Categorize potential components
        this.categorizeComponent(node, depth);

        // Recursively analyze children
        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                await this.analyzeNode(child, depth + 1);
            }
        }
    }

    async extractDesignTokens(node, depth) {
        try {
            // Get detailed node properties
            const properties = await this.makeToolCall('get_node_properties', { nodeId: node.id });
            
            if (properties) {
                // Extract colors
                if (properties.fills) {
                    properties.fills.forEach(fill => {
                        if (fill.type === 'SOLID' && fill.color) {
                            const color = this.rgbToHex(fill.color);
                            this.colors.add(color);
                        }
                    });
                }

                // Extract typography
                if (properties.fontName && properties.fontSize) {
                    const typoKey = `${properties.fontName.family}-${properties.fontSize}`;
                    this.typography.set(typoKey, {
                        family: properties.fontName.family,
                        size: properties.fontSize,
                        weight: properties.fontName.style,
                        lineHeight: properties.lineHeight
                    });
                }

                // Extract spacing/sizing
                if (properties.width && properties.height) {
                    this.spacing.add(properties.width);
                    this.spacing.add(properties.height);
                }

                // Extract layout info
                if (properties.layoutMode) {
                    this.layouts.push({
                        name: node.name,
                        type: node.type,
                        layoutMode: properties.layoutMode,
                        padding: properties.padding,
                        spacing: properties.itemSpacing
                    });
                }
            }
        } catch (error) {
            // Silently continue if properties can't be fetched
        }
    }

    categorizeComponent(node, depth) {
        const name = node.name.toLowerCase();
        const type = node.type;

        // Identify potential components based on naming and structure
        let componentType = 'unknown';

        if (name.includes('button') || type === 'INSTANCE' && name.includes('btn')) {
            componentType = 'button';
        } else if (name.includes('card') || name.includes('item')) {
            componentType = 'card';
        } else if (name.includes('header') || name.includes('nav')) {
            componentType = 'navigation';
        } else if (name.includes('footer')) {
            componentType = 'footer';
        } else if (name.includes('form') || name.includes('input')) {
            componentType = 'form';
        } else if (name.includes('modal') || name.includes('popup')) {
            componentType = 'modal';
        } else if (name.includes('sidebar') || name.includes('menu')) {
            componentType = 'sidebar';
        } else if (type === 'TEXT') {
            componentType = 'typography';
        } else if (type === 'FRAME' && depth <= 2) {
            componentType = 'layout';
        }

        if (!this.components.has(componentType)) {
            this.components.set(componentType, []);
        }

        this.components.get(componentType).push({
            name: node.name,
            type: node.type,
            id: node.id,
            depth: depth
        });
    }

    generateDesignSystem() {
        console.log('🎯 DESIGN SYSTEM ANALYSIS RESULTS');
        console.log('='.repeat(50));

        // 1. Component Categories
        console.log('\n📦 COMPONENT CATEGORIES:');
        console.log('─'.repeat(30));
        this.components.forEach((items, category) => {
            console.log(`\n${category.toUpperCase()} (${items.length} items):`);
            items.forEach(item => {
                console.log(`  • ${item.name} (${item.type})`);
            });
        });

        // 2. Color Palette
        console.log('\n🎨 COLOR PALETTE:');
        console.log('─'.repeat(20));
        const colorArray = Array.from(this.colors);
        if (colorArray.length > 0) {
            colorArray.forEach((color, index) => {
                console.log(`  ${index + 1}. ${color}`);
            });
        } else {
            console.log('  No colors extracted (may need to analyze fills)');
        }

        // 3. Typography Scale
        console.log('\n📝 TYPOGRAPHY SCALE:');
        console.log('─'.repeat(25));
        if (this.typography.size > 0) {
            this.typography.forEach((typo, key) => {
                console.log(`  • ${typo.family} ${typo.weight} - ${typo.size}px`);
            });
        } else {
            console.log('  No typography found (analyze text elements)');
        }

        // 4. Spacing System
        console.log('\n📏 SPACING SYSTEM:');
        console.log('─'.repeat(20));
        const spacingArray = Array.from(this.spacing).sort((a, b) => a - b);
        if (spacingArray.length > 0) {
            const uniqueSpacing = [...new Set(spacingArray.filter(s => s > 0 && s < 1000))];
            uniqueSpacing.slice(0, 10).forEach(space => {
                console.log(`  • ${space}px`);
            });
        } else {
            console.log('  No spacing values extracted');
        }

        // 5. Layout Patterns
        console.log('\n📐 LAYOUT PATTERNS:');
        console.log('─'.repeat(22));
        if (this.layouts.length > 0) {
            this.layouts.forEach(layout => {
                console.log(`  • ${layout.name}: ${layout.layoutMode || 'absolute'}`);
            });
        } else {
            console.log('  No layout patterns found');
        }

        // 6. Componentization Recommendations
        this.generateComponentRecommendations();
    }

    generateComponentRecommendations() {
        console.log('\n💡 COMPONENTIZATION RECOMMENDATIONS:');
        console.log('─'.repeat(40));

        console.log('\n1. ATOMIC COMPONENTS (Basic building blocks):');
        const atomicTypes = ['button', 'typography', 'form'];
        atomicTypes.forEach(type => {
            if (this.components.has(type)) {
                console.log(`   • ${type.charAt(0).toUpperCase() + type.slice(1)} Component`);
                this.components.get(type).forEach(item => {
                    console.log(`     - ${item.name}`);
                });
            }
        });

        console.log('\n2. MOLECULAR COMPONENTS (Combined atoms):');
        const molecularTypes = ['card', 'form', 'navigation'];
        molecularTypes.forEach(type => {
            if (this.components.has(type)) {
                console.log(`   • ${type.charAt(0).toUpperCase() + type.slice(1)} Component`);
                this.components.get(type).forEach(item => {
                    console.log(`     - ${item.name}`);
                });
            }
        });

        console.log('\n3. ORGANISM COMPONENTS (Complex sections):');
        const organismTypes = ['layout', 'sidebar', 'footer', 'modal'];
        organismTypes.forEach(type => {
            if (this.components.has(type)) {
                console.log(`   • ${type.charAt(0).toUpperCase() + type.slice(1)} Component`);
                this.components.get(type).forEach(item => {
                    console.log(`     - ${item.name}`);
                });
            }
        });

        console.log('\n4. NEXT STEPS:');
        console.log('   □ Create component library structure');
        console.log('   □ Define design tokens (colors, typography, spacing)');
        console.log('   □ Build atomic components first');
        console.log('   □ Compose molecular components');
        console.log('   □ Create page templates');
        console.log('   □ Document component usage guidelines');
    }

    rgbToHex(rgb) {
        const toHex = (c) => {
            const hex = Math.round(c * 255).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
    }

    async makeToolCall(toolName, args = {}) {
        return new Promise((resolve, reject) => {
            const mcpRequest = {
                jsonrpc: '2.0',
                id: Math.floor(Math.random() * 1000),
                method: 'tools/call',
                params: {
                    name: toolName,
                    arguments: args
                }
            };

            const options = {
                hostname: 'localhost',
                port: 3015,
                path: '/mcp/request',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
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
}

// Run the analysis
const analyzer = new DesignSystemAnalyzer();
analyzer.analyzeDesign().catch(console.error); 