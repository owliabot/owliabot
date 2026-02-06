/**
 * MCPToolAdapter unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the logger
vi.mock("../../../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { MCPToolAdapter, createMCPToolAdapter } from "../adapter.js";
import type { MCPClient } from "../client.js";
import type { MCPToolDefinition, ToolCallResult } from "../types.js";

// Helper to create a mock MCP client
function createMockClient(
  tools: MCPToolDefinition[] = [],
  callToolResult?: ToolCallResult
): MCPClient {
  return {
    name: "test-server",
    isConnected: vi.fn(() => true),
    connect: vi.fn(),
    disconnect: vi.fn(),
    listTools: vi.fn(async () => tools),
    callTool: vi.fn(async () => callToolResult ?? { content: [], isError: false }),
    onToolsChanged: vi.fn(),
    onError: vi.fn(),
  } as unknown as MCPClient;
}

describe("MCPToolAdapter", () => {
  describe("tool name transformation", () => {
    it("prefixes tool names with server name and double underscore", async () => {
      const mockTool: MCPToolDefinition = {
        name: "search",
        description: "Search for items",
        inputSchema: { type: "object", properties: {} },
      };

      const client = createMockClient([mockTool]);
      const adapter = new MCPToolAdapter({ client });

      const tools = await adapter.getTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("test-server__search");
    });

    it("handles multiple tools correctly", async () => {
      const mockTools: MCPToolDefinition[] = [
        { name: "read", description: "Read file", inputSchema: { type: "object" } },
        { name: "write", description: "Write file", inputSchema: { type: "object" } },
        { name: "delete", description: "Delete file", inputSchema: { type: "object" } },
      ];

      const client = createMockClient(mockTools);
      const adapter = new MCPToolAdapter({ client });

      const tools = await adapter.getTools();

      expect(tools.map((t) => t.name)).toEqual([
        "test-server__read",
        "test-server__write",
        "test-server__delete",
      ]);
    });

    it("preserves original tool description", async () => {
      const mockTool: MCPToolDefinition = {
        name: "fetch",
        description: "Fetch data from a URL",
        inputSchema: { type: "object" },
      };

      const client = createMockClient([mockTool]);
      const adapter = new MCPToolAdapter({ client });

      const tools = await adapter.getTools();

      expect(tools[0].description).toBe("Fetch data from a URL");
    });

    it("provides default description when missing", async () => {
      const mockTool: MCPToolDefinition = {
        name: "mystery",
        inputSchema: { type: "object" },
      };

      const client = createMockClient([mockTool]);
      const adapter = new MCPToolAdapter({ client });

      const tools = await adapter.getTools();

      expect(tools[0].description).toContain("mystery");
    });
  });

  describe("security level mapping", () => {
    const securityTestCases = [
      // Read-level (read keywords)
      { toolName: "get_status", expected: "read" },
      { toolName: "list_files", expected: "read" },
      { toolName: "search_items", expected: "read" },
      { toolName: "fetch_data", expected: "read" },
      { toolName: "query_database", expected: "read" },
      { toolName: "check_health", expected: "read" },

      // Write-level (action keywords)
      { toolName: "write_file", expected: "write" },
      { toolName: "create_user", expected: "write" },
      { toolName: "delete_record", expected: "write" },
      { toolName: "remove_item", expected: "write" },
      { toolName: "update_config", expected: "write" },
      { toolName: "set_value", expected: "write" },
      { toolName: "click_button", expected: "write" },
      { toolName: "type_text", expected: "write" },
      { toolName: "fill_form", expected: "write" },
      { toolName: "submit_data", expected: "write" },
      { toolName: "navigate_to", expected: "write" },
      { toolName: "upload_file", expected: "write" },
      { toolName: "send_message", expected: "write" },
      { toolName: "post_comment", expected: "write" },
      { toolName: "put_object", expected: "write" },
      { toolName: "patch_record", expected: "write" },
      { toolName: "execute_command", expected: "write" },
      { toolName: "exec_script", expected: "write" },
      { toolName: "run_task", expected: "write" },
      { toolName: "eval_code", expected: "write" },
      { toolName: "drop_table", expected: "write" },
      { toolName: "truncate_log", expected: "write" },
      { toolName: "modify_settings", expected: "write" },
      { toolName: "insert_row", expected: "write" },
    ];

    it.each(securityTestCases)(
      "maps '$toolName' to '$expected' security level",
      async ({ toolName, expected }) => {
        const mockTool: MCPToolDefinition = {
          name: toolName,
          inputSchema: { type: "object" },
        };

        const client = createMockClient([mockTool]);
        const adapter = new MCPToolAdapter({ client });

        const tools = await adapter.getTools();

        expect(tools[0].security.level).toBe(expected);
      }
    );

    it("respects explicit security overrides", async () => {
      const mockTool: MCPToolDefinition = {
        name: "read_sensitive",
        inputSchema: { type: "object" },
      };

      const client = createMockClient([mockTool]);
      const adapter = new MCPToolAdapter({
        client,
        securityOverrides: {
          "test-server__read_sensitive": {
            level: "sign",
            confirmRequired: true,
          },
        },
      });

      const tools = await adapter.getTools();

      expect(tools[0].security.level).toBe("sign");
      expect(tools[0].security.confirmRequired).toBe(true);
    });

    it("override uses full tool name with server prefix", async () => {
      const mockTool: MCPToolDefinition = {
        name: "action",
        inputSchema: { type: "object" },
      };

      const client = createMockClient([mockTool]);
      // Wrong key - missing prefix
      const adapter = new MCPToolAdapter({
        client,
        securityOverrides: {
          action: { level: "sign" },
        },
      });

      const tools = await adapter.getTools();

      // Should fall back to heuristic (write by default)
      expect(tools[0].security.level).toBe("write");
    });
  });

  describe("schema conversion", () => {
    it("converts MCP input schema to OwliaBot format", async () => {
      const mockTool: MCPToolDefinition = {
        name: "search",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "integer", description: "Max results" },
          },
          required: ["query"],
        },
      };

      const client = createMockClient([mockTool]);
      const adapter = new MCPToolAdapter({ client });

      const tools = await adapter.getTools();

      expect(tools[0].parameters).toEqual({
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results" },
        },
        required: ["query"],
      });
    });

    it("normalizes integer type to number", async () => {
      const mockTool: MCPToolDefinition = {
        name: "count",
        inputSchema: {
          type: "object",
          properties: {
            value: { type: "integer" },
          },
        },
      };

      const client = createMockClient([mockTool]);
      const adapter = new MCPToolAdapter({ client });

      const tools = await adapter.getTools();

      expect(tools[0].parameters.properties.value.type).toBe("number");
    });

    it("handles enum values", async () => {
      const mockTool: MCPToolDefinition = {
        name: "set_mode",
        inputSchema: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["fast", "slow", "normal"] },
          },
        },
      };

      const client = createMockClient([mockTool]);
      const adapter = new MCPToolAdapter({ client });

      const tools = await adapter.getTools();

      expect(tools[0].parameters.properties.mode.enum).toEqual([
        "fast",
        "slow",
        "normal",
      ]);
    });

    it("handles array types with items", async () => {
      const mockTool: MCPToolDefinition = {
        name: "process_list",
        inputSchema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: { type: "string", description: "Item name" },
            },
          },
        },
      };

      const client = createMockClient([mockTool]);
      const adapter = new MCPToolAdapter({ client });

      const tools = await adapter.getTools();

      expect(tools[0].parameters.properties.items).toEqual({
        type: "array",
        items: { type: "string", description: "Item name" },
      });
    });

    it("handles empty properties", async () => {
      const mockTool: MCPToolDefinition = {
        name: "no_args",
        inputSchema: { type: "object" },
      };

      const client = createMockClient([mockTool]);
      const adapter = new MCPToolAdapter({ client });

      const tools = await adapter.getTools();

      expect(tools[0].parameters).toEqual({
        type: "object",
        properties: {},
        required: undefined,
      });
    });
  });

  describe("tool execution", () => {
    it("delegates execution to MCP client", async () => {
      const mockTool: MCPToolDefinition = {
        name: "echo",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
        },
      };

      const callResult: ToolCallResult = {
        content: [{ type: "text", text: "Hello, World!" }],
        isError: false,
      };

      const client = createMockClient([mockTool], callResult);
      const adapter = new MCPToolAdapter({ client });

      const tools = await adapter.getTools();
      const result = await tools[0].execute(
        { message: "Hello" },
        { sessionKey: "test", agentId: "agent", config: {} }
      );

      expect(client.callTool).toHaveBeenCalledWith("echo", { message: "Hello" });
      expect(result.success).toBe(true);
      expect(result.data).toBe("Hello, World!");
    });

    it("handles error results from MCP", async () => {
      const mockTool: MCPToolDefinition = {
        name: "fail",
        inputSchema: { type: "object" },
      };

      const callResult: ToolCallResult = {
        content: [{ type: "text", text: "Something went wrong" }],
        isError: true,
      };

      const client = createMockClient([mockTool], callResult);
      const adapter = new MCPToolAdapter({ client });

      const tools = await adapter.getTools();
      const result = await tools[0].execute(
        {},
        { sessionKey: "test", agentId: "agent", config: {} }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Something went wrong");
    });

    it("handles multiple text content", async () => {
      const mockTool: MCPToolDefinition = {
        name: "multi",
        inputSchema: { type: "object" },
      };

      const callResult: ToolCallResult = {
        content: [
          { type: "text", text: "Line 1" },
          { type: "text", text: "Line 2" },
        ],
        isError: false,
      };

      const client = createMockClient([mockTool], callResult);
      const adapter = new MCPToolAdapter({ client });

      const tools = await adapter.getTools();
      const result = await tools[0].execute(
        {},
        { sessionKey: "test", agentId: "agent", config: {} }
      );

      expect(result.data).toBe("Line 1\nLine 2");
    });

    it("handles image content", async () => {
      const mockTool: MCPToolDefinition = {
        name: "screenshot",
        inputSchema: { type: "object" },
      };

      const callResult: ToolCallResult = {
        content: [
          { type: "image", data: "base64data", mimeType: "image/png" },
        ],
        isError: false,
      };

      const client = createMockClient([mockTool], callResult);
      const adapter = new MCPToolAdapter({ client });

      const tools = await adapter.getTools();
      const result = await tools[0].execute(
        {},
        { sessionKey: "test", agentId: "agent", config: {} }
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        text: "",
        images: [{ data: "base64data", mimeType: "image/png" }],
      });
    });

    it("respects timeout", async () => {
      const mockTool: MCPToolDefinition = {
        name: "slow",
        inputSchema: { type: "object" },
      };

      const client = createMockClient([mockTool]);
      // Make callTool take forever
      (client.callTool as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const adapter = new MCPToolAdapter({ client, timeout: 50 });

      const tools = await adapter.getTools();
      const result = await tools[0].execute(
        {},
        { sessionKey: "test", agentId: "agent", config: {} }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("timeout");
    });
  });

  describe("caching", () => {
    it("caches tool list after first call", async () => {
      const mockTool: MCPToolDefinition = {
        name: "cached",
        inputSchema: { type: "object" },
      };

      const client = createMockClient([mockTool]);
      const adapter = new MCPToolAdapter({ client });

      await adapter.getTools();
      await adapter.getTools();
      await adapter.getTools();

      expect(client.listTools).toHaveBeenCalledTimes(1);
    });

    it("invalidateCache forces re-fetch", async () => {
      const mockTool: MCPToolDefinition = {
        name: "cached",
        inputSchema: { type: "object" },
      };

      const client = createMockClient([mockTool]);
      const adapter = new MCPToolAdapter({ client });

      await adapter.getTools();
      adapter.invalidateCache();
      await adapter.getTools();

      expect(client.listTools).toHaveBeenCalledTimes(2);
    });
  });
});

describe("createMCPToolAdapter", () => {
  it("creates adapter with client", () => {
    const client = createMockClient([]);
    const adapter = createMCPToolAdapter(client);

    expect(adapter).toBeInstanceOf(MCPToolAdapter);
  });

  it("passes options through", async () => {
    const client = createMockClient([
      { name: "test", inputSchema: { type: "object" } },
    ]);

    const adapter = createMCPToolAdapter(client, {
      securityOverrides: {
        "test-server__test": { level: "sign" },
      },
      timeout: 5000,
    });

    const tools = await adapter.getTools();
    expect(tools[0].security.level).toBe("sign");
  });
});
