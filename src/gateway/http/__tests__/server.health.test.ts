import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";

const baseConfig = {
  host: "127.0.0.1",
  port: 0,
  token: undefined,
  allowlist: ["127.0.0.1"],
  sqlitePath: ":memory:",
  idempotencyTtlMs: 600000,
  eventTtlMs: 86400000,
  rateLimit: { windowMs: 60000, max: 60 },
};

describe("gateway health", () => {
  it("returns ok", async () => {
    const server = await startGatewayHttp({ config: baseConfig });
    const res = await fetch(server.baseUrl + "/health");
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    await server.stop();
  });
});
