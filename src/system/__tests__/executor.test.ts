import { describe, it, expect } from "vitest";
import { executeSystemRequest } from "../executor.js";
import type { SystemCapabilityConfig } from "../interface.js";

describe("system/executor", () => {
  it("returns ERR_INVALID_REQUEST on malformed body", async () => {
    const r = await executeSystemRequest({ not: "a request" }, { workspacePath: "/tmp" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.code).toBe("ERR_INVALID_REQUEST");
    }
  });

  it("enforces security.level mapping", async () => {
    const r = await executeSystemRequest(
      {
        payload: { action: "exec", args: { command: "ls", params: [] } },
        security: { level: "read" },
      },
      { workspacePath: "/tmp" }
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.code).toBe("ERR_PERMISSION_DENIED");
    }
  });

  it("executes web.fetch via injected fetch", async () => {
    const cfg: SystemCapabilityConfig = {
      web: {
        domainAllowList: ["example.com"],
        domainDenyList: [],
        allowPrivateNetworks: false,
        timeoutMs: 10_000,
        maxResponseBytes: 100_000,
        userAgent: "vitest",
        blockOnSecret: true,
      },
    };

    const fetchImpl: typeof fetch = async () => {
      return new Response("hello", { status: 200, headers: { "content-type": "text/plain" } });
    };

    const r = await executeSystemRequest(
      {
        payload: { action: "web.fetch", args: { url: "https://example.com/" } },
        security: { level: "read" },
      },
      { workspacePath: "/tmp", fetchImpl },
      cfg
    );

    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as any).status).toBe(200);
      expect((r.data as any).bodyText).toBe("hello");
    }
  });
});
