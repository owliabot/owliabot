/**
 * Audit logger with fail-closed strategy
 * @see docs/design/audit-strategy.md Section 9.1
 */

import { appendFile, readFile, stat } from "node:fs/promises";
import { ulid } from "ulid";
import { redactParams } from "./redact.js";
import { createLogger } from "../utils/logger.js";
import type { Tier } from "../policy/types.js";

const log = createLogger("audit");

export interface AuditEntry {
  id: string;
  ts: string;
  version: number;
  tool: string;
  tier: number | "none";
  effectiveTier: number | "none";
  securityLevel: "read" | "write" | "sign";
  user: string;
  channel: string;
  deviceId?: string;
  params: Record<string, unknown>;
  result:
    | "success"
    | "denied"
    | "timeout"
    | "error"
    | "escalated"
    | "emergency-stopped"
    | "pending";
  reason?: string;
  error?: string;
  txHash?: string;
  chainId?: number;
  blockNumber?: number;
  gasUsed?: string;
  sessionKeyId?: string;
  signerTier?: string;
  confirmation?: {
    required: boolean;
    channel: string;
    requestedAt: string;
    respondedAt?: string;
    approved?: boolean;
    latencyMs?: number;
  };
  traceId?: string;
  requestId?: string;
  duration?: number;
}

export interface PreLogResult {
  ok: boolean;
  id: string;
  error?: string;
}

export class AuditLogger {
  private logPath: string;
  private degraded = false;
  private memoryBuffer: string[] = [];
  private readonly maxBufferSize = 1000;

  constructor(logPath = "workspace/audit.jsonl") {
    this.logPath = logPath;
  }

  /**
   * Phase 1: Pre-log before execution (fail-closed)
   */
  async preLog(partial: Partial<AuditEntry>): Promise<PreLogResult> {
    const id = ulid();
    const entry: Partial<AuditEntry> = {
      id,
      ts: new Date().toISOString(),
      version: 1,
      result: "pending",
      ...partial,
      params: partial.params ? redactParams(partial.params) : {},
    };

    try {
      await this.writeLine(JSON.stringify(entry));
      return { ok: true, id };
    } catch (err) {
      log.error("Audit pre-log failed", err);
      this.degraded = true;
      return {
        ok: false,
        id,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Phase 2: Finalize after execution
   */
  async finalize(
    id: string,
    result: Exclude<AuditEntry["result"], "pending">,
    reason?: string,
    extra?: Partial<AuditEntry>
  ): Promise<void> {
    const update = {
      _finalize: id,
      ts: new Date().toISOString(),
      result,
      reason,
      ...extra,
    };

    try {
      await this.writeLine(JSON.stringify(update));
    } catch (err) {
      // Finalize failure enters degraded mode but doesn't block returning results
      log.error("Audit finalize failed, entering degraded mode", err);
      this.degraded = true;
      this.bufferLine(JSON.stringify(update));
    }
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  private async writeLine(line: string): Promise<void> {
    // First flush memory buffer if any
    if (this.memoryBuffer.length > 0) {
      const buffered = this.memoryBuffer.splice(0);
      for (const bl of buffered) {
        await appendFile(this.logPath, bl + "\n", "utf-8");
      }
      this.degraded = false;
      log.info("Memory buffer flushed, audit system recovered");
    }

    await appendFile(this.logPath, line + "\n", "utf-8");
  }

  private bufferLine(line: string): void {
    if (this.memoryBuffer.length >= this.maxBufferSize) {
      this.memoryBuffer.shift(); // Drop oldest
      log.warn("Audit buffer full, dropping oldest entry");
    }
    this.memoryBuffer.push(line);
    process.stderr.write(`[AUDIT-DEGRADED] ${line}\n`);
  }

  /**
   * Query recent entries (for anomaly detection)
   */
  async queryRecent(limit = 100): Promise<AuditEntry[]> {
    try {
      const content = await readFile(this.logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const entries: AuditEntry[] = [];

      // Take last N lines
      const recentLines = lines.slice(-limit);
      for (const line of recentLines) {
        try {
          const entry = JSON.parse(line);
          // Skip finalization records (they have _finalize field)
          if (!("_finalize" in entry)) {
            entries.push(entry as AuditEntry);
          }
        } catch (parseErr) {
          log.warn("Failed to parse audit line", parseErr);
        }
      }

      return entries;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }
}
