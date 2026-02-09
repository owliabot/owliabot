/**
 * Tests for device scope enforcement
 *
 * @see docs/plans/gateway-unification.md Section 2.3
 */

import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";
import { testConfig, createMockResources } from "./test-helpers.js";

describe("scope enforcement", () => {
  describe("tool scope levels", () => {
    it("allows read-only tools with tools:read scope", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      // Approve device with read scope
      const approve = await fetch(server.baseUrl + "/admin/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({
          deviceId: "dev-read",
          scope: { tools: "read", system: false, mcp: false },
        }),
      });
      const { data }: any = await approve.json();

      // Call a read-only tool
      const res = await fetch(server.baseUrl + "/command/tool", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Device-Id": "dev-read",
          "X-Device-Token": data.deviceToken,
        },
        body: JSON.stringify({
          payload: {
            toolCalls: [{ id: "1", name: "test_read", arguments: {} }],
          },
        }),
      });

      const json: any = await res.json();
      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.results[0].success).toBe(true);

      await server.stop();
    });

    it("blocks write tools with tools:read scope", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      // Approve device with read scope
      const approve = await fetch(server.baseUrl + "/admin/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({
          deviceId: "dev-read",
          scope: { tools: "read", system: false, mcp: false },
        }),
      });
      const { data }: any = await approve.json();

      // Try to call a write tool
      const res = await fetch(server.baseUrl + "/command/tool", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Device-Id": "dev-read",
          "X-Device-Token": data.deviceToken,
        },
        body: JSON.stringify({
          payload: {
            toolCalls: [
              { id: "1", name: "edit_file", arguments: { path: "/test", content: "x" } },
            ],
          },
        }),
      });

      const json: any = await res.json();
      expect(res.status).toBe(403);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("ERR_SCOPE_INSUFFICIENT_TOOLS");

      await server.stop();
    });

    it("allows write tools with tools:write scope", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      // Approve device with write scope
      const approve = await fetch(server.baseUrl + "/admin/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({
          deviceId: "dev-write",
          scope: { tools: "write", system: false, mcp: false },
        }),
      });
      const { data }: any = await approve.json();

      // Call a write tool
      const res = await fetch(server.baseUrl + "/command/tool", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Device-Id": "dev-write",
          "X-Device-Token": data.deviceToken,
        },
        body: JSON.stringify({
          payload: {
            toolCalls: [
              { id: "1", name: "edit_file", arguments: { path: "/test", content: "x" } },
            ],
          },
        }),
      });

      const json: any = await res.json();
      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.results[0].success).toBe(true);

      await server.stop();
    });

    it("blocks sign tools with tools:write scope", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      // Approve device with write scope
      const approve = await fetch(server.baseUrl + "/admin/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({
          deviceId: "dev-write",
          scope: { tools: "write", system: false, mcp: false },
        }),
      });
      const { data }: any = await approve.json();

      // Try to call a sign tool (tier2)
      const res = await fetch(server.baseUrl + "/command/tool", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Device-Id": "dev-write",
          "X-Device-Token": data.deviceToken,
        },
        body: JSON.stringify({
          payload: {
            toolCalls: [
              { id: "1", name: "wallet_transfer", arguments: { amount: 10, to: "addr" } },
            ],
          },
        }),
      });

      const json: any = await res.json();
      expect(res.status).toBe(403);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("ERR_SCOPE_INSUFFICIENT_TOOLS");

      await server.stop();
    });

    it("allows sign tools with tools:sign scope", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      // Approve device with sign scope
      const approve = await fetch(server.baseUrl + "/admin/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({
          deviceId: "dev-sign",
          scope: { tools: "sign", system: false, mcp: false },
        }),
      });
      const { data }: any = await approve.json();

      // Call a sign tool
      const res = await fetch(server.baseUrl + "/command/tool", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Device-Id": "dev-sign",
          "X-Device-Token": data.deviceToken,
        },
        body: JSON.stringify({
          payload: {
            toolCalls: [
              { id: "1", name: "wallet_transfer", arguments: { amount: 10, to: "addr" } },
            ],
          },
        }),
      });

      const json: any = await res.json();
      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.results[0].success).toBe(true);

      await server.stop();
    });

    it("blocks unknown/unregistered tools (fail-closed)", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      // Approve device with full sign scope
      const approve = await fetch(server.baseUrl + "/admin/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({
          deviceId: "dev-sign",
          scope: { tools: "sign", system: false, mcp: false },
        }),
      });
      const { data }: any = await approve.json();

      // Try to call a tool that is NOT registered in ToolRegistry
      const res = await fetch(server.baseUrl + "/command/tool", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Device-Id": "dev-sign",
          "X-Device-Token": data.deviceToken,
        },
        body: JSON.stringify({
          payload: {
            toolCalls: [{ id: "1", name: "some_write_tool_not_registered", arguments: {} }],
          },
        }),
      });

      const json: any = await res.json();
      expect(res.status).toBe(403);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("ERR_UNKNOWN_TOOL");

      await server.stop();
    });

    it("blocks write-capable tool for device with tools:read scope", async () => {
      const resources = createMockResources();
      // Register a write tool with a non-hardcoded name
      resources.toolRegistry.register({
        name: "deploy_contract",
        description: "Deploy a smart contract",
        parameters: { type: "object", properties: {}, required: [] },
        security: { level: "write" },
        execute: async () => ({ success: true, data: { result: "deployed" } }),
      });

      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      // Approve device with read-only scope
      const approve = await fetch(server.baseUrl + "/admin/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({
          deviceId: "dev-read",
          scope: { tools: "read", system: false, mcp: false },
        }),
      });
      const { data }: any = await approve.json();

      // Try to call the write tool
      const res = await fetch(server.baseUrl + "/command/tool", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Device-Id": "dev-read",
          "X-Device-Token": data.deviceToken,
        },
        body: JSON.stringify({
          payload: {
            toolCalls: [{ id: "1", name: "deploy_contract", arguments: {} }],
          },
        }),
      });

      const json: any = await res.json();
      expect(res.status).toBe(403);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("ERR_SCOPE_INSUFFICIENT_TOOLS");

      await server.stop();
    });
  });

  describe("system scope", () => {
    it("blocks /command/system without system scope", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      // Approve device without system scope
      const approve = await fetch(server.baseUrl + "/admin/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({
          deviceId: "dev-nosys",
          scope: { tools: "read", system: false, mcp: false },
        }),
      });
      const { data }: any = await approve.json();

      // Try system command
      const res = await fetch(server.baseUrl + "/command/system", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Device-Id": "dev-nosys",
          "X-Device-Token": data.deviceToken,
        },
        body: JSON.stringify({ action: "exec", command: "ls" }),
      });

      const json: any = await res.json();
      expect(res.status).toBe(403);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("ERR_SCOPE_INSUFFICIENT_SYSTEM");

      await server.stop();
    });
  });

  describe("mcp scope", () => {
    it("blocks /mcp without mcp scope", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      // Approve device without mcp scope
      const approve = await fetch(server.baseUrl + "/admin/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({
          deviceId: "dev-nomcp",
          scope: { tools: "read", system: false, mcp: false },
        }),
      });
      const { data }: any = await approve.json();

      // Try MCP request
      const res = await fetch(server.baseUrl + "/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Device-Id": "dev-nomcp",
          "X-Device-Token": data.deviceToken,
        },
        body: JSON.stringify({ method: "tools/list" }),
      });

      const json: any = await res.json();
      expect(res.status).toBe(403);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("ERR_SCOPE_INSUFFICIENT_MCP");

      await server.stop();
    });

    it("returns 501 for /mcp with mcp scope (stub)", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      // Approve device with mcp scope
      const approve = await fetch(server.baseUrl + "/admin/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({
          deviceId: "dev-mcp",
          scope: { tools: "read", system: false, mcp: true },
        }),
      });
      const { data }: any = await approve.json();

      // Try MCP request (should return 501 Not Implemented)
      const res = await fetch(server.baseUrl + "/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Device-Id": "dev-mcp",
          "X-Device-Token": data.deviceToken,
        },
        body: JSON.stringify({ method: "tools/list" }),
      });

      const json: any = await res.json();
      expect(res.status).toBe(501);
      expect(json.error.code).toBe("ERR_NOT_IMPLEMENTED");

      await server.stop();
    });
  });
});
