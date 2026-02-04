/**
 * Anomaly detection rules
 * @see docs/design/audit-strategy.md Section 8.2
 */

import { createLogger } from "../utils/logger.js";
import type { AuditEntry } from "./logger.js";

const log = createLogger("anomaly");

export type AnomalyAction =
  | "revoke-session-key"
  | "pause-tool"
  | "notify"
  | "emergency-stop";

export interface AnomalyResult {
  ruleId: string;
  severity: "low" | "medium" | "high" | "critical";
  details?: Record<string, unknown>;
}

export interface AnomalyRule {
  id: string;
  description: string;
  check: (recentEntries: AuditEntry[]) => AnomalyResult | null;
  action: AnomalyAction;
}

export const defaultRules: AnomalyRule[] = [
  {
    id: "consecutive-denials",
    description: "3 consecutive user denials",
    check: (entries) => {
      const recent = entries.slice(-3);
      if (recent.length === 3 && recent.every((e) => e.result === "denied")) {
        return { ruleId: "consecutive-denials", severity: "high" };
      }
      return null;
    },
    action: "revoke-session-key",
  },

  {
    id: "rapid-sign-failures",
    description: "5+ signature failures in 10 minutes",
    check: (entries) => {
      const tenMinAgo = Date.now() - 10 * 60 * 1000;
      const failures = entries.filter(
        (e) =>
          e.result === "error" &&
          e.securityLevel === "sign" &&
          new Date(e.ts).getTime() > tenMinAgo
      );
      if (failures.length >= 5) {
        return { ruleId: "rapid-sign-failures", severity: "critical" };
      }
      return null;
    },
    action: "emergency-stop",
  },

  {
    id: "high-error-rate",
    description: "More than 50% errors in last 10 operations",
    check: (entries) => {
      const last10 = entries.slice(-10);
      if (last10.length >= 10) {
        const errorCount = last10.filter((e) => e.result === "error").length;
        if (errorCount >= 5) {
          return {
            ruleId: "high-error-rate",
            severity: "medium",
            details: { errorRate: errorCount / 10 },
          };
        }
      }
      return null;
    },
    action: "notify",
  },

  {
    id: "tier-1-burst",
    description: "More than 5 Tier 1 operations in 1 hour",
    check: (entries) => {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const tier1Ops = entries.filter(
        (e) =>
          e.effectiveTier === 1 && new Date(e.ts).getTime() > oneHourAgo
      );
      if (tier1Ops.length > 5) {
        return {
          ruleId: "tier-1-burst",
          severity: "medium",
          details: { count: tier1Ops.length },
        };
      }
      return null;
    },
    action: "notify",
  },
];

export class AnomalyDetector {
  private rules: AnomalyRule[];

  constructor(rules: AnomalyRule[] = defaultRules) {
    this.rules = rules;
  }

  detect(recentEntries: AuditEntry[]): AnomalyResult[] {
    const anomalies: AnomalyResult[] = [];

    for (const rule of this.rules) {
      try {
        const result = rule.check(recentEntries);
        if (result) {
          log.warn(`Anomaly detected: ${rule.description}`, result);
          anomalies.push(result);
        }
      } catch (err) {
        log.error(`Anomaly rule ${rule.id} failed`, err);
      }
    }

    return anomalies;
  }

  getRuleAction(ruleId: string): AnomalyAction | undefined {
    return this.rules.find((r) => r.id === ruleId)?.action;
  }

  addRule(rule: AnomalyRule): void {
    this.rules.push(rule);
  }

  removeRule(ruleId: string): void {
    this.rules = this.rules.filter((r) => r.id !== ruleId);
  }
}
