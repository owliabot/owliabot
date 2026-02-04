/**
 * Audit log query interface
 * @see docs/design/audit-strategy.md Section 6
 */

import { createReadStream } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { createLogger } from "../utils/logger.js";
import type { AuditEntry } from "./logger.js";
import type { Tier } from "../policy/types.js";

const log = createLogger("audit-query");

export interface AuditQuery {
  tool?: string;
  tier?: Tier;
  since?: Date;
  until?: Date;
  result?: string;
  user?: string;
  chainId?: number;
  limit?: number;
  offset?: number;
}

export interface AuditStats {
  totalOps: number;
  successCount: number;
  deniedCount: number;
  errorCount: number;
  timeoutCount: number;
  tierBreakdown: Record<string, number>;
  toolBreakdown: Record<string, number>;
  chainOps: number;
  totalGasCost?: number;
  totalVolume?: number;
}

export class AuditQueryService {
  private logPath: string;
  private archiveDir: string;

  constructor(logPath = "workspace/audit.jsonl", archiveDir = "workspace/audit") {
    this.logPath = logPath;
    this.archiveDir = archiveDir;
  }

  /**
   * Query audit log with filters
   */
  async query(query: AuditQuery): Promise<AuditEntry[]> {
    const files = await this.resolveLogFiles(query.since, query.until);
    const results: AuditEntry[] = [];
    let skipped = 0;

    for (const file of files) {
      const stream = file.endsWith(".gz")
        ? createReadStream(file).pipe(createGunzip())
        : createReadStream(file);

      const rl = createInterface({ input: stream });

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const entry = JSON.parse(line) as AuditEntry;

          // Skip finalization records
          if ("_finalize" in entry) continue;

          // Apply filters
          if (!this.matchesQuery(entry, query)) continue;

          // Handle offset
          if (query.offset && skipped < query.offset) {
            skipped++;
            continue;
          }

          results.push(entry);

          // Check limit
          if (query.limit && results.length >= query.limit) {
            rl.close();
            return results;
          }
        } catch (err) {
          log.warn("Failed to parse audit line", err);
        }
      }
    }

    return results;
  }

  /**
   * Get statistics for audit entries
   */
  async getStats(since?: Date, until?: Date): Promise<AuditStats> {
    const entries = await this.query({ since, until });

    const stats: AuditStats = {
      totalOps: entries.length,
      successCount: 0,
      deniedCount: 0,
      errorCount: 0,
      timeoutCount: 0,
      tierBreakdown: {},
      toolBreakdown: {},
      chainOps: 0,
    };

    for (const entry of entries) {
      // Count by result
      switch (entry.result) {
        case "success":
          stats.successCount++;
          break;
        case "denied":
          stats.deniedCount++;
          break;
        case "error":
          stats.errorCount++;
          break;
        case "timeout":
          stats.timeoutCount++;
          break;
      }

      // Tier breakdown
      const tierKey = `tier-${entry.effectiveTier}`;
      stats.tierBreakdown[tierKey] = (stats.tierBreakdown[tierKey] || 0) + 1;

      // Tool breakdown
      stats.toolBreakdown[entry.tool] = (stats.toolBreakdown[entry.tool] || 0) + 1;

      // Chain operations
      if (entry.txHash) {
        stats.chainOps++;
      }
    }

    return stats;
  }

  /**
   * Get single entry by ID
   */
  async getById(id: string): Promise<AuditEntry | null> {
    const entries = await this.query({ limit: 1000 });
    return entries.find((e) => e.id === id) || null;
  }

  private matchesQuery(entry: AuditEntry, query: AuditQuery): boolean {
    if (query.tool && entry.tool !== query.tool) return false;
    if (query.tier !== undefined && entry.effectiveTier !== query.tier)
      return false;
    if (query.result && entry.result !== query.result) return false;
    if (query.user && entry.user !== query.user) return false;
    if (query.chainId !== undefined && entry.chainId !== query.chainId)
      return false;

    if (query.since) {
      const entryTime = new Date(entry.ts).getTime();
      if (entryTime < query.since.getTime()) return false;
    }

    if (query.until) {
      const entryTime = new Date(entry.ts).getTime();
      if (entryTime > query.until.getTime()) return false;
    }

    return true;
  }

  private async resolveLogFiles(
    since?: Date,
    until?: Date
  ): Promise<string[]> {
    const files: string[] = [this.logPath];

    // Add archived files if querying historical data
    try {
      const archiveFiles = await readdir(this.archiveDir, { encoding: 'utf-8' });
      for (const file of archiveFiles) {
        if (file.startsWith("audit-") && file.endsWith(".jsonl.gz")) {
          files.push(`${this.archiveDir}/${file}`);
        }
      }
    } catch (err) {
      // Archive directory might not exist yet
      log.debug("No archive directory found");
    }

    return files;
  }
}
