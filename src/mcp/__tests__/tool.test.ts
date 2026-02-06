/**
 * MCP Management Tool Tests
 *
 * Tests the mcp_manage tool that allows agents to dynamically manage MCP servers:
 * - List action
 * - Add action
 * - Remove action
 * - Refresh action
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { MCPManager } from "../manager.js";
import { createMCPManageTool } from "../tool.js";
import type { ToolDefinition, ToolContext, ToolResult } from "../../agent/tools/interface.js";
import type { MCPServerConfig } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_SERVER_PATH = join(__dirname, "mock-mcp-server.mjs");

// Test context
const mockContext: ToolContext = {
  sessionKey: "test-session",
  agentId: "test-agent",
  signer: null,
  config: {},
};

// Helper to get result data
function getData(result: ToolResult): Record<string, unknown> {
  return result.data as Record<string, unknown>;
}

describe.sequential("mcp_manage tool", () => {
  let manager: MCPManager;
  let tool: ToolDefinition;

  beforeEach(() => {
    manager = new MCPManager();
    tool = createMCPManageTool(manager);
  });

  afterEach(async () => {
    await manager.close();
  });

  describe("tool definition", () => {
    it("has correct name and description", () => {
      expect(tool.name).toBe("mcp_manage");
      expect(tool.description).toContain("MCP");
      expect(tool.description).toContain("list");
      expect(tool.description).toContain("add");
      expect(tool.description).toContain("remove");
      expect(tool.description).toContain("refresh");
    });

    it("has correct security level", () => {
      expect(tool.security.level).toBe("write");
    });

    it("requires confirmation for security", () => {
      expect(tool.security.confirmRequired).toBe(true);
    });

    it("has required parameters", () => {
      expect(tool.parameters.required).toContain("action");
    });
  });

  describe("list action", () => {
    it("returns empty list when no servers", async () => {
      const result = await tool.execute({ action: "list" }, mockContext);

      expect(result.success).toBe(true);
      const data = getData(result);
      expect(data.servers).toEqual([]);
      expect(data.totalTools).toBe(0);
      expect(data.message).toContain("No MCP servers");
    });

    it("returns server info when servers connected", async () => {
      await manager.addServer({
        name: "mock",
        command: "node",
        args: [MOCK_SERVER_PATH],
        transport: "stdio",
      });

      const result = await tool.execute({ action: "list" }, mockContext);

      expect(result.success).toBe(true);
      const data = getData(result);
      expect((data.servers as unknown[]).length).toBe(1);
      expect(data.totalTools).toBe(4);

      const server = (data.servers as Record<string, unknown>[])[0];
      expect(server.name).toBe("mock");
      expect(server.connected).toBe(true);
      expect(server.toolCount).toBe(4);
      expect((server.tools as string[]).length).toBe(4);
    });
  });

  describe("add action", () => {
    it("adds a server successfully", async () => {
      const result = await tool.execute(
        {
          action: "add",
          name: "mock",
          command: "node",
          args: [MOCK_SERVER_PATH],
        },
        mockContext
      );

      expect(result.success).toBe(true);
      const data = getData(result);
      expect(data.serverName).toBe("mock");
      expect(data.toolCount).toBe(4);
      expect((data.tools as string[]).length).toBe(4);
      expect(data.message).toContain("Added MCP server");
    });

    it("fails with invalid configuration", async () => {
      const result = await tool.execute(
        {
          action: "add",
          name: "invalid",
          transport: "stdio",
          // Missing command
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("fails when server already exists", async () => {
      await manager.addServer({
        name: "mock",
        command: "node",
        args: [MOCK_SERVER_PATH],
        transport: "stdio",
      });

      const result = await tool.execute(
        {
          action: "add",
          name: "mock",
          command: "node",
          args: [MOCK_SERVER_PATH],
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("already exists");
    });

    it("fails with connection error", async () => {
      const result = await tool.execute(
        {
          action: "add",
          name: "bad",
          command: "nonexistent-command-xyz",
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to add server");
    });
  });

  describe("remove action", () => {
    it("removes a server successfully", async () => {
      await manager.addServer({
        name: "mock",
        command: "node",
        args: [MOCK_SERVER_PATH],
        transport: "stdio",
      });

      const result = await tool.execute(
        { action: "remove", name: "mock" },
        mockContext
      );

      expect(result.success).toBe(true);
      const data = getData(result);
      expect(data.serverName).toBe("mock");
      expect(data.message).toContain("Removed");

      expect(manager.hasServer("mock")).toBe(false);
    });

    it("fails when server not found", async () => {
      const result = await tool.execute(
        { action: "remove", name: "nonexistent" },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("refresh action", () => {
    it("refreshes a server successfully", async () => {
      await manager.addServer({
        name: "mock",
        command: "node",
        args: [MOCK_SERVER_PATH],
        transport: "stdio",
      });

      const result = await tool.execute(
        { action: "refresh", name: "mock" },
        mockContext
      );

      expect(result.success).toBe(true);
      const data = getData(result);
      expect(data.serverName).toBe("mock");
      expect(data.toolCount).toBe(4);
      expect(data.message).toContain("Refreshed");
    });

    it("fails when server not found", async () => {
      const result = await tool.execute(
        { action: "refresh", name: "nonexistent" },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("parameter validation", () => {
    it("fails with missing action", async () => {
      const result = await tool.execute({}, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid parameters");
    });

    it("fails with invalid action", async () => {
      const result = await tool.execute({ action: "invalid" }, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid");
    });

    it("fails with missing name for add", async () => {
      const result = await tool.execute(
        { action: "add", command: "node" },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid parameters");
    });

    it("fails with missing name for remove", async () => {
      const result = await tool.execute({ action: "remove" }, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid parameters");
    });
  });
});

describe("mcp_manage E2E workflow", () => {
  let manager: MCPManager;
  let tool: ToolDefinition;

  beforeEach(() => {
    manager = new MCPManager();
    tool = createMCPManageTool(manager);
  });

  afterEach(async () => {
    await manager.close();
  });

  it("completes full lifecycle: add → list → refresh → remove → list", async () => {
    // 1. Add server
    const addResult = await tool.execute(
      {
        action: "add",
        name: "mock",
        command: "node",
        args: [MOCK_SERVER_PATH],
      },
      mockContext
    );
    expect(addResult.success).toBe(true);
    expect(getData(addResult).toolCount).toBe(4);

    // 2. List servers
    const listResult1 = await tool.execute({ action: "list" }, mockContext);
    expect(listResult1.success).toBe(true);
    expect((getData(listResult1).servers as unknown[]).length).toBe(1);

    // 3. Refresh server
    const refreshResult = await tool.execute(
      { action: "refresh", name: "mock" },
      mockContext
    );
    expect(refreshResult.success).toBe(true);

    // 4. Remove server
    const removeResult = await tool.execute(
      { action: "remove", name: "mock" },
      mockContext
    );
    expect(removeResult.success).toBe(true);

    // 5. List servers (should be empty)
    const listResult2 = await tool.execute({ action: "list" }, mockContext);
    expect(listResult2.success).toBe(true);
    expect((getData(listResult2).servers as unknown[]).length).toBe(0);
  });

  it("handles multiple servers", async () => {
    // Add two servers
    await tool.execute(
      {
        action: "add",
        name: "server1",
        command: "node",
        args: [MOCK_SERVER_PATH],
      },
      mockContext
    );

    await tool.execute(
      {
        action: "add",
        name: "server2",
        command: "node",
        args: [MOCK_SERVER_PATH],
      },
      mockContext
    );

    // List should show both
    const listResult = await tool.execute({ action: "list" }, mockContext);
    expect(listResult.success).toBe(true);
    expect((getData(listResult).servers as unknown[]).length).toBe(2);
    expect(getData(listResult).totalTools).toBe(8);

    // Remove one
    await tool.execute({ action: "remove", name: "server1" }, mockContext);

    // List should show one
    const listResult2 = await tool.execute({ action: "list" }, mockContext);
    expect((getData(listResult2).servers as unknown[]).length).toBe(1);
    expect(getData(listResult2).totalTools).toBe(4);
  });
});
