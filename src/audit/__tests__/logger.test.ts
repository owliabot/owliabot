import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink, readFile } from "node:fs/promises";
import { AuditLogger } from "../logger.js";

describe("AuditLogger", () => {
  const testLogPath = "workspace/test-audit.jsonl";
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger(testLogPath);
  });

  afterEach(async () => {
    try {
      await unlink(testLogPath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  it("should create audit entry with ULID", async () => {
    const result = await logger.preLog({
      tool: "test-tool",
      tier: 2,
      effectiveTier: 2,
      securityLevel: "write",
      user: "test-user",
      channel: "test",
      params: { foo: "bar" },
    });

    expect(result.ok).toBe(true);
    expect(result.id).toBeTruthy();
    expect(result.id.startsWith("01")).toBe(true); // ULID starts with timestamp
  });

  it("should redact sensitive params", async () => {
    const result = await logger.preLog({
      tool: "test-tool",
      tier: 1,
      effectiveTier: 1,
      securityLevel: "sign",
      user: "test-user",
      channel: "test",
      params: {
        address: "0x1234567890123456789012345678901234567890",
        privateKey: "super-secret-key",
        amount: "100",
      },
    });

    expect(result.ok).toBe(true);
    
    // Verify by reading the log file directly
    const content = await readFile(testLogPath, "utf-8");
    const lines = content.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    const entry = JSON.parse(lastLine);
    
    expect(entry.id).toBe(result.id);
    expect(entry.params.privateKey).toBe("[REDACTED]");
    expect(entry.params.address).toBe("0x1234567890123456789012345678901234567890");
    expect(entry.params.amount).toBe("100");
  });

  it("should finalize entry", async () => {
    const preLog = await logger.preLog({
      tool: "test-tool",
      tier: 3,
      effectiveTier: 3,
      securityLevel: "write",
      user: "test-user",
      channel: "test",
      params: {},
    });

    await logger.finalize(preLog.id, "success", undefined, {
      duration: 123,
      txHash: "0xabcdef",
    });

    // Verify finalization was written
    const entries = await logger.queryRecent(10);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("should query recent entries", async () => {
    await logger.preLog({
      tool: "tool-1",
      tier: 1,
      effectiveTier: 1,
      securityLevel: "read",
      user: "user-1",
      channel: "test",
      params: {},
    });

    await logger.preLog({
      tool: "tool-2",
      tier: 2,
      effectiveTier: 2,
      securityLevel: "write",
      user: "user-2",
      channel: "test",
      params: {},
    });

    const entries = await logger.queryRecent(10);
    expect(entries.length).toBe(2);
    expect(entries[0].tool).toBe("tool-1");
    expect(entries[1].tool).toBe("tool-2");
  });
});
