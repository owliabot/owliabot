import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";

const cfg = {
  host: "127.0.0.1",
  port: 0,
  token: "gw",
  allowlist: ["127.0.0.1"],
  sqlitePath: ":memory:",
  idempotencyTtlMs: 600000,
  eventTtlMs: 86400000,
  rateLimit: { windowMs: 60000, max: 60 },
};

describe("pairing", () => {
  it("allows a device to request pairing", async () => {
    const server = await startGatewayHttp({ config: cfg });
    const res = await fetch(server.baseUrl + "/pairing/request", {
      method: "POST",
      headers: { "X-Device-Id": "dev-req" },
    });
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.status).toBe("pending");
    await server.stop();
  });

  it("approves device and returns token", async () => {
    const server = await startGatewayHttp({ config: cfg });
    const res = await fetch(server.baseUrl + "/pairing/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({ deviceId: "dev1" }),
    });
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.deviceToken).toBeTruthy();
    await server.stop();
  });

  it("exposes pending + device status via /status (gateway token)", async () => {
    const server = await startGatewayHttp({ config: cfg });

    // create one pending
    await fetch(server.baseUrl + "/pairing/request", {
      method: "POST",
      headers: { "X-Device-Id": "dev-pending" },
    });

    // approve one device
    await fetch(server.baseUrl + "/pairing/approve", {
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

    await server.stop();
  });
});
