const http = require('http');

class QuickDesignSummary {
    constructor() {
        this.components = [];
        this.colors = new Set();
        this.insights = [];
    }

    async generateSummary() {
        console.log('🚀 QUICK DESIGN SYSTEM SUMMARY');
        console.log('='.repeat(45));

        try {
            // Get pages overview
            const pages = await this.makeToolCall('get_pages');
            console.log(`\n📑 PAGES OVERVIEW:`);
            pages.forEach((page, i) => {
                console.log(`   ${i+1}. "${page.name}" - ${page.children} elements`);
            });

            // Analyze first page in detail
            if (pages.length > 0) {
                const firstPage = pages[0];
                console.log(`\n🔍 ANALYZING "${firstPage.name}" (Main Page):`);
                
                const nodes = await this.makeToolCall('get_nodes', { nodeId: firstPage.id });
                
                if (nodes && nodes.children) {
                    console.log(`   Found ${nodes.children.length} top-level sections:`);
                    
                    // Categorize top-level components
                    const categories = {};
                    nodes.children.forEach(child => {
                        const category = this.categorizeComponent(child);
                        if (!categories[category]) categories[category] = [];
                        categories[category].push(child.name);
                    });

                    console.log('\n📦 COMPONENT CATEGORIES:');
                    Object.entries(categories).forEach(([category, items]) => {
                        console.log(`   ${category}: ${items.length} items`);
                        items.slice(0, 3).forEach(name => {
                            console.log(`     • ${name}`);
                        });
                        if (items.length > 3) {
                            console.log(`     • ... and ${items.length - 3} more`);
                        }
                    });

                    // Sample a few components for design tokens
                    console.log('\n🎨 DESIGN TOKENS SAMPLE:');
                    await this.sampleDesignTokens(nodes.children.slice(0, 5));
                }
            }

            this.generateRecommendations();

        } catch (error) {
            console.error('❌ Analysis failed:', error.message);
        }
    }

    categorizeComponent(component) {
        const name = component.name.toLowerCase();
        
        if (name.includes('home') || name.includes('hero')) return '🏠 Homepage';
        if (name.includes('product') || name.includes('item')) return '🛍️ Product';
        if (name.includes('categories') || name.includes('category')) return '📂 Categories';
        if (name.includes('footer')) return '🦶 Footer';
        if (name.includes('header') || name.includes('nav')) return '🧭 Navigation';
        if (name.includes('profile') || name.includes('user')) return '👤 Profile';
        if (name.includes('blog') || name.includes('article')) return '📝 Blog';
        if (name.includes('frame')) return '📐 Layout';
        if (component.type === 'TEXT') return '📝 Typography';
        
        return '🔧 Component';
    }

    async sampleDesignTokens(components) {
        let colorCount = 0;
        let textCount = 0;
        
        for (const component of components) {
            if (colorCount >= 3 && textCount >= 3) break;
            
            try {
                const props = await this.makeToolCall('get_node_properties', { nodeId: component.id });
                
                if (props) {
                    // Sample colors
                    if (props.fills && props.fills.length > 0 && colorCount < 3) {
                        props.fills.forEach(fill => {
                            if (fill.type === 'SOLID' && fill.color && colorCount < 3) {
                                const color = this.rgbToHex(fill.color);
                                this.colors.add(color);
                                colorCount++;
                            }
                        });
                    }

                    // Sample typography
                    if (props.fontName && props.fontSize && textCount < 3) {
                        console.log(`   Font: ${props.fontName.family} ${props.fontName.style} - ${props.fontSize}px`);
                        textCount++;
                    }
                }
            } catch (error) {
                // Continue sampling
            }
        }

        // Show color samples
        if (this.colors.size > 0) {
            console.log('   Colors found:');
            Array.from(this.colors).forEach(color => {
                console.log(`     ${color}`);
            });
        }
    }

    generateRecommendations() {
        console.log('\n💡 COMPONENTIZATION RECOMMENDATIONS:');
        console.log('─'.repeat(40));

        console.log('\n🎯 PRIORITY 1 - Core Components:');
        console.log('   • Button Component (for CTAs and actions)');
        console.log('   • Typography System (headings, body text)');
        console.log('   • Color Palette (primary, secondary, neutrals)');
        console.log('   • Card Component (for products/content)');

        console.log('\n🎯 PRIORITY 2 - Layout Components:');
        console.log('   • Header/Navigation Component');
        console.log('   • Footer Component');
        console.log('   • Grid/Container System');
        console.log('   • Section Layouts');

        console.log('\n🎯 PRIORITY 3 - Feature Components:');
        console.log('   • Product Display Components');
        console.log('   • Category Navigation');
        console.log('   • User Profile Components');
        console.log('   • Blog/Content Components');

        console.log('\n📋 NEXT STEPS:');
        console.log('   1. Extract complete color palette from all components');
        console.log('   2. Document typography scale (all font sizes/weights)');
        console.log('   3. Identify spacing patterns (margins, padding)');
        console.log('   4. Create component library structure');
        console.log('   5. Build design tokens file (CSS variables/JSON)');
        console.log('   6. Start with atomic components (buttons, inputs)');
        console.log('   7. Progress to molecular (cards, forms)');
        console.log('   8. Finish with organisms (headers, sections)');

        console.log('\n✨ DESIGN SYSTEM BENEFITS:');
        console.log('   • Consistent UI across all pages');
        console.log('   • Faster development with reusable components');
        console.log('   • Easier maintenance and updates');
        console.log('   • Better user experience through consistency');
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

// Run the quick summary
const summary = new QuickDesignSummary();
summary.generateSummary().catch(console.error); 