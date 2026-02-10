#!/usr/bin/env node
/**
 * Mock MCP Server that requests roots/list before responding to tools/call.
 */

import * as readline from "node:readline";
import { writeSync } from "node:fs";

const SERVER_INFO = {
  name: "mock-mcp-roots",
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
];

let pendingToolCall = null;
let rootsRequestId = null;

function send(message) {
  writeSync(1, JSON.stringify(message) + "\n");
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
      pendingToolCall = { id, params };
      rootsRequestId = 0;
      send({
        jsonrpc: "2.0",
        id: rootsRequestId,
        method: "roots/list",
      });
      return null;

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

function handleRootsResponse(response) {
  if (!pendingToolCall) return false;
  if (response?.id !== rootsRequestId) return false;

  const toolId = pendingToolCall.id;
  pendingToolCall = null;
  rootsRequestId = null;

  send({
    jsonrpc: "2.0",
    id: toolId,
    result: {
      content: [{ type: "text", text: "ok" }],
      isError: false,
    },
  });
  return true;
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  if (!line.trim()) return;

  try {
    const message = JSON.parse(line);

    if (handleRootsResponse(message)) {
      return;
    }

    if (message?.method) {
      const response = handleRequest(message);
      if (response) {
        send(response);
      }
      return;
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
