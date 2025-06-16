// Main plugin code - handles MCP server and Figma API operations
let isServerRunning = false;
let mcpClients = new Set();

// MCP Server implementation
class McpServer {
  constructor() {
    this.clients = new Set();
    this.tools = new Map();
    this.setupTools();
  }

  setupTools() {
    // Register all available tools
    this.tools.set('get_document_info', this.getDocumentInfo.bind(this));
    this.tools.set('get_pages', this.getPages.bind(this));
    this.tools.set('create_page', this.createPage.bind(this));
    this.tools.set('delete_page', this.deletePage.bind(this));
    this.tools.set('get_nodes', this.getNodes.bind(this));
    this.tools.set('create_frame', this.createFrame.bind(this));
    this.tools.set('create_rectangle', this.createRectangle.bind(this));
    this.tools.set('create_ellipse', this.createEllipse.bind(this));
    this.tools.set('create_text', this.createText.bind(this));
    this.tools.set('modify_node', this.modifyNode.bind(this));
    this.tools.set('delete_node', this.deleteNode.bind(this));
    this.tools.set('move_node', this.moveNode.bind(this));
    this.tools.set('resize_node', this.resizeNode.bind(this));
    this.tools.set('set_node_properties', this.setNodeProperties.bind(this));
    this.tools.set('get_node_properties', this.getNodeProperties.bind(this));
    this.tools.set('duplicate_node', this.duplicateNode.bind(this));
    this.tools.set('search_nodes', this.searchNodes.bind(this));
  }

  // Document operations
  async getDocumentInfo() {
    return {
      name: figma.root.name,
      id: figma.root.id,
      type: figma.root.type,
      children: figma.root.children.length
    };
  }

  // Page operations
  async getPages() {
    try {
      // Load all pages first to access their children
      await figma.loadAllPagesAsync();
      
      return figma.root.children.map(page => ({
        id: page.id,
        name: page.name,
        type: page.type,
        children: page.children.length
      }));
    } catch (error) {
      throw new Error(`Failed to get pages: ${error.message}`);
    }
  }

  async createPage(args) {
    const page = figma.createPage();
    if (args.name) page.name = args.name;
    return {
      id: page.id,
      name: page.name,
      type: page.type
    };
  }

  async deletePage(args) {
    const page = await figma.getNodeByIdAsync(args.pageId);
    if (!page || page.type !== 'PAGE') {
      throw new Error('Page not found');
    }
    page.remove();
    return { success: true, pageId: args.pageId };
  }

  // Node operations
  async getNodes(args) {
    try {
      let parent = figma.currentPage;
      
      if (args.nodeId || args.parentId) {
        const nodeId = args.nodeId || args.parentId;
        parent = await figma.getNodeByIdAsync(nodeId);
        if (!parent) throw new Error('Node not found');
        
        // If it's a page, load it first
        if (parent.type === 'PAGE') {
          await parent.loadAsync();
        }
      }

      const getNodeInfo = (node) => ({
        id: node.id,
        name: node.name,
        type: node.type,
        x: node.x || 0,
        y: node.y || 0,
        width: node.width || 0,
        height: node.height || 0,
        visible: node.visible,
        locked: node.locked || false,
        children: node.children ? node.children.map(child => getNodeInfo(child)) : []
      });

      if ('children' in parent) {
        return {
          id: parent.id,
          name: parent.name,
          type: parent.type,
          children: parent.children.map(getNodeInfo)
        };
      }
      return { id: parent.id, name: parent.name, type: parent.type, children: [] };
    } catch (error) {
      throw new Error(`Failed to get nodes: ${error.message}`);
    }
  }

  async createFrame(args) {
    const frame = figma.createFrame();
    frame.name = args.name || 'Frame';
    frame.x = args.x || 0;
    frame.y = args.y || 0;
    frame.resize(args.width || 100, args.height || 100);
    
    if (args.parentId) {
      const parent = await figma.getNodeByIdAsync(args.parentId);
      if (parent && 'appendChild' in parent) {
        parent.appendChild(frame);
      }
    } else {
      figma.currentPage.appendChild(frame);
    }

    return {
      id: frame.id,
      name: frame.name,
      type: frame.type,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height
    };
  }

  async createRectangle(args) {
    const rect = figma.createRectangle();
    rect.name = args.name || 'Rectangle';
    rect.x = args.x || 0;
    rect.y = args.y || 0;
    rect.resize(args.width || 100, args.height || 100);
    
    if (args.fill) {
      rect.fills = [{
        type: 'SOLID',
        color: args.fill
      }];
    }

    if (args.parentId) {
      const parent = await figma.getNodeByIdAsync(args.parentId);
      if (parent && 'appendChild' in parent) {
        parent.appendChild(rect);
      }
    } else {
      figma.currentPage.appendChild(rect);
    }

    return {
      id: rect.id,
      name: rect.name,
      type: rect.type,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
  }

  async createEllipse(args) {
    const ellipse = figma.createEllipse();
    ellipse.name = args.name || 'Ellipse';
    ellipse.x = args.x || 0;
    ellipse.y = args.y || 0;
    ellipse.resize(args.width || 100, args.height || 100);
    
    if (args.fill) {
      ellipse.fills = [{
        type: 'SOLID',
        color: args.fill
      }];
    }

    if (args.parentId) {
      const parent = await figma.getNodeByIdAsync(args.parentId);
      if (parent && 'appendChild' in parent) {
        parent.appendChild(ellipse);
      }
    } else {
      figma.currentPage.appendChild(ellipse);
    }

    return {
      id: ellipse.id,
      name: ellipse.name,
      type: ellipse.type,
      x: ellipse.x,
      y: ellipse.y,
      width: ellipse.width,
      height: ellipse.height
    };
  }

  async createText(args) {
    const text = figma.createText();
    
    // Load font before setting text
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    
    text.name = args.name || 'Text';
    text.characters = args.text || 'Text';
    text.x = args.x || 0;
    text.y = args.y || 0;
    
    if (args.fontSize) {
      text.fontSize = args.fontSize;
    }
    
    if (args.fill) {
      text.fills = [{
        type: 'SOLID',
        color: args.fill
      }];
    }

    if (args.parentId) {
      const parent = await figma.getNodeByIdAsync(args.parentId);
      if (parent && 'appendChild' in parent) {
        parent.appendChild(text);
      }
    } else {
      figma.currentPage.appendChild(text);
    }

    return {
      id: text.id,
      name: text.name,
      type: text.type,
      x: text.x,
      y: text.y,
      width: text.width,
      height: text.height,
      characters: text.characters
    };
  }

  async modifyNode(args) {
    const node = await figma.getNodeByIdAsync(args.nodeId);
    if (!node) throw new Error('Node not found');

    if (args.name !== undefined) node.name = args.name;
    if (args.visible !== undefined) node.visible = args.visible;
    if (args.locked !== undefined) node.locked = args.locked;
    
    if (args.x !== undefined || args.y !== undefined) {
      node.x = args.x !== undefined ? args.x : node.x;
      node.y = args.y !== undefined ? args.y : node.y;
    }
    
    if (args.width !== undefined || args.height !== undefined) {
      node.resize(
        args.width !== undefined ? args.width : node.width,
        args.height !== undefined ? args.height : node.height
      );
    }

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      x: node.x || 0,
      y: node.y || 0,
      width: node.width || 0,
      height: node.height || 0
    };
  }

  async deleteNode(args) {
    const node = await figma.getNodeByIdAsync(args.nodeId);
    if (!node) throw new Error('Node not found');
    
    node.remove();
    return { success: true, nodeId: args.nodeId };
  }

  async moveNode(args) {
    const node = await figma.getNodeByIdAsync(args.nodeId);
    if (!node) throw new Error('Node not found');
    
    node.x = args.x;
    node.y = args.y;
    
    return {
      id: node.id,
      x: node.x,
      y: node.y
    };
  }

  async resizeNode(args) {
    const node = await figma.getNodeByIdAsync(args.nodeId);
    if (!node) throw new Error('Node not found');
    
    node.resize(args.width, args.height);
    
    return {
      id: node.id,
      width: node.width,
      height: node.height
    };
  }

  async setNodeProperties(args) {
    const node = await figma.getNodeByIdAsync(args.nodeId);
    if (!node) throw new Error('Node not found');

    const properties = args.properties;
    
    // Handle different node types and their specific properties
    if (node.type === 'TEXT' && properties.characters !== undefined) {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      node.characters = properties.characters;
    }
    
    if (properties.fills && 'fills' in node) {
      node.fills = properties.fills;
    }
    
    if (properties.strokes && 'strokes' in node) {
      node.strokes = properties.strokes;
    }
    
    if (properties.opacity !== undefined) {
      node.opacity = properties.opacity;
    }

    return { success: true, nodeId: args.nodeId };
  }

  async getNodeProperties(args) {
    const node = await figma.getNodeByIdAsync(args.nodeId);
    if (!node) throw new Error('Node not found');

    const properties = {
      id: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible,
      locked: node.locked || false,
      x: node.x || 0,
      y: node.y || 0,
      width: node.width || 0,
      height: node.height || 0
    };

    if ('fills' in node) properties.fills = node.fills;
    if ('strokes' in node) properties.strokes = node.strokes;
    if ('opacity' in node) properties.opacity = node.opacity;
    if (node.type === 'TEXT') properties.characters = node.characters;

    return properties;
  }

  async duplicateNode(args) {
    const node = await figma.getNodeByIdAsync(args.nodeId);
    if (!node) throw new Error('Node not found');
    
    const duplicate = node.clone();
    
    if (args.x !== undefined || args.y !== undefined) {
      duplicate.x = args.x !== undefined ? args.x : duplicate.x + 10;
      duplicate.y = args.y !== undefined ? args.y : duplicate.y + 10;
    }

    return {
      id: duplicate.id,
      name: duplicate.name,
      type: duplicate.type,
      x: duplicate.x || 0,
      y: duplicate.y || 0,
      width: duplicate.width || 0,
      height: duplicate.height || 0
    };
  }

  async searchNodes(args) {
    const query = args.query.toLowerCase();
    const results = [];
    
    const searchInNode = (node) => {
      if (node.name.toLowerCase().includes(query)) {
        results.push({
          id: node.id,
          name: node.name,
          type: node.type,
          x: node.x || 0,
          y: node.y || 0,
          width: node.width || 0,
          height: node.height || 0
        });
      }
      
      if ('children' in node) {
        node.children.forEach(searchInNode);
      }
    };

    figma.root.children.forEach(searchInNode);
    return results;
  }

  // Process MCP requests
  async processRequest(request) {
    try {
      if (request.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'figma-mcp-server',
              version: '1.0.0'
            }
          }
        };
      }

      if (request.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            tools: Array.from(this.tools.keys()).map(name => ({
              name,
              description: `Figma API operation: ${name}`,
              inputSchema: {
                type: 'object',
                properties: {}
              }
            }))
          }
        };
      }

      if (request.method === 'tools/call') {
        const toolName = request.params.name;
        const args = request.params.arguments || {};
        
        if (!this.tools.has(toolName)) {
          throw new Error(`Unknown tool: ${toolName}`);
        }

        const result = await this.tools.get(toolName)(args);
        
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          }
        };
      }

      throw new Error(`Unknown method: ${request.method}`);
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: error.message
        }
      };
    }
  }

  broadcast(message) {
    this.clients.forEach(client => {
      figma.ui.postMessage({
        type: 'sse-message',
        clientId: client.id,
        data: message
      });
    });
  }

  addClient(clientId) {
    this.clients.add({ id: clientId });
  }

  removeClient(clientId) {
    this.clients.delete(clientId);
  }
}

// Initialize MCP server
const mcpServer = new McpServer();

// Plugin command handlers
figma.on('run', ({ command }) => {
  switch (command) {
    case 'start-server':
      startServer();
      break;
    case 'stop-server':
      stopServer();
      break;
    default:
      showUI();
  }
});

function startServer() {
  isServerRunning = true;
  showUI();
  
  // Send status update to UI
  figma.ui.postMessage({
    type: 'server-status',
    running: true
  });
  
  // Send log message to UI
  figma.ui.postMessage({
    type: 'log',
    message: '✅ MCP Server started successfully'
  });
  
  // Send connection info
  figma.ui.postMessage({
    type: 'log',
    message: '🔗 Bridge server should be running at http://localhost:3015'
  });
  
  figma.ui.postMessage({
    type: 'log',
    message: '📡 SSE endpoint: http://localhost:3015/mcp/sse'
  });

  // Connect to bridge server
  connectToBridgeServer();
}

async function connectToBridgeServer() {
  try {
    // Register with bridge server
    const response = await fetch('http://localhost:3015/plugin/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pluginId: 'figma-mcp-plugin',
        version: '1.0.0',
        timestamp: Date.now()
      })
    });

    if (response.ok) {
      figma.ui.postMessage({
        type: 'log',
        message: '🔌 Plugin connected to bridge server successfully!'
      });
      
      // Start monitoring bridge server status
      startBridgeServerMonitoring();
      
      // Start polling for MCP requests
      startRequestPolling();
      
      figma.ui.postMessage({
        type: 'log',
        message: '🎯 Started polling for real MCP requests'
      });
    } else {
      throw new Error(`Connection failed: ${response.status}`);
    }
  } catch (error) {
    figma.ui.postMessage({
      type: 'log',
      message: `❌ Failed to connect to bridge server: ${error.message}`
    });
    
    figma.ui.postMessage({
      type: 'log',
      message: '💡 Make sure bridge server is running: node bridge-server.js 3015'
    });
  }
}

async function startBridgeServerMonitoring() {
  const checkStatus = async () => {
    try {
      const response = await fetch('http://localhost:3015/status');
      if (response.ok) {
        const status = await response.json();
        
        // Send bridge server status to UI
        figma.ui.postMessage({
          type: 'bridge-status',
          connected: status.figmaConnected,
          clients: status.connectedClients || 0,
          timestamp: status.timestamp || Date.now()
        });
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      // Bridge server is down
      figma.ui.postMessage({
        type: 'bridge-status',
        connected: false,
        clients: 0,
        timestamp: Date.now()
      });
    }
  };
  
  // Check status immediately
  await checkStatus();
  
  // Check status every 5 seconds
  setInterval(checkStatus, 5000);
}

async function startRequestPolling() {
  const pollForRequests = async () => {
    try {
      const response = await fetch('http://localhost:3015/plugin/get-requests');
      if (response.ok) {
        const data = await response.json();
        
        // Process any pending requests
        for (const request of data.requests) {
          await processPluginRequest(request);
        }
      }
    } catch (error) {
      // Silently fail - bridge server might be down
    }
  };
  
  // Poll every 1 second for requests
  setInterval(pollForRequests, 1000);
}

async function processPluginRequest(request) {
  try {
    const { id, mcpRequest } = request;
    const toolName = mcpRequest.params.name;
    const args = mcpRequest.params.arguments || {};
    
    figma.ui.postMessage({
      type: 'log',
      message: `🔧 Processing real request: ${toolName}`
    });
    
    // Use the actual MCP server to process the request
    const result = await mcpServer.tools.get(toolName)(args);
    
    // Send response back to bridge server
    await fetch('http://localhost:3015/plugin/send-response', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requestId: id,
        response: result
      })
    });
    
    figma.ui.postMessage({
      type: 'log',
      message: `✅ Sent real response for: ${toolName}`
    });
    
  } catch (error) {
    figma.ui.postMessage({
      type: 'log',
      message: `❌ Error processing request: ${error.message}`
    });
  }
}

function stopServer() {
  isServerRunning = false;
  mcpClients.clear();
  
  // Send status update to UI
  figma.ui.postMessage({
    type: 'server-status',
    running: false
  });
  
  // Send log message to UI
  figma.ui.postMessage({
    type: 'log',
    message: '🛑 MCP Server stopped'
  });
}

function showUI() {
  figma.showUI(__html__, {
    width: 400,
    height: 600,
    title: 'Figma MCP Server'
  });
}

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case 'start-server':
      startServer();
      break;
      
    case 'stop-server':
      stopServer();
      break;
      
    case 'mcp-request':
      const response = await mcpServer.processRequest(msg.request);
      figma.ui.postMessage({
        type: 'mcp-response',
        response,
        requestId: msg.requestId
      });
      break;
      
    case 'client-connect':
      mcpServer.addClient(msg.clientId);
      break;
      
    case 'client-disconnect':
      mcpServer.removeClient(msg.clientId);
      break;
      
    case 'get-server-status':
      figma.ui.postMessage({
        type: 'server-status',
        running: isServerRunning
      });
      break;
      
    case 'ping':
      // Respond to ping to show server is alive
      figma.ui.postMessage({
        type: 'pong',
        timestamp: Date.now()
      });
      break;
  }
};

// Keep plugin running
figma.on('close', () => {
  // Cleanup when plugin is closed
}); 