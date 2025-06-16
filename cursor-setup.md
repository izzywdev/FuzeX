# Cursor IDE + Figma MCP Server Setup

This guide will help you configure Cursor IDE to use the Figma MCP server for direct Figma manipulation from your IDE.

## 🔧 Setup Instructions

### Step 1: Configure Cursor IDE

1. **Open Cursor IDE Settings**
   - Press `Ctrl+,` (or `Cmd+,` on Mac)
   - Or go to File → Preferences → Settings

2. **Find MCP Settings**
   - Search for "MCP" in the settings
   - Look for "MCP Servers" or "Model Context Protocol" section

3. **Add MCP Server Configuration**
   - Add the following configuration:

```json
{
  "mcpServers": {
    "figma": {
      "command": "node",
      "args": ["cursor-mcp-client.js"],
      "cwd": "C:/Users/izzyw/source/FuzeX",
      "env": {
        "NODE_ENV": "development"
      }
    }
  }
}
```

### Alternative: Use Configuration File

If Cursor IDE supports configuration files, you can:

1. **Create/Edit the MCP config file:**
   - Windows: `%APPDATA%\Cursor\User\mcp_servers.json`
   - Mac: `~/Library/Application Support/Cursor/User/mcp_servers.json`
   - Linux: `~/.config/Cursor/User/mcp_servers.json`

2. **Add the configuration from above**

### Step 2: Ensure Prerequisites

Make sure you have:

1. **Figma Desktop App** with the plugin installed
2. **Bridge Server** running: `node bridge-server.js 3015`
3. **Figma Plugin** started (green status in plugin UI)

### Step 3: Test the Integration

1. **Restart Cursor IDE** after adding the MCP configuration

2. **Open the Command Palette** (`Ctrl+Shift+P`)

3. **Look for Figma-related commands** or MCP tools

4. **Try using the AI assistant** and ask it to:
   - "Create a rectangle in Figma"
   - "Get information about the current Figma document"
   - "List all pages in the Figma file"

## 🎯 Usage Examples

Once configured, you can use natural language to interact with Figma:

### In Cursor's AI Chat:
```
"Create a red rectangle at position (100, 100) with size 200x150 in my Figma file"

"Get the list of all pages in the current Figma document"

"Create a text element that says 'Hello from Cursor!' at position (50, 50)"

"Search for all nodes containing 'button' in their name"
```

### Available Operations:
- **Document Info**: Get document metadata
- **Page Management**: Create, delete, list pages
- **Element Creation**: Rectangles, ellipses, text, frames
- **Element Modification**: Move, resize, modify properties
- **Search**: Find elements by name
- **Property Management**: Get/set element properties

## 🔍 Troubleshooting

### MCP Server Not Appearing:
1. Check Cursor IDE version supports MCP
2. Verify configuration file path and syntax
3. Restart Cursor IDE completely
4. Check the Developer Console for errors

### Connection Issues:
1. Ensure bridge server is running on port 3015
2. Check if Figma plugin is active and started
3. Verify the working directory path in configuration
4. Check Windows Firewall settings

### Commands Not Working:
1. Verify the Figma plugin is showing "Server Running"
2. Test the bridge server with: `node test.js`
3. Check the bridge server logs for errors
4. Make sure you have an active Figma document open

## 📚 Advanced Usage

### Custom Prompts:
You can create more complex workflows:

```
"I need to create a dashboard layout in Figma:
1. Create a main frame called 'Dashboard' at 0,0 with size 1200x800
2. Add a header rectangle at the top (0,0) with size 1200x80
3. Create a sidebar frame at (0,80) with size 300x720
4. Add a main content area at (300,80) with size 900x720
5. Add a title text 'My Dashboard' in the header"
```

### Batch Operations:
```
"Create 5 colored rectangles in a row, each 100x100 pixels, 
starting at position (50, 50) with 20px spacing between them.
Use different colors for each: red, blue, green, yellow, purple"
```

This integration allows you to use Cursor's AI to generate and manipulate Figma designs directly from your code editor! 