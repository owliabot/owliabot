import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";
import { testConfig, createMockResources } from "./test-helpers.js";

describe("command/tool", () => {
  it("executes tool calls for paired device", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });

    // Approve device
    const approve = await fetch(server.baseUrl + "/admin/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({ deviceId: "dev-tool" }),
    });
    const { data }: any = await approve.json();

    const res = await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Device-Id": "dev-tool",
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
    expect(json.data.results).toHaveLength(1);
    expect(json.data.results[0].success).toBe(true);

    await server.stop();
  });

  it("returns 401 for unpaired device", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });

    const res = await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Device-Id": "dev-unpaired",
        "X-Device-Token": "invalid-token",
      },
      body: JSON.stringify({
        payload: {
          toolCalls: [{ id: "1", name: "test_read", arguments: {} }],
        },
      }),
    });

    const json: any = await res.json();
    expect(res.status).toBe(401);
    expect(json.error.code).toBe("ERR_DEVICE_NOT_PAIRED");

    await server.stop();
  });

  it("returns 400 for invalid request body", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });

    // Approve device
    const approve = await fetch(server.baseUrl + "/admin/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({ deviceId: "dev-invalid" }),
    });
    const { data }: any = await approve.json();

    const res = await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Device-Id": "dev-invalid",
        "X-Device-Token": data.deviceToken,
      },
      body: JSON.stringify({ payload: {} }), // Missing toolCalls
    });

    const json: any = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.code).toBe("ERR_INVALID_REQUEST");

    await server.stop();
  });
});
