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

describe("gateway integration", () => {
  it("pair -> tool -> events", async () => {
    const server = await startGatewayHttp({ config: cfg });
    const approve = await fetch(server.baseUrl + "/pairing/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({ deviceId: "dev1" }),
    });
    const { data }: any = await approve.json();

    await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Device-Id": "dev1",
        "X-Device-Token": data.deviceToken,
        "Idempotency-Key": "t1",
      },
      body: JSON.stringify({ payload: { toolCalls: [] } }),
    });

    const events = await fetch(server.baseUrl + "/events/poll");
    const json: any = await events.json();
    expect(json.cursor).toBeTypeOf("number");
    expect(json.events.length).toBeGreaterThan(0);
    await server.stop();
  });
});
