import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";
import { testConfig, createMockResources } from "./test-helpers.js";

/** Approve device with specific scope */
async function approve(baseUrl: string, deviceId: string, scope: any) {
  const res = await fetch(baseUrl + "/admin/approve", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
    body: JSON.stringify({ deviceId, scope }),
  });
  const json: any = await res.json();
  return json.data.deviceToken as string;
}

describe("P0 #1: MCP scope bypass via /command/tool", () => {
  it("returns 403 when device without mcp scope calls MCP tool via /command/tool", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({ config: testConfig, ...resources });
    const token = await approve(server.baseUrl, "dev1", { tools: "read", system: false, mcp: false });

    const res = await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-id": "dev1",
        "x-device-token": token,
      },
      body: JSON.stringify({
        payload: { toolCalls: [{ id: "1", name: "myserver__read_data", arguments: {} }] },
      }),
    });

    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.error.code).toContain("MCP");
    await server.stop();
  });

  it("allows MCP tool via /command/tool when device has mcp scope", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({ config: testConfig, ...resources });
    const token = await approve(server.baseUrl, "dev2", { tools: "read", system: false, mcp: true });

    const res = await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-id": "dev2",
        "x-device-token": token,
      },
      body: JSON.stringify({
        payload: { toolCalls: [{ id: "1", name: "myserver__read_data", arguments: {} }] },
      }),
    });

    expect(res.status).toBe(200);
    await server.stop();
  });
});

describe("P0 #2: Missing tool-level scope in /mcp tools/call", () => {
  it("returns JSON-RPC error when device with read scope calls write-level MCP tool", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({ config: testConfig, ...resources });
    const token = await approve(server.baseUrl, "dev3", { tools: "read", system: false, mcp: true });

    const res = await fetch(server.baseUrl + "/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-id": "dev3",
        "x-device-token": token,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: { name: "myserver__write_data", arguments: {} },
      }),
    });

    const json: any = await res.json();
    expect(json.jsonrpc).toBe("2.0");
    expect(json.id).toBe(42);
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe(-32603);
    await server.stop();
  });

  it("allows write-level MCP tool when device has write scope", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({ config: testConfig, ...resources });
    const token = await approve(server.baseUrl, "dev4", { tools: "write", system: false, mcp: true });

    const res = await fetch(server.baseUrl + "/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-id": "dev4",
        "x-device-token": token,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "myserver__write_data", arguments: {} },
      }),
    });

    const json: any = await res.json();
    expect(json.jsonrpc).toBe("2.0");
    expect(json.id).toBe(7);
    expect(json.error).toBeUndefined();
    expect(json.result).toBeDefined();
    await server.stop();
  });
});

describe("P1: Hardcoded tool call ID", () => {
  it("uses JSON-RPC request id, not hardcoded mcp-1", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({ config: testConfig, ...resources });
    const token = await approve(server.baseUrl, "dev5", { tools: "read", system: false, mcp: true });

    const res = await fetch(server.baseUrl + "/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-id": "dev5",
        "x-device-token": token,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "custom-id-999",
        method: "tools/call",
        params: { name: "myserver__read_data", arguments: {} },
      }),
    });

    const json: any = await res.json();
    expect(json.id).toBe("custom-id-999");
    expect(json.result).toBeDefined();
    await server.stop();
  });
});
