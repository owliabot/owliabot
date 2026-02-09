import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";
import { testConfig, createMockResources } from "./test-helpers.js";

describe("pairing", () => {
  it("allows a device to request pairing", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });
    const res = await fetch(server.baseUrl + "/pairing/request", {
      method: "POST",
      headers: { "X-Device-Id": "dev-req" },
    });
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.status).toBe("pending");
    await server.stop();
  });

  it("allows a device to request pairing via /pair/request", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });
    const res = await fetch(server.baseUrl + "/pair/request", {
      method: "POST",
      headers: { "X-Device-Id": "dev-req-new" },
    });
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.status).toBe("pending");
    await server.stop();
  });

  it("approves device and returns token with scope", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });
    const res = await fetch(server.baseUrl + "/admin/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({
        deviceId: "dev1",
        scope: { tools: "write", system: true, mcp: false },
      }),
    });
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.deviceToken).toBeTruthy();
    expect(json.data.scope.tools).toBe("write");
    expect(json.data.scope.system).toBe(true);
    await server.stop();
  });

  it("approves device with default scope when not specified", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });
    const res = await fetch(server.baseUrl + "/admin/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({ deviceId: "dev-default" }),
    });
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.scope.tools).toBe("read");
    expect(json.data.scope.system).toBe(false);
    expect(json.data.scope.mcp).toBe(false);
    await server.stop();
  });

  it("exposes pending + device status via /status (gateway token)", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });

    // create one pending
    await fetch(server.baseUrl + "/pair/request", {
      method: "POST",
      headers: { "X-Device-Id": "dev-pending" },
    });

    // approve one device
    await fetch(server.baseUrl + "/admin/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({ deviceId: "dev-ok" }),
    });

    const res = await fetch(server.baseUrl + "/status", {
      headers: { "X-Gateway-Token": "gw" },
    });
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data.pending)).toBe(true);
    expect(Array.isArray(json.data.devices)).toBe(true);

    // token hash should not be exposed
    expect(JSON.stringify(json.data.devices)).not.toContain("tokenHash");

    // scope should be exposed
    const device = json.data.devices.find((d: any) => d.deviceId === "dev-ok");
    expect(device.scope).toBeDefined();

    await server.stop();
  });

  it("checks pairing status via /pair/status", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });

    // Unknown device
    const unknown = await fetch(server.baseUrl + "/pair/status", {
      headers: { "X-Device-Id": "dev-unknown" },
    });
    const unknownJson: any = await unknown.json();
    expect(unknownJson.data.status).toBe("unknown");

    // Request pairing
    await fetch(server.baseUrl + "/pair/request", {
      method: "POST",
      headers: { "X-Device-Id": "dev-check" },
    });

    // Pending status
    const pending = await fetch(server.baseUrl + "/pair/status", {
      headers: { "X-Device-Id": "dev-check" },
    });
    const pendingJson: any = await pending.json();
    expect(pendingJson.data.status).toBe("pending");

    // Approve
    const approve = await fetch(server.baseUrl + "/admin/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({ deviceId: "dev-check" }),
    });
    const { data }: any = await approve.json();

    // Paired status (with token)
    const paired = await fetch(server.baseUrl + "/pair/status", {
      headers: {
        "X-Device-Id": "dev-check",
        "X-Device-Token": data.deviceToken,
      },
    });
    const pairedJson: any = await paired.json();
    expect(pairedJson.data.status).toBe("paired");
    expect(pairedJson.data.scope).toBeDefined();

    await server.stop();
  });
});
