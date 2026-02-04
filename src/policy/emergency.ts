/**
 * Emergency stop system
 * @see docs/design/tier-policy.md Section 7
 */

import { createLogger } from "../utils/logger.js";
import type { SessionKeyLogger } from "../audit/session-key-logger.js";
import type { AuditLogger } from "../audit/logger.js";

const log = createLogger("emergency");

export interface EmergencyStopHandlers {
  revokeAllSessionKeys: () => Promise<string[]>;
  pauseAllToolExecution: () => Promise<void>;
  resumeAllToolExecution: () => Promise<void>;
  notify: (message: string) => Promise<void>;
}

export class EmergencyStop {
  private stopped = false;
  private handlers: EmergencyStopHandlers;
  private sessionKeyLogger: SessionKeyLogger;
  private auditLogger: AuditLogger;

  constructor(
    handlers: EmergencyStopHandlers,
    sessionKeyLogger: SessionKeyLogger,
    auditLogger: AuditLogger
  ) {
    this.handlers = handlers;
    this.sessionKeyLogger = sessionKeyLogger;
    this.auditLogger = auditLogger;
  }

  /**
   * Execute emergency stop
   */
  async execute(reason: string, triggeredBy: string): Promise<void> {
    if (this.stopped) {
      log.warn("Emergency stop already active");
      return;
    }

    log.error(`Emergency stop triggered: ${reason} by ${triggeredBy}`);
    this.stopped = true;

    try {
      // 1. Revoke all session keys
      const revokedKeys = await this.handlers.revokeAllSessionKeys();
      log.info(`Revoked ${revokedKeys.length} session keys`);

      // 2. Log revocations
      for (const keyId of revokedKeys) {
        await this.sessionKeyLogger.log({
          event: "revoked",
          sessionKeyId: keyId,
          reason: `emergency-stop:${reason}`,
          triggeredBy,
        });
      }

      // 3. Pause all tool execution
      await this.handlers.pauseAllToolExecution();

      // 4. Write audit log
      await this.auditLogger.preLog({
        tool: "system:emergency-stop",
        tier: 1,
        effectiveTier: 1,
        securityLevel: "write",
        user: triggeredBy,
        channel: "system",
        params: { reason, revokedKeys: revokedKeys.length },
        result: "success",
      });

      // 5. Notify user
      await this.handlers.notify(
        `🛑 **Emergency Stop Executed**\n\n` +
          `Reason: ${reason}\n` +
          `Triggered by: ${triggeredBy}\n` +
          `Revoked session keys: ${revokedKeys.length}\n` +
          `All tool execution paused\n\n` +
          `To resume, use Companion App recovery`
      );

      log.info("Emergency stop completed successfully");
    } catch (err) {
      log.error("Emergency stop execution failed", err);
      // Still mark as stopped to prevent further operations
      throw err;
    }
  }

  /**
   * Resume from emergency stop
   */
  async resume(authorizedBy: string): Promise<void> {
    if (!this.stopped) {
      log.warn("Emergency stop not active");
      return;
    }

    log.info(`Resuming from emergency stop, authorized by ${authorizedBy}`);

    try {
      // 1. Resume tool execution
      await this.handlers.resumeAllToolExecution();

      // 2. Write audit log
      await this.auditLogger.preLog({
        tool: "system:emergency-resume",
        tier: 1,
        effectiveTier: 1,
        securityLevel: "write",
        user: authorizedBy,
        channel: "companion-app",
        params: {},
        result: "success",
      });

      // 3. Notify user
      await this.handlers.notify(
        `✅ **Emergency Stop Resumed**\n\n` +
          `Authorized by: ${authorizedBy}\n` +
          `Tool execution resumed\n` +
          `Note: You need to create new session keys for Tier 2/3 operations`
      );

      this.stopped = false;
      log.info("Emergency stop resumed successfully");
    } catch (err) {
      log.error("Emergency resume failed", err);
      throw err;
    }
  }

  isStopped(): boolean {
    return this.stopped;
  }

  /**
   * Check if a command is an emergency stop command
   */
  static isEmergencyCommand(
    message: string,
    commands: string[] = ["/stop", "/emergency", "/halt"]
  ): boolean {
    const normalizedMsg = message.trim().toLowerCase();
    return commands.some((cmd) => normalizedMsg === cmd.toLowerCase());
  }
}
