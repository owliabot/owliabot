import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";
import { testConfig, createMockResources } from "./test-helpers.js";

describe("idempotency", () => {
  it("returns cached response for same idempotency key", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });

    // Approve device
    const approve = await fetch(server.baseUrl + "/admin/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({ deviceId: "dev-idem" }),
    });
    const { data }: any = await approve.json();

    const body = JSON.stringify({
      payload: {
        toolCalls: [{ id: "1", name: "test_read", arguments: {} }],
      },
    });

    // First request
    const res1 = await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Device-Id": "dev-idem",
        "X-Device-Token": data.deviceToken,
        "Idempotency-Key": "idem-key-1",
      },
      body,
    });
    const json1: any = await res1.json();

    // Second request with same key
    const res2 = await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Device-Id": "dev-idem",
        "X-Device-Token": data.deviceToken,
        "Idempotency-Key": "idem-key-1",
      },
      body,
    });
    const json2: any = await res2.json();

    // Should return the same cached response
    expect(JSON.stringify(json1)).toBe(JSON.stringify(json2));

    await server.stop();
  });

  it("returns different response for different idempotency key", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });

    // Approve device
    const approve = await fetch(server.baseUrl + "/admin/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({ deviceId: "dev-idem2" }),
    });
    const { data }: any = await approve.json();

    const body = JSON.stringify({
      payload: {
        toolCalls: [{ id: "1", name: "test_read", arguments: {} }],
      },
    });

    // First request
    await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Device-Id": "dev-idem2",
        "X-Device-Token": data.deviceToken,
        "Idempotency-Key": "idem-key-a",
      },
      body,
    });

    // Second request with different key - should execute again
    const res2 = await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Device-Id": "dev-idem2",
        "X-Device-Token": data.deviceToken,
        "Idempotency-Key": "idem-key-b",
      },
      body,
    });
    const json2: any = await res2.json();
    expect(json2.ok).toBe(true);

    await server.stop();
  });
});
