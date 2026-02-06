/**
 * MCP E2E Tests
 * 
 * Tests the full MCP integration flow using a mock MCP server:
 * - Client connection and protocol handshake
 * - Tool discovery (tools/list)
 * - Tool execution (tools/call)
 * - Adapter transformation to OwliaBot format
 * - Error handling and timeouts
 * - Graceful shutdown
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createMCPClient, MCPClient } from "../client.js";
import { createMCPToolAdapter, MCPToolAdapter } from "../adapter.js";
import { createMCPTools, type CreateMCPToolsResult } from "../index.js";
import type { MCPServerConfig } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_SERVER_PATH = join(__dirname, "mock-mcp-server.mjs");

// Test server configuration
const mockServerConfig: MCPServerConfig = {
  name: "mock",
  command: "node",
  args: [MOCK_SERVER_PATH],
  transport: "stdio",
};

describe.sequential("MCP E2E: Client", () => {
  let client: MCPClient;

  afterEach(async () => {
    if (client?.isConnected()) {
      await client.close();
    }
  });

  it("connects to MCP server and completes handshake", async () => {
    client = await createMCPClient(mockServerConfig);

    expect(client.isConnected()).toBe(true);
    expect(client.name).toBe("mock");
    expect(client.capabilities).toBeDefined();
    expect(client.capabilities?.tools).toBeDefined();
  });

  it("retrieves tool list from server", async () => {
    client = await createMCPClient(mockServerConfig);
    const tools = await client.listTools();

    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.name)).toContain("echo");
    expect(tools.map((t) => t.name)).toContain("add");
    expect(tools.map((t) => t.name)).toContain("fail");
    expect(tools.map((t) => t.name)).toContain("slow");
  });

  it("caches tool list on subsequent calls", async () => {
    client = await createMCPClient(mockServerConfig);

    const tools1 = await client.listTools();
    const tools2 = await client.listTools();

    // Should be the same cached array
    expect(tools1).toBe(tools2);
  });

  it("calls echo tool successfully", async () => {
    client = await createMCPClient(mockServerConfig);
    const result = await client.callTool("echo", { message: "Hello, MCP!" });

    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect((result.content[0] as { type: "text"; text: string }).text).toBe(
      "Hello, MCP!"
    );
  });

  it("calls add tool successfully", async () => {
    client = await createMCPClient(mockServerConfig);
    const result = await client.callTool("add", { a: 10, b: 32 });

    expect(result.isError).toBe(false);
    expect((result.content[0] as { type: "text"; text: string }).text).toBe("42");
  });

  it("handles tool error result", async () => {
    client = await createMCPClient(mockServerConfig);
    const result = await client.callTool("fail", {});

    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: "text"; text: string }).text).toContain(
      "Intentional failure"
    );
  });

  it("closes connection gracefully", async () => {
    client = await createMCPClient(mockServerConfig);
    expect(client.isConnected()).toBe(true);

    await client.close();
    expect(client.isConnected()).toBe(false);
  });
});

describe.sequential("MCP E2E: Adapter", () => {
  let client: MCPClient;
  let adapter: MCPToolAdapter;

  beforeAll(async () => {
    client = await createMCPClient(mockServerConfig);
    adapter = createMCPToolAdapter(client);
  });

  afterAll(async () => {
    await client.close();
  });

  it("transforms MCP tools to OwliaBot format", async () => {
    const tools = await adapter.getTools();

    expect(tools).toHaveLength(4);

    // Check tool name transformation
    const echoTool = tools.find((t) => t.name === "mock__echo");
    expect(echoTool).toBeDefined();
    expect(echoTool?.description).toBe("Echoes the input message back");

    // Check parameter schema transformation
    expect(echoTool?.parameters.type).toBe("object");
    expect(echoTool?.parameters.properties?.message).toBeDefined();
    expect(echoTool?.parameters.required).toContain("message");
  });

  it("applies correct security levels based on heuristics", async () => {
    const tools = await adapter.getTools();

    // echo/add/fail/slow should all be "write" level (unknown tools default to write)
    for (const tool of tools) {
      expect(tool.security.level).toBe("write");
    }
  });

  it("executes tool through adapter and returns OwliaBot result", async () => {
    const tools = await adapter.getTools();
    const echoTool = tools.find((t) => t.name === "mock__echo")!;

    const result = await echoTool.execute(
      { message: "Adapter test" },
      { sessionKey: "test", agentId: "e2e", config: {} }
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe("Adapter test");
  });

  it("handles tool errors in adapter format", async () => {
    const tools = await adapter.getTools();
    const failTool = tools.find((t) => t.name === "mock__fail")!;

    const result = await failTool.execute(
      {},
      { sessionKey: "test", agentId: "e2e", config: {} }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Intentional failure");
  });
});

describe.sequential("MCP E2E: createMCPTools factory", () => {
  let mcpResult: CreateMCPToolsResult;

  afterEach(async () => {
    if (mcpResult) {
      await mcpResult.close();
    }
  });

  it("creates tools from server configuration", async () => {
    mcpResult = await createMCPTools({
      servers: [mockServerConfig],
    });

    expect(mcpResult.tools).toHaveLength(4);
    expect(mcpResult.clients.size).toBe(1);
    expect(mcpResult.adapters.size).toBe(1);
    expect(mcpResult.failed).toHaveLength(0);
  });

  it("applies security overrides", async () => {
    mcpResult = await createMCPTools({
      servers: [mockServerConfig],
      securityOverrides: {
        mock__echo: { level: "write", confirmRequired: true },
      },
    });

    const echoTool = mcpResult.tools.find((t) => t.name === "mock__echo");
    expect(echoTool?.security.level).toBe("write");
    expect(echoTool?.security.confirmRequired).toBe(true);
  });

  it("refreshTools reloads from server", async () => {
    mcpResult = await createMCPTools({
      servers: [mockServerConfig],
    });

    const initialTools = mcpResult.tools;
    const refreshedTools = await mcpResult.refreshTools();

    // Should be new array (cache invalidated)
    expect(refreshedTools).not.toBe(initialTools);
    expect(refreshedTools).toHaveLength(4);
  });

  it("handles server connection failure gracefully", async () => {
    mcpResult = await createMCPTools({
      servers: [
        {
          name: "nonexistent",
          command: "nonexistent-command-that-does-not-exist",
          transport: "stdio",
        },
      ],
    });

    expect(mcpResult.tools).toHaveLength(0);
    expect(mcpResult.failed).toHaveLength(1);
    expect(mcpResult.failed[0].name).toBe("nonexistent");
  });

  it("connects to multiple servers", async () => {
    // Create two instances of the same mock server with different names
    mcpResult = await createMCPTools({
      servers: [
        { ...mockServerConfig, name: "server1" },
        { ...mockServerConfig, name: "server2" },
      ],
    });

    expect(mcpResult.clients.size).toBe(2);
    expect(mcpResult.tools).toHaveLength(8); // 4 tools × 2 servers

    // Check tool naming
    expect(mcpResult.tools.some((t) => t.name === "server1__echo")).toBe(true);
    expect(mcpResult.tools.some((t) => t.name === "server2__echo")).toBe(true);
  });

  it("close() disconnects all clients", async () => {
    mcpResult = await createMCPTools({
      servers: [mockServerConfig],
    });

    const client = mcpResult.clients.get("mock")!;
    expect(client.isConnected()).toBe(true);

    await mcpResult.close();

    expect(client.isConnected()).toBe(false);
    expect(mcpResult.clients.size).toBe(0);
  });

  it("returns empty result for empty config", async () => {
    mcpResult = await createMCPTools({ servers: [] });

    expect(mcpResult.tools).toHaveLength(0);
    expect(mcpResult.clients.size).toBe(0);
    expect(mcpResult.failed).toHaveLength(0);
  });
});

describe.sequential("MCP E2E: Timeout handling", () => {
  let mcpResult: CreateMCPToolsResult;

  afterEach(async () => {
    if (mcpResult) {
      await mcpResult.close();
    }
  });

  it("tool call times out when server is slow", async () => {
    mcpResult = await createMCPTools({
      servers: [mockServerConfig],
      defaults: {
        timeout: 100, // 100ms timeout
      },
    });

    const slowTool = mcpResult.tools.find((t) => t.name === "mock__slow")!;

    // Request 500ms delay, but timeout is 100ms
    const result = await slowTool.execute(
      { delayMs: 500 },
      { sessionKey: "test", agentId: "e2e", config: {} }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("timeout");
  });

  it("tool call succeeds within timeout", async () => {
    mcpResult = await createMCPTools({
      servers: [mockServerConfig],
      defaults: {
        timeout: 2000, // 2s timeout
      },
    });

    const slowTool = mcpResult.tools.find((t) => t.name === "mock__slow")!;

    // Request 100ms delay, timeout is 2s
    const result = await slowTool.execute(
      { delayMs: 100 },
      { sessionKey: "test", agentId: "e2e", config: {} }
    );

    expect(result.success).toBe(true);
    expect(result.data).toContain("100ms");
  });
});
