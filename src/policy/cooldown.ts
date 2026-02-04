/**
 * Cooldown tracker for tool execution rate limiting
 * @see docs/design/tier-policy.md Section 5.3
 */

import { createLogger } from "../utils/logger.js";
import type { CooldownState, ResolvedPolicy } from "./types.js";

const log = createLogger("cooldown");

export class CooldownTracker {
  private state = new Map<string, CooldownState>();

  /**
   * Check if tool execution is allowed under cooldown limits
   */
  check(toolName: string, policy: ResolvedPolicy): {
    allowed: boolean;
    reason?: string;
  } {
    if (!policy.cooldown) {
      return { allowed: true };
    }

    const now = Date.now();
    const state = this.state.get(toolName);

    if (!state) {
      // First execution - allowed
      return { allowed: true };
    }

    const { cooldown } = policy;

    // Check hourly limit
    if (cooldown.maxPerHour !== undefined) {
      if (now < state.hourlyResetAt) {
        if (state.hourlyCount >= cooldown.maxPerHour) {
          log.warn(
            `Tool ${toolName} exceeded hourly limit: ${state.hourlyCount}/${cooldown.maxPerHour}`
          );
          return {
            allowed: false,
            reason: `Hourly limit exceeded (${cooldown.maxPerHour} per hour)`,
          };
        }
      }
    }

    // Check daily limit
    if (cooldown.maxPerDay !== undefined) {
      if (now < state.dailyResetAt) {
        if (state.dailyCount >= cooldown.maxPerDay) {
          log.warn(
            `Tool ${toolName} exceeded daily limit: ${state.dailyCount}/${cooldown.maxPerDay}`
          );
          return {
            allowed: false,
            reason: `Daily limit exceeded (${cooldown.maxPerDay} per day)`,
          };
        }
      }
    }

    // Check minimum interval
    if (cooldown.minIntervalMs !== undefined) {
      const timeSinceLastExec = now - state.lastExecutedAt;
      if (timeSinceLastExec < cooldown.minIntervalMs) {
        log.warn(
          `Tool ${toolName} called too soon: ${timeSinceLastExec}ms < ${cooldown.minIntervalMs}ms`
        );
        return {
          allowed: false,
          reason: `Please wait ${Math.ceil((cooldown.minIntervalMs - timeSinceLastExec) / 1000)}s before retrying`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Record tool execution
   */
  record(toolName: string, policy: ResolvedPolicy): void {
    if (!policy.cooldown) {
      return;
    }

    const now = Date.now();
    const state = this.state.get(toolName);

    if (!state) {
      // Initialize state
      this.state.set(toolName, {
        toolName,
        hourlyCount: 1,
        dailyCount: 1,
        hourlyResetAt: now + 3600 * 1000, // 1 hour
        dailyResetAt: now + 24 * 3600 * 1000, // 24 hours
        lastExecutedAt: now,
      });
      return;
    }

    // Reset hourly counter if needed
    if (now >= state.hourlyResetAt) {
      state.hourlyCount = 0;
      state.hourlyResetAt = now + 3600 * 1000;
    }

    // Reset daily counter if needed
    if (now >= state.dailyResetAt) {
      state.dailyCount = 0;
      state.dailyResetAt = now + 24 * 3600 * 1000;
    }

    // Increment counters
    state.hourlyCount++;
    state.dailyCount++;
    state.lastExecutedAt = now;
  }

  /**
   * Get current state for a tool
   */
  getState(toolName: string): CooldownState | undefined {
    return this.state.get(toolName);
  }

  /**
   * Reset all cooldowns (for testing or admin reset)
   */
  reset(): void {
    this.state.clear();
  }

  /**
   * Reset cooldown for a specific tool
   */
  resetTool(toolName: string): void {
    this.state.delete(toolName);
  }
}
