# 🚀 FuzeX - AI-Driven Figma Design Tool

**Transform your Figma workflow with the power of AI**

FuzeX is an intelligent Figma plugin that leverages cutting-edge AI models to automate design processes, extract design systems, and generate components from natural language or images.

## ✨ Features

### 🎨 Design System Extraction
- **Automatic Design System Analysis**: Extract colors, typography, spacing, and components from existing designs
- **Component Categorization**: Intelligently categorize UI elements into atomic, molecular, and organism components
- **Design Token Generation**: Export design tokens as CSS variables, JSON, or design system documentation

### 🧠 AI-Powered Design
- **Multi-Model Support**: Choose between OpenAI (GPT-4, GPT-3.5) and Anthropic (Claude) models
- **Smart Naming**: Automatically rename pages and frames based on their content and purpose
- **UX State Generation**: Generate multiple UI states (hover, active, disabled) from a single base state

### 🔧 Component Generation
- **React Component Export**: Convert Figma elements directly to React components with proper styling
- **Image to Figma**: Upload screenshots or images and generate Figma designs automatically
- **Text to Design**: Describe your design in natural language and watch it come to life

### 🔗 Integration & Workflow
- **Jira Integration**: Connect with Jira for seamless design-to-development handoff
- **MCP Protocol**: Built on Model Context Protocol for extensible AI integrations
- **Real-time Analysis**: Live design analysis and suggestions as you work

## 🚀 Quick Start

### Installation
1. Download the plugin from the Figma Plugin Store (coming soon)
2. Or install manually by cloning this repository and loading as a development plugin

### Setup
1. Open the FuzeX plugin in Figma
2. Add your API keys:
   - OpenAI API Key (for GPT models)
   - Anthropic API Key (for Claude models)
   - Jira API Key (optional, for project integration)
3. Select your preferred AI model
4. Start designing with AI assistance!

## 🛠️ Development

### Prerequisites
- Node.js 16+
- Figma Desktop App
- API keys for AI services

### Local Development
```bash
# Clone the repository
git clone https://github.com/yourusername/FuzeX.git
cd FuzeX

# Install dependencies
npm install

# Start the bridge server
node bridge-server.js 3015

# Load the plugin in Figma
# 1. Open Figma Desktop
# 2. Go to Plugins > Development > Import plugin from manifest
# 3. Select the manifest.json file
```

### Project Structure
```
FuzeX/
├── code.js              # Main plugin code
├── ui.html              # Plugin UI interface
├── bridge-server.js     # MCP bridge server
├── manifest.json        # Plugin manifest
├── package.json         # Dependencies
├── README.md           # This file
├── ROADMAP.md          # Development roadmap
└── tests/              # Test scripts
    ├── design-system-analyzer.js
    ├── enumerate-page-content.js
    └── focused-design-analysis.js
```

## 🎯 Use Cases

### For Designers
- **Design System Audit**: Analyze existing designs and extract reusable components
- **Rapid Prototyping**: Generate designs from descriptions or reference images
- **Consistency Checking**: Ensure design consistency across projects
- **State Management**: Automatically generate interaction states

### For Developers
- **Component Export**: Get production-ready React components from Figma
- **Design Tokens**: Export standardized design tokens for development
- **Jira Integration**: Link designs directly to development tickets

### For Teams
- **Design Handoff**: Streamlined designer-developer collaboration
- **Documentation**: Auto-generated design system documentation
- **Quality Assurance**: AI-powered design review and suggestions

## 🔑 API Keys & Configuration

FuzeX requires API keys for AI functionality:

- **OpenAI**: Get your key from [OpenAI Platform](https://platform.openai.com/api-keys)
- **Anthropic**: Get your key from [Anthropic Console](https://console.anthropic.com/)
- **Jira**: Generate from your Jira instance settings

All keys are stored securely in your local Figma plugin storage.

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Workflow
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: Report bugs or request features on [GitHub Issues](https://github.com/yourusername/FuzeX/issues)
- **Discussions**: Join the conversation in [GitHub Discussions](https://github.com/yourusername/FuzeX/discussions)
- **Documentation**: Full documentation available at [docs.fuzex.dev](https://docs.fuzex.dev)

## 🙏 Acknowledgments

- Built with the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- Powered by OpenAI and Anthropic AI models
- Inspired by the amazing Figma developer community

---

**Made with ❤️ for the design community**

[Website](https://fuzex.dev) • [Documentation](https://docs.fuzex.dev) • [Twitter](https://twitter.com/fuzexdev)
