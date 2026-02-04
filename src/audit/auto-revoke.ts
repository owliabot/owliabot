/**
 * Auto-revoke service for session keys
 * @see docs/design/audit-strategy.md Section 8.3
 */

import { createLogger } from "../utils/logger.js";
import { AnomalyDetector, type AnomalyResult } from "./anomaly.js";
import type { AuditEntry, AuditLogger } from "./logger.js";
import type { SessionKeyLogger } from "./session-key-logger.js";

const log = createLogger("auto-revoke");

export interface AutoRevokeHandlers {
  revokeSessionKey: (reason: string) => Promise<void>;
  pauseTool: (toolName: string, reason: string) => Promise<void>;
  notify: (message: string) => Promise<void>;
  emergencyStop: (reason: string) => Promise<void>;
}

export class AutoRevokeService {
  private recentEntries: AuditEntry[] = [];
  private readonly maxBufferSize = 100;
  private detector: AnomalyDetector;
  private handlers: AutoRevokeHandlers;
  private sessionKeyLogger: SessionKeyLogger;

  constructor(
    handlers: AutoRevokeHandlers,
    sessionKeyLogger: SessionKeyLogger,
    detector?: AnomalyDetector
  ) {
    this.handlers = handlers;
    this.sessionKeyLogger = sessionKeyLogger;
    this.detector = detector ?? new AnomalyDetector();
  }

  /**
   * Called after each audit entry
   */
  async onAuditEntry(entry: AuditEntry): Promise<void> {
    // Add to buffer
    this.recentEntries.push(entry);
    if (this.recentEntries.length > this.maxBufferSize) {
      this.recentEntries.shift();
    }

    // Detect anomalies
    const anomalies = this.detector.detect(this.recentEntries);

    // Execute actions for detected anomalies
    for (const anomaly of anomalies) {
      await this.executeAction(anomaly, entry);
    }
  }

  private async executeAction(
    anomaly: AnomalyResult,
    trigger: AuditEntry
  ): Promise<void> {
    const action = this.detector.getRuleAction(anomaly.ruleId);
    if (!action) {
      log.warn(`No action found for anomaly rule: ${anomaly.ruleId}`);
      return;
    }

    log.warn(`Executing action ${action} for anomaly ${anomaly.ruleId}`, {
      severity: anomaly.severity,
      trigger: trigger.id,
    });

    try {
      switch (action) {
        case "revoke-session-key":
          await this.handlers.revokeSessionKey(anomaly.ruleId);
          // Log the revocation
          if (trigger.sessionKeyId) {
            await this.sessionKeyLogger.log({
              event: "revoked",
              sessionKeyId: trigger.sessionKeyId,
              reason: anomaly.ruleId,
              triggeredBy: `system:auto-revoke:${anomaly.ruleId}`,
            });
          }
          await this.handlers.notify(
            `⚠️ Session Key automatically revoked: ${this.detector.getRuleAction(anomaly.ruleId)}`
          );
          break;

        case "emergency-stop":
          await this.handlers.emergencyStop(anomaly.ruleId);
          await this.handlers.notify(
            `🛑 Emergency stop triggered: ${anomaly.ruleId}`
          );
          break;

        case "notify":
          await this.handlers.notify(
            `🔔 Anomaly detected: ${anomaly.ruleId} (severity: ${anomaly.severity})`
          );
          break;

        case "pause-tool":
          await this.handlers.pauseTool(trigger.tool, anomaly.ruleId);
          await this.handlers.notify(
            `⏸️ Tool ${trigger.tool} paused: ${anomaly.ruleId}`
          );
          break;
      }
    } catch (err) {
      log.error(`Failed to execute action ${action}`, err);
      // Don't throw - we don't want anomaly handling to break the main flow
    }
  }

  getRecentEntries(): AuditEntry[] {
    return [...this.recentEntries];
  }

  reset(): void {
    this.recentEntries = [];
  }
}
