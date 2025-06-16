const http = require('http');

class FocusedDesignAnalyzer {
    constructor() {
        this.components = new Map();
        this.colors = new Set();
        this.typography = new Map();
        this.spacing = new Set();
        this.patterns = new Map();
    }

    async analyzeDesign() {
        console.log('🎨 FOCUSED DESIGN SYSTEM ANALYSIS');
        console.log('='.repeat(50));

        try {
            // Get pages
            const pages = await this.makeToolCall('get_pages');
            console.log(`\n📑 Found ${pages.length} pages:`);
            pages.forEach((page, i) => {
                console.log(`   ${i+1}. "${page.name}" (${page.children} elements)`);
            });

            // Analyze each page for key components
            for (const page of pages) {
                console.log(`\n🔍 Analyzing "${page.name}"...`);
                await this.analyzePageComponents(page);
            }

            // Generate design system summary
            this.generateDesignSystemSummary();

        } catch (error) {
            console.error('❌ Analysis failed:', error.message);
        }
    }

    async analyzePageComponents(page) {
        try {
            const nodes = await this.makeToolCall('get_nodes', { nodeId: page.id });
            
            if (nodes && nodes.children) {
                console.log(`   Found ${nodes.children.length} top-level components:`);
                
                // Analyze top-level components only (avoid deep nesting)
                for (let i = 0; i < Math.min(nodes.children.length, 10); i++) {
                    const child = nodes.children[i];
                    await this.analyzeComponent(child, 1);
                }
                
                if (nodes.children.length > 10) {
                    console.log(`   ... and ${nodes.children.length - 10} more components`);
                }
            }
        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
        }
    }

    async analyzeComponent(component, depth) {
        const indent = '  '.repeat(depth);
        
        // Categorize component
        const category = this.categorizeComponent(component);
        
        console.log(`${indent}• ${component.name} (${component.type}) → ${category}`);
        
        // Store component info
        if (!this.components.has(category)) {
            this.components.set(category, []);
        }
        this.components.get(category).push({
            name: component.name,
            type: component.type,
            id: component.id
        });

        // Extract design tokens from key components
        if (this.isKeyComponent(component)) {
            await this.extractDesignTokens(component);
        }

        // Analyze children of important containers (but limit depth)
        if (depth < 2 && component.children && component.children.length > 0 && component.children.length < 20) {
            for (let i = 0; i < Math.min(component.children.length, 5); i++) {
                await this.analyzeComponent(component.children[i], depth + 1);
            }
        }
    }

    categorizeComponent(component) {
        const name = component.name.toLowerCase();
        const type = component.type;

        // Smart categorization based on naming patterns
        if (name.includes('button') || name.includes('btn')) return 'Button';
        if (name.includes('card') || name.includes('item')) return 'Card';
        if (name.includes('header') || name.includes('nav')) return 'Navigation';
        if (name.includes('footer')) return 'Footer';
        if (name.includes('sidebar') || name.includes('menu')) return 'Menu';
        if (name.includes('modal') || name.includes('popup')) return 'Modal';
        if (name.includes('form') || name.includes('input')) return 'Form';
        if (name.includes('hero') || name.includes('banner')) return 'Hero';
        if (name.includes('section')) return 'Section';
        if (type === 'TEXT') return 'Typography';
        if (type === 'FRAME' && name.includes('frame')) return 'Layout';
        
        return 'Component';
    }

    isKeyComponent(component) {
        const keyTypes = ['TEXT', 'RECTANGLE', 'ELLIPSE'];
        const keyNames = ['button', 'card', 'header', 'nav', 'title', 'heading'];
        
        return keyTypes.includes(component.type) || 
               keyNames.some(key => component.name.toLowerCase().includes(key));
    }

    async extractDesignTokens(component) {
        try {
            const properties = await this.makeToolCall('get_node_properties', { nodeId: component.id });
            
            if (properties) {
                // Extract colors
                if (properties.fills && properties.fills.length > 0) {
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
                        weight: properties.fontName.style
                    });
                }

                // Extract spacing
                if (properties.width && properties.height) {
                    this.spacing.add(Math.round(properties.width));
                    this.spacing.add(Math.round(properties.height));
                }
            }
        } catch (error) {
            // Silently continue if properties can't be fetched
        }
    }

    generateDesignSystemSummary() {
        console.log('\n🎯 DESIGN SYSTEM SUMMARY');
        console.log('='.repeat(40));

        // Component inventory
        console.log('\n📦 COMPONENT INVENTORY:');
        this.components.forEach((items, category) => {
            console.log(`\n${category} (${items.length} instances):`);
            const uniqueNames = [...new Set(items.map(item => item.name))];
            uniqueNames.slice(0, 5).forEach(name => {
                console.log(`  • ${name}`);
            });
            if (uniqueNames.length > 5) {
                console.log(`  • ... and ${uniqueNames.length - 5} more`);
            }
        });

        // Color palette
        console.log('\n🎨 COLOR PALETTE:');
        const colorArray = Array.from(this.colors);
        if (colorArray.length > 0) {
            colorArray.slice(0, 10).forEach((color, i) => {
                console.log(`  ${i + 1}. ${color}`);
            });
            if (colorArray.length > 10) {
                console.log(`  ... and ${colorArray.length - 10} more colors`);
            }
        } else {
            console.log('  No colors extracted');
        }

        // Typography scale
        console.log('\n📝 TYPOGRAPHY SCALE:');
        if (this.typography.size > 0) {
            Array.from(this.typography.values()).slice(0, 8).forEach(typo => {
                console.log(`  • ${typo.family} ${typo.weight} - ${typo.size}px`);
            });
        } else {
            console.log('  No typography found');
        }

        // Componentization recommendations
        this.generateComponentizationPlan();
    }

    generateComponentizationPlan() {
        console.log('\n💡 COMPONENTIZATION PLAN:');
        console.log('─'.repeat(30));

        console.log('\n🔹 ATOMIC COMPONENTS (Build first):');
        const atomicTypes = ['Button', 'Typography', 'Form'];
        atomicTypes.forEach(type => {
            if (this.components.has(type)) {
                console.log(`   ✓ ${type} Component (${this.components.get(type).length} instances)`);
            }
        });

        console.log('\n🔹 MOLECULAR COMPONENTS (Build second):');
        const molecularTypes = ['Card', 'Navigation', 'Menu'];
        molecularTypes.forEach(type => {
            if (this.components.has(type)) {
                console.log(`   ✓ ${type} Component (${this.components.get(type).length} instances)`);
            }
        });

        console.log('\n🔹 ORGANISM COMPONENTS (Build third):');
        const organismTypes = ['Hero', 'Section', 'Footer', 'Layout'];
        organismTypes.forEach(type => {
            if (this.components.has(type)) {
                console.log(`   ✓ ${type} Component (${this.components.get(type).length} instances)`);
            }
        });

        console.log('\n📋 NEXT STEPS:');
        console.log('   1. Create design token definitions (colors, typography, spacing)');
        console.log('   2. Build atomic components first');
        console.log('   3. Compose molecular components using atoms');
        console.log('   4. Create page templates using organisms');
        console.log('   5. Document component usage guidelines');
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
                params: { name: toolName, arguments: args }
            };

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
}

// Run the focused analysis
const analyzer = new FocusedDesignAnalyzer();
analyzer.analyzeDesign().catch(console.error); 