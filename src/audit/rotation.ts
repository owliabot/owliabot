/**
 * Audit log rotation and archival
 * @see docs/design/audit-strategy.md Section 4
 */

import { stat, rename, unlink, mkdir, readdir } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { createLogger } from "../utils/logger.js";

const log = createLogger("audit-rotation");

export interface RotationConfig {
  maxSizeMb: number;
  maxAgeDays: number;
  compress: boolean;
  archiveDir: string;
  keepDays: number;
}

export class AuditRotation {
  private config: RotationConfig;
  private logPath: string;

  constructor(
    logPath = "workspace/audit.jsonl",
    config: Partial<RotationConfig> = {}
  ) {
    this.logPath = logPath;
    this.config = {
      maxSizeMb: config.maxSizeMb ?? 50,
      maxAgeDays: config.maxAgeDays ?? 1,
      compress: config.compress ?? true,
      archiveDir: config.archiveDir ?? "workspace/audit",
      keepDays: config.keepDays ?? 90,
    };
  }

  /**
   * Check if rotation is needed and execute if necessary
   */
  async checkRotation(): Promise<boolean> {
    try {
      const stats = await stat(this.logPath);

      // Check size
      const sizeMb = stats.size / (1024 * 1024);
      if (sizeMb >= this.config.maxSizeMb) {
        log.info(`Log file size ${sizeMb.toFixed(2)}MB exceeds limit, rotating`);
        await this.rotate();
        return true;
      }

      // Check age
      const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
      const maxAgeHours = this.config.maxAgeDays * 24;
      if (ageHours >= maxAgeHours) {
        log.info(`Log file age ${ageHours.toFixed(1)}h exceeds limit, rotating`);
        await this.rotate();
        return true;
      }

      return false;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        log.debug("Log file does not exist yet, skipping rotation");
        return false;
      }
      throw err;
    }
  }

  /**
   * Force rotation
   */
  async rotate(): Promise<void> {
    // Ensure archive directory exists
    await mkdir(this.config.archiveDir, { recursive: true });

    // Generate archive filename
    const timestamp = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const archiveName = `audit-${timestamp}.jsonl`;
    const archivePath = `${this.config.archiveDir}/${archiveName}`;

    // Rename current log to archive
    await rename(this.logPath, archivePath);
    log.info(`Rotated log to ${archivePath}`);

    // Compress if enabled
    if (this.config.compress) {
      await this.compressFile(archivePath);
      log.info(`Compressed ${archivePath}`);
    }

    // Clean old archives
    await this.cleanOldArchives();
  }

  /**
   * Compress a file with gzip
   */
  private async compressFile(filePath: string): Promise<void> {
    const gzipPath = `${filePath}.gz`;
    const source = createReadStream(filePath);
    const destination = createWriteStream(gzipPath);
    const gzip = createGzip();

    await pipeline(source, gzip, destination);

    // Remove uncompressed file
    await unlink(filePath);
  }

  /**
   * Delete archives older than keepDays
   */
  private async cleanOldArchives(): Promise<void> {
    try {
      const files = await readdir(this.config.archiveDir);
      const now = Date.now();
      const maxAgeMs = this.config.keepDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (!file.startsWith("audit-")) continue;

        const filePath = `${this.config.archiveDir}/${file}`;
        const stats = await stat(filePath);
        const ageMs = now - stats.mtimeMs;

        if (ageMs > maxAgeMs) {
          await unlink(filePath);
          log.info(`Deleted old archive: ${file}`);
        }
      }
    } catch (err) {
      log.error("Failed to clean old archives", err);
    }
  }

  /**
   * Start periodic rotation check
   */
  startPeriodicCheck(intervalMs = 3600 * 1000): NodeJS.Timeout {
    log.info(
      `Starting periodic rotation check every ${intervalMs / 1000}s`
    );
    return setInterval(() => {
      this.checkRotation().catch((err) =>
        log.error("Rotation check failed", err)
      );
    }, intervalMs);
  }
}
