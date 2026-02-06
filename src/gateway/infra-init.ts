// src/gateway/infra-init.ts
/**
 * Infrastructure initialization module.
 * Handles InfraStore creation and cleanup scheduling.
 */

import { createLogger } from "../utils/logger.js";
import { createInfraStore, type InfraStore } from "../infra/index.js";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";

const log = createLogger("gateway:infra");

/**
 * Configuration for infrastructure initialization.
 */
export interface InfraInitConfig {
  /** Whether infra is enabled (default: true) */
  enabled?: boolean;
  /** Path to SQLite database file (supports ~ expansion) */
  sqlitePath?: string;
}

/**
 * Infrastructure context returned by createInfraContext.
 * Contains the store and cleanup resources.
 */
export interface InfraContext {
  /** The infrastructure store instance (null if disabled) */
  store: InfraStore | null;
  /** Cleanup interval handle (null if not scheduled) */
  cleanupInterval: NodeJS.Timeout | null;
}

/**
 * Creates the infrastructure context with InfraStore.
 * 
 * @param config - Infrastructure configuration
 * @returns Infrastructure context with store
 * 
 * @example
 * ```ts
 * const infraCtx = createInfraContext({ enabled: true });
 * // Use infraCtx.store for rate limiting, idempotency, events
 * ```
 */
export function createInfraContext(config?: InfraInitConfig): InfraContext {
  if (config?.enabled === false) {
    log.debug("Infrastructure store disabled");
    return { store: null, cleanupInterval: null };
  }

  // Resolve database path with ~ expansion
  const dbPath = config?.sqlitePath?.replace(/^~/, homedir()) 
    ?? join(homedir(), ".owliabot", "infra.db");

  // Ensure parent directory exists
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const store = createInfraStore({ sqlitePath: dbPath });
  log.info(`Infrastructure store initialized: ${dbPath}`);

  return { store, cleanupInterval: null };
}

/**
 * Schedules periodic cleanup for the infrastructure store.
 * Removes expired idempotency records and events.
 * 
 * @param ctx - Infrastructure context
 * @param intervalMs - Cleanup interval in milliseconds (default: 5 minutes)
 * @returns Updated context with cleanup interval handle
 * 
 * @example
 * ```ts
 * const ctx = createInfraContext({ enabled: true });
 * scheduleInfraCleanup(ctx, 5 * 60 * 1000); // 5 minutes
 * ```
 */
export function scheduleInfraCleanup(
  ctx: InfraContext,
  intervalMs: number = 5 * 60 * 1000,
): InfraContext {
  if (!ctx.store) {
    return ctx;
  }

  // Clear existing interval if any
  if (ctx.cleanupInterval) {
    clearInterval(ctx.cleanupInterval);
  }

  const cleanupInterval = setInterval(() => {
    ctx.store?.cleanup(Date.now());
    log.debug("Infrastructure cleanup completed");
  }, intervalMs);

  log.debug(`Infrastructure cleanup scheduled: every ${intervalMs}ms`);
  return { ...ctx, cleanupInterval };
}

/**
 * Stops infrastructure cleanup and closes the store.
 * Should be called during gateway shutdown.
 * 
 * @param ctx - Infrastructure context to cleanup
 */
export function cleanupInfraContext(ctx: InfraContext): void {
  if (ctx.cleanupInterval) {
    clearInterval(ctx.cleanupInterval);
  }

  if (ctx.store) {
    // Run final cleanup before closing
    ctx.store.cleanup(Date.now());
    ctx.store.close();
    log.debug("Infrastructure store closed");
  }
}
