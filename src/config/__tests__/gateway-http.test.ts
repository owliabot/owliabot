import { describe, it, expect } from "vitest";
import { configSchema } from "../schema.js";

describe("gateway.http config", () => {
  it("accepts gateway http config", () => {
    const cfg = {
      providers: [{ id: "x", model: "m", apiKey: "k", priority: 1 }],
      workspace: "./workspace",
      gateway: {
        http: {
          host: "127.0.0.1",
          port: 8080,
          token: "secret",
          allowlist: ["127.0.0.1", "10.0.0.0/8"],
          sqlitePath: "./workspace/gateway.db",
          idempotencyTtlMs: 600000,
          eventTtlMs: 86400000,
          rateLimit: { windowMs: 60000, max: 60 },
        },
      },
    };

    const parsed = configSchema.safeParse(cfg);
    expect(parsed.success).toBe(true);
  });
});
