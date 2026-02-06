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
  rateLimit: { windowMs: 60000, max: 1 },
};

describe("idempotency", () => {
  it("replays response for same key+hash", async () => {
    const server = await startGatewayHttp({ config: cfg });
    const approve = await fetch(server.baseUrl + "/pairing/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({ deviceId: "dev1" }),
    });
    const { data }: any = await approve.json();

    const body = JSON.stringify({ payload: { toolCalls: [] } });
    const headers = {
      "content-type": "application/json",
      "X-Device-Id": "dev1",
      "X-Device-Token": data.deviceToken,
      "Idempotency-Key": "k1",
    };
    const r1 = await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers,
      body,
    });
    const r2 = await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers,
      body,
    });
    expect(await r1.text()).toBe(await r2.text());

    const r3 = await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "k2" },
      body,
    });
    expect(r3.status).toBe(429);
    await server.stop();
  });
});
