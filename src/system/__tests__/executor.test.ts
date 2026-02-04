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

  it("rejects exec action when security.level = 'read' (exec requires 'write')", async () => {
    // exec action explicitly requires "write" security level
    // This test confirms the enforcement is working correctly
    const result = await executeSystemRequest(
      {
        payload: {
          action: "exec",
          args: { command: "echo", params: ["hello"] },
        },
        security: { level: "read" },
      },
      { workspacePath: "/tmp" }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("ERR_PERMISSION_DENIED");
      expect(result.error.message).toContain("security.level mismatch");
      expect(result.error.message).toContain("exec");
      expect(result.error.message).toContain("required write");
    }
  });

  it("allows exec action when security.level = 'write'", async () => {
    // With write level, should pass security check (may still fail on command allowlist)
    const cfg: SystemCapabilityConfig = {
      exec: {
        commandAllowList: [], // empty = block all
        envAllowList: [],
        timeoutMs: 1000,
        maxOutputBytes: 1024,
      },
    };

    const result = await executeSystemRequest(
      {
        payload: {
          action: "exec",
          args: { command: "echo", params: ["test"] },
        },
        security: { level: "write" },
      },
      { workspacePath: "/tmp" },
      cfg
    );

    // Should fail on command allowlist, not security level
    expect(result.success).toBe(false);
    if (!result.success) {
      // Should NOT be permission denied - that would mean security check failed
      expect(result.error.code).not.toBe("ERR_PERMISSION_DENIED");
      // Should fail on command not allowed
      expect(result.error.message).toContain("not allowed");
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
