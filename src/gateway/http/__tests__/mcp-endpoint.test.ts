import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";
import { testConfig, createMockResources } from "./test-helpers.js";

/** Helper: approve device with mcp scope and return token */
async function approveWithMcp(baseUrl: string, deviceId: string, mcp = true) {
  const res = await fetch(baseUrl + "/admin/approve", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
    body: JSON.stringify({ deviceId, scope: { tools: "read", system: false, mcp } }),
  });
  const json: any = await res.json();
  return json.data.deviceToken as string;
}

/** Helper: send JSON-RPC to /mcp */
async function rpc(
  baseUrl: string,
  auth: { deviceId: string; deviceToken: string } | { apiKey: string },
  method: string,
  params: any = {},
  id: number | string = 1,
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if ("apiKey" in auth) {
    headers["authorization"] = `Bearer ${auth.apiKey}`;
  } else {
    headers["x-device-id"] = auth.deviceId;
    headers["x-device-token"] = auth.deviceToken;
  }
  return fetch(baseUrl + "/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

function withMcpTool(resources: ReturnType<typeof createMockResources>) {
  resources.toolRegistry.register({
    name: "myserver__echo",
    description: "Echo tool from MCP server",
    parameters: { type: "object", properties: { msg: { type: "string" } }, required: [] },
    security: { level: "read" },
    execute: async (_args: any) => ({ success: true, data: { echoed: _args.msg ?? "hello" } }),
  });
  return resources;
}

describe("/mcp endpoint", () => {
  it("tools/list returns MCP tools only", async () => {
    const resources = withMcpTool(createMockResources());
    const server = await startGatewayHttp({ config: testConfig, ...resources });
    const token = await approveWithMcp(server.baseUrl, "dev-mcp");

    const res = await rpc(server.baseUrl, { deviceId: "dev-mcp", deviceToken: token }, "tools/list");
    const json: any = await res.json();

    expect(res.status).toBe(200);
    expect(json.jsonrpc).toBe("2.0");
    expect(json.id).toBe(1);
    expect(json.result.tools.length).toBeGreaterThanOrEqual(1);
    expect(json.result.tools.map((t: any) => t.name)).toContain("myserver__echo");

    await server.stop();
  });

  it("tools/call executes an MCP tool", async () => {
    const resources = withMcpTool(createMockResources());
    const server = await startGatewayHttp({ config: testConfig, ...resources });
    const token = await approveWithMcp(server.baseUrl, "dev-call");

    const res = await rpc(
      server.baseUrl,
      { deviceId: "dev-call", deviceToken: token },
      "tools/call",
      { name: "myserver__echo", arguments: { msg: "hi" } },
    );
    const json: any = await res.json();

    expect(res.status).toBe(200);
    expect(json.result.isError).toBe(false);
    expect(json.result.content[0].type).toBe("text");

    await server.stop();
  });

  it("tools/call rejects non-MCP tool name", async () => {
    const resources = withMcpTool(createMockResources());
    const server = await startGatewayHttp({ config: testConfig, ...resources });
    const token = await approveWithMcp(server.baseUrl, "dev-reject");

    const res = await rpc(
      server.baseUrl,
      { deviceId: "dev-reject", deviceToken: token },
      "tools/call",
      { name: "test_read", arguments: {} },
    );
    const json: any = await res.json();

    expect(res.status).toBe(200);
    expect(json.error.code).toBe(-32602);

    await server.stop();
  });

  it("returns 403 when device lacks mcp scope", async () => {
    const resources = withMcpTool(createMockResources());
    const server = await startGatewayHttp({ config: testConfig, ...resources });
    const token = await approveWithMcp(server.baseUrl, "dev-noscope", false);

    const res = await rpc(
      server.baseUrl,
      { deviceId: "dev-noscope", deviceToken: token },
      "tools/list",
    );

    expect(res.status).toBe(403);

    await server.stop();
  });

  it("returns JSON-RPC error for unknown method", async () => {
    const resources = withMcpTool(createMockResources());
    const server = await startGatewayHttp({ config: testConfig, ...resources });
    const token = await approveWithMcp(server.baseUrl, "dev-unknown");

    const res = await rpc(
      server.baseUrl,
      { deviceId: "dev-unknown", deviceToken: token },
      "bogus/method",
    );
    const json: any = await res.json();

    expect(res.status).toBe(200);
    expect(json.error.code).toBe(-32601);

    await server.stop();
  });

  it("works with API key auth (mcp scope)", async () => {
    const resources = withMcpTool(createMockResources());
    const server = await startGatewayHttp({ config: testConfig, ...resources });

    // Create API key with mcp scope
    const createRes = await fetch(server.baseUrl + "/admin/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({ name: "mcp-key", scope: { tools: "read", system: false, mcp: true } }),
    });
    const { data }: any = await createRes.json();

    const res = await rpc(server.baseUrl, { apiKey: data.key }, "tools/list");
    const json: any = await res.json();

    expect(res.status).toBe(200);
    expect(json.result.tools.length).toBeGreaterThanOrEqual(1);

    await server.stop();
  });

  it("servers/list returns server info derived from tools", async () => {
    const resources = withMcpTool(createMockResources());
    const server = await startGatewayHttp({ config: testConfig, ...resources });
    const token = await approveWithMcp(server.baseUrl, "dev-servers");

    const res = await rpc(
      server.baseUrl,
      { deviceId: "dev-servers", deviceToken: token },
      "servers/list",
    );
    const json: any = await res.json();

    expect(res.status).toBe(200);
    expect(json.result.servers.length).toBeGreaterThanOrEqual(1);
    const myserver = json.result.servers.find((s: any) => s.name === "myserver");
    expect(myserver).toBeDefined();
    expect(myserver.toolCount).toBeGreaterThanOrEqual(1);

    await server.stop();
  });
});
