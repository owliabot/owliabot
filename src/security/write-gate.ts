/**
 * Write-tools permission gate
 *
 * Two-layer protection for write-level tool execution:
 * 1. User allowlist check
 * 2. Interactive confirmation flow (send message → wait for reply)
 *
 * Integrates with the existing executor pipeline in src/agent/tools/executor.ts
 *
 * @see owliabot-write-gate-design.md
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createLogger } from "../utils/logger.js";
import type { ToolCall } from "../agent/tools/interface.js";
import type { OutboundMessage } from "../channels/interface.js";

const log = createLogger("write-gate");

// ── Types ──────────────────────────────────────────────────────────────────

export type WriteGateVerdict =
  | "approved"
  | "denied"
  | "timeout"
  | "not_in_allowlist"
  | "confirmation_disabled_allow";

export interface WriteGateResult {
  allowed: boolean;
  reason: WriteGateVerdict;
}

export interface WriteGateConfig {
  /** Discord/Telegram user IDs allowed to trigger write tools */
  allowList: string[];
  /** Whether to require interactive confirmation (default true) */
  confirmationEnabled: boolean;
  /** Milliseconds to wait for user reply before auto-deny */
  timeoutMs: number;
  /** Path to audit JSONL file */
  auditPath: string;
}

/**
 * Channel adapter — abstracts message send/receive for the confirmation flow.
 * The caller (executor integration) provides these based on the active channel.
 */
export interface WriteGateChannel {
  /** Send a message to the session's channel/DM */
  sendMessage(target: string, msg: OutboundMessage): Promise<void>;
  /**
   * Wait for a text reply from a specific user in the target channel.
   * Returns the reply body (lowercase-trimmed) or null on timeout.
   */
  waitForReply(
    target: string,
    fromUserId: string,
    timeoutMs: number,
  ): Promise<string | null>;
}

/** Minimal info the gate needs from the calling context */
export interface WriteGateCallContext {
  /** User ID that triggered the agent turn */
  userId: string;
  /** Session key, e.g. "discord:123456" */
  sessionKey: string;
  /** Channel target for sending confirmation messages */
  target: string;
}

// ── Audit ──────────────────────────────────────────────────────────────────

interface AuditEntry {
  ts: string;
  tool: string;
  user: string;
  session: string;
  /** Sanitized params — only include path-level info, no file content */
  params: Record<string, unknown>;
  result: WriteGateVerdict;
  durationMs: number;
}

/**
 * Extract safe-to-log fields from tool params.
 * We intentionally strip large text blobs to keep the audit log manageable.
 */
function sanitizeParams(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object") return {};
  const raw = params as Record<string, unknown>;
  const safe: Record<string, unknown> = {};

  // Keep path/file identifiers
  for (const key of ["path", "file", "filename", "directory"]) {
    if (key in raw) safe[key] = raw[key];
  }

  // Truncate text fields
  for (const key of ["old_text", "new_text", "content"]) {
    if (key in raw && typeof raw[key] === "string") {
      const text = raw[key] as string;
      safe[key] = text.length > 200 ? text.slice(0, 200) + "…" : text;
    }
  }

  return safe;
}

async function writeAuditEntry(auditPath: string, entry: AuditEntry): Promise<void> {
  try {
    await mkdir(dirname(auditPath), { recursive: true });
    await appendFile(auditPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch (err) {
    // Audit write failure should not block tool execution
    log.error("Failed to write audit entry", err);
  }
}

// ── Pending confirmations tracker (prevents concurrent confirm storms) ────

const pendingConfirmations = new Map<string, boolean>();

// ── Core Gate ──────────────────────────────────────────────────────────────

export class WriteGate {
  private readonly config: WriteGateConfig;
  private readonly channel: WriteGateChannel;

  constructor(config: WriteGateConfig, channel: WriteGateChannel) {
    this.config = config;
    this.channel = channel;
  }

  /**
   * Check whether a write-level tool call should be allowed.
   *
   * Call this from the executor before running any tool with
   * security.level === "write" (or "sign").
   */
  async check(
    call: ToolCall,
    ctx: WriteGateCallContext,
  ): Promise<WriteGateResult> {
    const start = Date.now();
    let verdict: WriteGateVerdict;

    try {
      verdict = await this.evaluate(call, ctx);
    } catch (err) {
      log.error(`Write gate error for ${call.name}`, err);
      verdict = "denied";
    }

    // Audit
    const entry: AuditEntry = {
      ts: new Date().toISOString(),
      tool: call.name,
      user: ctx.userId,
      session: ctx.sessionKey,
      params: sanitizeParams(call.arguments),
      result: verdict,
      durationMs: Date.now() - start,
    };
    await writeAuditEntry(this.config.auditPath, entry);

    const allowed =
      verdict === "approved" || verdict === "confirmation_disabled_allow";

    log.info(
      `Write gate: tool=${call.name} user=${ctx.userId} verdict=${verdict} allowed=${allowed}`,
    );

    return { allowed, reason: verdict };
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private async evaluate(
    call: ToolCall,
    ctx: WriteGateCallContext,
  ): Promise<WriteGateVerdict> {
    // Layer 1: allowlist
    if (!this.config.allowList.includes(ctx.userId)) {
      log.warn(`User ${ctx.userId} not in write-tool allowlist`);
      return "not_in_allowlist";
    }

    // Layer 2: confirmation
    if (!this.config.confirmationEnabled) {
      return "confirmation_disabled_allow";
    }

    // Prevent concurrent confirmations on the same session
    if (pendingConfirmations.get(ctx.sessionKey)) {
      log.warn(`Concurrent write confirmation blocked for ${ctx.sessionKey}`);
      return "denied";
    }

    pendingConfirmations.set(ctx.sessionKey, true);
    try {
      return await this.requestConfirmation(call, ctx);
    } finally {
      pendingConfirmations.delete(ctx.sessionKey);
    }
  }

  private async requestConfirmation(
    call: ToolCall,
    ctx: WriteGateCallContext,
  ): Promise<WriteGateVerdict> {
    const summary = this.buildConfirmationMessage(call);

    await this.channel.sendMessage(ctx.target, { text: summary });

    const reply = await this.channel.waitForReply(
      ctx.target,
      ctx.userId,
      this.config.timeoutMs,
    );

    if (reply === null) {
      log.info(`Confirmation timed out for ${call.name} (${ctx.sessionKey})`);
      await this.channel.sendMessage(ctx.target, {
        text: "⏰ Write operation timed out — denied.",
      });
      return "timeout";
    }

    const normalised = reply.trim().toLowerCase();
    if (["yes", "y", "confirm", "ok", "approve"].includes(normalised)) {
      return "approved";
    }

    await this.channel.sendMessage(ctx.target, {
      text: "❌ Write operation denied.",
    });
    return "denied";
  }

  /**
   * Build a human-readable confirmation message showing what the tool wants to do.
   */
  private buildConfirmationMessage(call: ToolCall): string {
    const params = (call.arguments ?? {}) as Record<string, unknown>;
    const lines = [
      "⚠️ **Write Operation Requested**",
      "",
      `**Tool:** \`${call.name}\``,
    ];

    // Show path if available
    if (typeof params.path === "string") {
      lines.push(`**File:** \`${params.path}\``);
    }

    // Show text diffs for edit_file
    if (typeof params.old_text === "string") {
      const preview = truncate(params.old_text as string, 200);
      lines.push(`**Old text:** \`\`\`\n${preview}\n\`\`\``);
    }
    if (typeof params.new_text === "string") {
      const preview = truncate(params.new_text as string, 200);
      lines.push(`**New text:** \`\`\`\n${preview}\n\`\`\``);
    }

    // Show content for write-file style tools
    if (typeof params.content === "string" && !("old_text" in params)) {
      const preview = truncate(params.content as string, 200);
      lines.push(`**Content:** \`\`\`\n${preview}\n\`\`\``);
    }

    lines.push("");
    lines.push(
      `Reply **yes** to approve or **no** to deny. (${Math.round(this.config.timeoutMs / 1000)}s timeout)`,
    );

    return lines.join("\n");
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Convenience factory that reads from the app config shape.
 *
 * Usage in executor integration:
 * ```ts
 * const gate = createWriteGate(config.security, channel, workspacePath);
 * ```
 */
export function createWriteGate(
  security: {
    writeToolAllowList?: string[];
    writeToolConfirmation?: boolean;
    writeToolConfirmationTimeoutMs?: number;
  } | undefined,
  channel: WriteGateChannel,
  workspacePath: string,
): WriteGate {
  const cfg: WriteGateConfig = {
    allowList: security?.writeToolAllowList ?? [],
    confirmationEnabled: security?.writeToolConfirmation ?? true,
    timeoutMs: security?.writeToolConfirmationTimeoutMs ?? 60_000,
    auditPath: `${workspacePath}/audit.jsonl`,
  };
  return new WriteGate(cfg, channel);
}
