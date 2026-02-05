#!/usr/bin/env node
/**
 * Mock MCP Server for E2E Testing
 * 
 * A minimal MCP server implementing the JSON-RPC 2.0 protocol over stdio.
 * Supports: initialize, notifications/initialized, tools/list, tools/call
 */

import * as readline from "node:readline";

const SERVER_INFO = {
  name: "mock-mcp-server",
  version: "1.0.0",
};

const TOOLS = [
  {
    name: "echo",
    description: "Echoes the input message back",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message to echo" },
      },
      required: ["message"],
    },
  },
  {
    name: "add",
    description: "Adds two numbers together",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number", description: "First number" },
        b: { type: "number", description: "Second number" },
      },
      required: ["a", "b"],
    },
  },
  {
    name: "fail",
    description: "Always fails with an error",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "slow",
    description: "Responds after a delay",
    inputSchema: {
      type: "object",
      properties: {
        delayMs: { type: "number", description: "Delay in milliseconds" },
      },
    },
  },
];

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function handleRequest(request) {
  const { id, method, params } = request;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: SERVER_INFO,
        },
      };

    case "notifications/initialized":
      // Notification - no response
      return null;

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS,
        },
      };

    case "tools/call":
      return handleToolCall(id, params);

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
  }
}

function handleToolCall(id, params) {
  const { name, arguments: args } = params || {};

  switch (name) {
    case "echo":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: args?.message || "" }],
          isError: false,
        },
      };

    case "add":
      const sum = (args?.a || 0) + (args?.b || 0);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: String(sum) }],
          isError: false,
        },
      };

    case "fail":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: "Intentional failure for testing" }],
          isError: true,
        },
      };

    case "slow":
      const delayMs = args?.delayMs || 1000;
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: `Responded after ${delayMs}ms` }],
              isError: false,
            },
          });
        }, delayMs);
      });

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Tool not found: ${name}`,
        },
      };
  }
}

// Main loop
const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", async (line) => {
  if (!line.trim()) return;

  try {
    const request = JSON.parse(line);
    const response = await handleRequest(request);
    
    if (response) {
      send(response);
    }
  } catch (err) {
    send({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: `Parse error: ${err.message}`,
      },
    });
  }
});

rl.on("close", () => {
  process.exit(0);
});

// Handle SIGTERM gracefully
process.on("SIGTERM", () => {
  process.exit(0);
});
