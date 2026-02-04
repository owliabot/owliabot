/**
 * Tests for the write-tools permission gate
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WriteGate, createWriteGate } from "./write-gate.js";
import type {
  WriteGateChannel,
  WriteGateConfig,
  WriteGateCallContext,
} from "./write-gate.js";
import type { ToolCall } from "../agent/tools/interface.js";
import { readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Helpers ────────────────────────────────────────────────────────────────

const TEST_USER = "user-123";
const OTHER_USER = "user-999";
const SESSION_KEY = "discord:user-123";
const TARGET = "discord:channel:456";

function makeCall(overrides?: Partial<ToolCall>): ToolCall {
  return {
    id: "call-1",
    name: "edit_file",
    arguments: {
      path: "memory/notes.md",
      old_text: "hello world",
      new_text: "hello owliabot",
    },
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<WriteGateCallContext>): WriteGateCallContext {
  return {
    userId: TEST_USER,
    sessionKey: SESSION_KEY,
    target: TARGET,
    ...overrides,
  };
}

function mockChannel(
  replyWith: string | null = "yes",
): WriteGateChannel & {
  sentMessages: Array<{ target: string; text: string }>;
} {
  const sentMessages: Array<{ target: string; text: string }> = [];
  return {
    sentMessages,
    sendMessage: vi.fn(async (target, msg) => {
      sentMessages.push({ target, text: msg.text });
    }),
    waitForReply: vi.fn(async () => replyWith),
  };
}

let testDir: string;

function makeConfig(overrides?: Partial<WriteGateConfig>): WriteGateConfig {
  return {
    allowList: [TEST_USER],
    confirmationEnabled: true,
    timeoutMs: 60_000,
    auditPath: join(testDir, "audit.jsonl"),
    ...overrides,
  };
}

// ── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(async () => {
  testDir = join(tmpdir(), `write-gate-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("WriteGate", () => {
  // ── Allowlist layer ────────────────────────────────────────────────────

  describe("allowlist check", () => {
    it("denies user not in allowlist", async () => {
      const ch = mockChannel();
      const gate = new WriteGate(makeConfig(), ch);

      const result = await gate.check(makeCall(), makeCtx({ userId: OTHER_USER }));

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("not_in_allowlist");
      // Should NOT have sent any confirmation message
      expect(ch.sendMessage).not.toHaveBeenCalled();
    });

    it("denies when allowlist is empty", async () => {
      const ch = mockChannel();
      const gate = new WriteGate(makeConfig({ allowList: [] }), ch);

      const result = await gate.check(makeCall(), makeCtx());

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("not_in_allowlist");
    });

    it("allows user in allowlist (with confirmation)", async () => {
      const ch = mockChannel("yes");
      const gate = new WriteGate(makeConfig(), ch);

      const result = await gate.check(makeCall(), makeCtx());

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("approved");
    });
  });

  // ── Confirmation flow ──────────────────────────────────────────────────

  describe("confirmation flow", () => {
    it("approves on 'yes' reply", async () => {
      const ch = mockChannel("yes");
      const gate = new WriteGate(makeConfig(), ch);

      const result = await gate.check(makeCall(), makeCtx());

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("approved");
      // Confirmation message was sent
      expect(ch.sentMessages.length).toBeGreaterThanOrEqual(1);
      expect(ch.sentMessages[0].text).toContain("Write Operation Requested");
    });

    it("approves on 'y' reply (case insensitive)", async () => {
      const ch = mockChannel("  Y  ");
      const gate = new WriteGate(makeConfig(), ch);

      const result = await gate.check(makeCall(), makeCtx());
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("approved");
    });

    it("approves on 'confirm' reply", async () => {
      const ch = mockChannel("confirm");
      const gate = new WriteGate(makeConfig(), ch);

      const result = await gate.check(makeCall(), makeCtx());
      expect(result.allowed).toBe(true);
    });

    it("denies on 'no' reply", async () => {
      const ch = mockChannel("no");
      const gate = new WriteGate(makeConfig(), ch);

      const result = await gate.check(makeCall(), makeCtx());

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("denied");
      // Should send denial message
      expect(ch.sentMessages.some((m) => m.text.includes("denied"))).toBe(true);
    });

    it("denies on arbitrary reply", async () => {
      const ch = mockChannel("maybe later");
      const gate = new WriteGate(makeConfig(), ch);

      const result = await gate.check(makeCall(), makeCtx());
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("denied");
    });

    it("times out when no reply (null)", async () => {
      const ch = mockChannel(null);
      const gate = new WriteGate(makeConfig(), ch);

      const result = await gate.check(makeCall(), makeCtx());

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("timeout");
      expect(ch.sentMessages.some((m) => m.text.includes("timed out"))).toBe(true);
    });
  });

  // ── Confirmation disabled ──────────────────────────────────────────────

  describe("confirmation disabled", () => {
    it("allows without confirmation when disabled", async () => {
      const ch = mockChannel();
      const gate = new WriteGate(
        makeConfig({ confirmationEnabled: false }),
        ch,
      );

      const result = await gate.check(makeCall(), makeCtx());

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("confirmation_disabled_allow");
      // No messages sent — skipped confirmation entirely
      expect(ch.sendMessage).not.toHaveBeenCalled();
    });

    it("still checks allowlist even when confirmation disabled", async () => {
      const ch = mockChannel();
      const gate = new WriteGate(
        makeConfig({ confirmationEnabled: false }),
        ch,
      );

      const result = await gate.check(makeCall(), makeCtx({ userId: OTHER_USER }));
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("not_in_allowlist");
    });
  });

  // ── Confirmation message content ──────────────────────────────────────

  describe("confirmation message", () => {
    it("includes tool name and file path", async () => {
      const ch = mockChannel("yes");
      const gate = new WriteGate(makeConfig(), ch);

      await gate.check(makeCall(), makeCtx());

      const msg = ch.sentMessages[0].text;
      expect(msg).toContain("edit_file");
      expect(msg).toContain("memory/notes.md");
    });

    it("includes old_text and new_text previews", async () => {
      const ch = mockChannel("yes");
      const gate = new WriteGate(makeConfig(), ch);

      await gate.check(makeCall(), makeCtx());

      const msg = ch.sentMessages[0].text;
      expect(msg).toContain("hello world");
      expect(msg).toContain("hello owliabot");
    });

    it("truncates long text in confirmation", async () => {
      const ch = mockChannel("yes");
      const gate = new WriteGate(makeConfig(), ch);

      const longText = "x".repeat(500);
      await gate.check(
        makeCall({ arguments: { path: "f.txt", old_text: longText, new_text: "short" } }),
        makeCtx(),
      );

      const msg = ch.sentMessages[0].text;
      // Should contain truncation marker
      expect(msg).toContain("…");
      // Should NOT contain the full 500 chars
      expect(msg.length).toBeLessThan(longText.length);
    });
  });

  // ── Audit log ──────────────────────────────────────────────────────────

  describe("audit logging", () => {
    it("writes audit entry on approval", async () => {
      const ch = mockChannel("yes");
      const gate = new WriteGate(makeConfig(), ch);

      await gate.check(makeCall(), makeCtx());

      const audit = await readFile(join(testDir, "audit.jsonl"), "utf-8");
      const entry = JSON.parse(audit.trim());

      expect(entry.tool).toBe("edit_file");
      expect(entry.user).toBe(TEST_USER);
      expect(entry.session).toBe(SESSION_KEY);
      expect(entry.result).toBe("approved");
      expect(entry.params.path).toBe("memory/notes.md");
      expect(typeof entry.durationMs).toBe("number");
      expect(entry.ts).toBeTruthy();
    });

    it("writes audit entry on denial", async () => {
      const ch = mockChannel("no");
      const gate = new WriteGate(makeConfig(), ch);

      await gate.check(makeCall(), makeCtx());

      const audit = await readFile(join(testDir, "audit.jsonl"), "utf-8");
      const entry = JSON.parse(audit.trim());
      expect(entry.result).toBe("denied");
    });

    it("writes audit entry on allowlist rejection", async () => {
      const ch = mockChannel();
      const gate = new WriteGate(makeConfig(), ch);

      await gate.check(makeCall(), makeCtx({ userId: OTHER_USER }));

      const audit = await readFile(join(testDir, "audit.jsonl"), "utf-8");
      const entry = JSON.parse(audit.trim());
      expect(entry.result).toBe("not_in_allowlist");
      expect(entry.user).toBe(OTHER_USER);
    });

    it("sanitizes params — strips long content", async () => {
      const ch = mockChannel("yes");
      const gate = new WriteGate(makeConfig(), ch);

      const longContent = "z".repeat(500);
      await gate.check(
        makeCall({ arguments: { path: "f.txt", old_text: longContent, new_text: "s" } }),
        makeCtx(),
      );

      const audit = await readFile(join(testDir, "audit.jsonl"), "utf-8");
      const entry = JSON.parse(audit.trim());
      // old_text should be truncated to ~200 chars
      expect((entry.params.old_text as string).length).toBeLessThanOrEqual(202);
    });

    it("accumulates multiple audit entries", async () => {
      const ch = mockChannel("yes");
      const gate = new WriteGate(makeConfig(), ch);

      await gate.check(makeCall({ id: "call-1" }), makeCtx());
      await gate.check(makeCall({ id: "call-2" }), makeCtx());

      const lines = (await readFile(join(testDir, "audit.jsonl"), "utf-8"))
        .trim()
        .split("\n");
      expect(lines.length).toBe(2);
    });
  });

  // ── Concurrent confirmations ──────────────────────────────────────────

  describe("concurrency", () => {
    it("queues concurrent confirmations on same session (both approved)", async () => {
      // Both calls reply "yes" — the implementation queues them sequentially,
      // so both should be approved (not one denied).
      let callCount = 0;
      const ch: WriteGateChannel = {
        sendMessage: vi.fn(async () => {}),
        waitForReply: vi.fn(
          () =>
            new Promise<string>((resolve) => {
              callCount++;
              setTimeout(() => resolve("yes"), 200);
            }),
        ),
      };
      const gate = new WriteGate(makeConfig(), ch);

      // Fire two checks concurrently on same session
      const [r1, r2] = await Promise.all([
        gate.check(makeCall({ id: "c1" }), makeCtx()),
        gate.check(makeCall({ id: "c2" }), makeCtx()),
      ]);

      // Both should be approved sequentially (queued, not rejected)
      expect(r1.reason).toBe("approved");
      expect(r2.reason).toBe("approved");
      // Confirmation was requested twice (once per queued call)
      expect(ch.waitForReply).toHaveBeenCalledTimes(2);
    });

    it("queues concurrent confirmations — second denied when user says no", async () => {
      // First call approved, second denied by user
      let callCount = 0;
      const ch: WriteGateChannel = {
        sendMessage: vi.fn(async () => {}),
        waitForReply: vi.fn(
          () =>
            new Promise<string>((resolve) => {
              callCount++;
              setTimeout(() => resolve(callCount === 1 ? "yes" : "no"), 100);
            }),
        ),
      };
      const gate = new WriteGate(makeConfig(), ch);

      const [r1, r2] = await Promise.all([
        gate.check(makeCall({ id: "c1" }), makeCtx()),
        gate.check(makeCall({ id: "c2" }), makeCtx()),
      ]);

      expect(r1.reason).toBe("approved");
      expect(r2.reason).toBe("denied");
    });
  });
});

// ── Factory tests ────────────────────────────────────────────────────────

describe("createWriteGate", () => {
  it("creates gate with defaults when security is undefined", () => {
    const ch = mockChannel();
    const gate = createWriteGate(undefined, ch, "/workspace");
    // Should create without throwing
    expect(gate).toBeInstanceOf(WriteGate);
  });

  it("creates gate with provided config", () => {
    const ch = mockChannel();
    const gate = createWriteGate(
      {
        writeToolAllowList: ["u1", "u2"],
        writeToolConfirmation: false,
        writeToolConfirmationTimeoutMs: 30_000,
      },
      ch,
      "/workspace",
    );
    expect(gate).toBeInstanceOf(WriteGate);
  });
});
