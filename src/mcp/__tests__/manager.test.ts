/**
 * MCP Manager Tests
 *
 * Tests the MCPManager class for dynamic server management:
 * - Adding servers at runtime
 * - Removing servers
 * - Listing servers and tools
 * - Refreshing server tools
 * - Error handling
 * - Event callbacks
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { MCPManager, createMCPManager } from "../manager.js";
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

describe.sequential("MCPManager", () => {
  let manager: MCPManager;

  beforeEach(() => {
    manager = new MCPManager();
  });

  afterEach(async () => {
    await manager.close();
  });

  describe("addServer", () => {
    it("adds a server and returns tool names", async () => {
      const toolNames = await manager.addServer(mockServerConfig);

      expect(toolNames).toHaveLength(4);
      expect(toolNames).toContain("mock__echo");
      expect(toolNames).toContain("mock__add");
      expect(toolNames).toContain("mock__fail");
      expect(toolNames).toContain("mock__slow");
    });

    it("rejects duplicate server names", async () => {
      await manager.addServer(mockServerConfig);

      await expect(manager.addServer(mockServerConfig)).rejects.toThrow(
        'Server "mock" already exists'
      );
    });

    it("validates server configuration", async () => {
      await expect(
        manager.addServer({
          name: "invalid",
          transport: "stdio",
          // Missing required 'command' for stdio
        } as MCPServerConfig)
      ).rejects.toThrow();
    });

    it("handles connection failures gracefully", async () => {
      await expect(
        manager.addServer({
          name: "bad",
          command: "nonexistent-command-that-does-not-exist",
          transport: "stdio",
        })
      ).rejects.toThrow();

      // Server should not be added on failure
      expect(manager.hasServer("bad")).toBe(false);
    });
  });

  describe("removeServer", () => {
    it("removes an existing server", async () => {
      await manager.addServer(mockServerConfig);
      expect(manager.hasServer("mock")).toBe(true);

      await manager.removeServer("mock");
      expect(manager.hasServer("mock")).toBe(false);
    });

    it("throws when removing non-existent server", async () => {
      await expect(manager.removeServer("nonexistent")).rejects.toThrow(
        'Server "nonexistent" not found'
      );
    });

    it("removes tools when server is removed", async () => {
      await manager.addServer(mockServerConfig);
      expect(manager.getTools().length).toBe(4);

      await manager.removeServer("mock");
      expect(manager.getTools().length).toBe(0);
    });
  });

  describe("listServers", () => {
    it("returns empty array when no servers", () => {
      const servers = manager.listServers();
      expect(servers).toHaveLength(0);
    });

    it("returns server info for connected servers", async () => {
      await manager.addServer(mockServerConfig);

      const servers = manager.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe("mock");
      expect(servers[0].connected).toBe(true);
      expect(servers[0].toolCount).toBe(4);
      expect(servers[0].tools).toContain("mock__echo");
      expect(servers[0].addedAt).toBeInstanceOf(Date);
    });

    it("lists multiple servers", async () => {
      await manager.addServer({ ...mockServerConfig, name: "server1" });
      await manager.addServer({ ...mockServerConfig, name: "server2" });

      const servers = manager.listServers();
      expect(servers).toHaveLength(2);
      expect(servers.map((s) => s.name)).toContain("server1");
      expect(servers.map((s) => s.name)).toContain("server2");
    });
  });

  describe("getTools", () => {
    it("returns empty array when no servers", () => {
      const tools = manager.getTools();
      expect(tools).toHaveLength(0);
    });

    it("returns all tools from all servers", async () => {
      await manager.addServer({ ...mockServerConfig, name: "server1" });
      await manager.addServer({ ...mockServerConfig, name: "server2" });

      const tools = manager.getTools();
      expect(tools).toHaveLength(8); // 4 tools × 2 servers
      expect(tools.some((t) => t.name === "server1__echo")).toBe(true);
      expect(tools.some((t) => t.name === "server2__echo")).toBe(true);
    });

    it("caches tools", async () => {
      await manager.addServer(mockServerConfig);

      const tools1 = manager.getTools();
      const tools2 = manager.getTools();

      expect(tools1).toBe(tools2); // Same array reference (cached)
    });

    it("invalidates cache on server add", async () => {
      await manager.addServer({ ...mockServerConfig, name: "server1" });
      const tools1 = manager.getTools();

      await manager.addServer({ ...mockServerConfig, name: "server2" });
      const tools2 = manager.getTools();

      expect(tools1).not.toBe(tools2);
      expect(tools2.length).toBe(8);
    });

    it("invalidates cache on server remove", async () => {
      await manager.addServer({ ...mockServerConfig, name: "server1" });
      await manager.addServer({ ...mockServerConfig, name: "server2" });
      const tools1 = manager.getTools();

      await manager.removeServer("server1");
      const tools2 = manager.getTools();

      expect(tools1).not.toBe(tools2);
      expect(tools2.length).toBe(4);
    });
  });

  describe("refreshServer", () => {
    it("refreshes server tools", async () => {
      await manager.addServer(mockServerConfig);
      const initialTools = manager.getTools();

      await manager.refreshServer("mock");
      const refreshedTools = manager.getTools();

      // Should be different array (cache invalidated)
      expect(initialTools).not.toBe(refreshedTools);
      // Same content
      expect(refreshedTools.length).toBe(4);
    });

    it("throws when refreshing non-existent server", async () => {
      await expect(manager.refreshServer("nonexistent")).rejects.toThrow(
        'Server "nonexistent" not found'
      );
    });
  });

  describe("close", () => {
    it("closes all connections", async () => {
      await manager.addServer({ ...mockServerConfig, name: "server1" });
      await manager.addServer({ ...mockServerConfig, name: "server2" });

      expect(manager.serverCount).toBe(2);

      await manager.close();

      expect(manager.serverCount).toBe(0);
      expect(manager.getTools().length).toBe(0);
    });

    it("is idempotent", async () => {
      await manager.addServer(mockServerConfig);
      await manager.close();
      await manager.close(); // Should not throw
    });
  });

  describe("onToolsChanged", () => {
    it("notifies when server is added", async () => {
      let callCount = 0;
      let lastTools: unknown[] = [];

      manager.onToolsChanged((tools) => {
        callCount++;
        lastTools = tools;
      });

      await manager.addServer(mockServerConfig);

      expect(callCount).toBe(1);
      expect(lastTools.length).toBe(4);
    });

    it("notifies when server is removed", async () => {
      await manager.addServer(mockServerConfig);

      let callCount = 0;
      manager.onToolsChanged(() => {
        callCount++;
      });

      await manager.removeServer("mock");

      expect(callCount).toBe(1);
    });

    it("allows unsubscription", async () => {
      let callCount = 0;

      const unsubscribe = manager.onToolsChanged(() => {
        callCount++;
      });

      await manager.addServer({ ...mockServerConfig, name: "server1" });
      expect(callCount).toBe(1);

      unsubscribe();

      await manager.addServer({ ...mockServerConfig, name: "server2" });
      expect(callCount).toBe(1); // Not called again
    });
  });

  describe("hasServer", () => {
    it("returns false for non-existent server", () => {
      expect(manager.hasServer("mock")).toBe(false);
    });

    it("returns true for existing server", async () => {
      await manager.addServer(mockServerConfig);
      expect(manager.hasServer("mock")).toBe(true);
    });
  });

  describe("serverCount", () => {
    it("returns 0 initially", () => {
      expect(manager.serverCount).toBe(0);
    });

    it("returns correct count", async () => {
      await manager.addServer({ ...mockServerConfig, name: "server1" });
      expect(manager.serverCount).toBe(1);

      await manager.addServer({ ...mockServerConfig, name: "server2" });
      expect(manager.serverCount).toBe(2);

      await manager.removeServer("server1");
      expect(manager.serverCount).toBe(1);
    });
  });
});

describe("createMCPManager factory", () => {
  it("creates a manager instance", () => {
    const manager = createMCPManager();
    expect(manager).toBeInstanceOf(MCPManager);
  });

  it("accepts options", async () => {
    const manager = createMCPManager({
      defaults: {
        timeout: 5000,
        connectTimeout: 3000,
        restartOnCrash: false,
        maxRestarts: 1,
        restartDelay: 500,
      },
    });

    // Should work with options
    await manager.addServer(mockServerConfig);
    expect(manager.serverCount).toBe(1);

    await manager.close();
  });
});
