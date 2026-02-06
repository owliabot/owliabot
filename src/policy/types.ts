/**
 * Policy types for Tier-based security
 * @see docs/design/tier-policy.md
 *
 * Note: Wallet signing (signer selection) is delegated to Clawlet.
 * This module handles tool execution policy and access control.
 */

export type Tier = "none" | 1 | 2 | 3;
export type ConfirmationChannel = "companion-app" | "inline" | "notification";

/** Policy configuration for a single tool */
export interface ToolPolicy {
  tier: Tier;
  requireConfirmation?: boolean;
  confirmationChannel?: ConfirmationChannel;
  maxAmount?: {
    usd?: number;
    eth?: string;
    token?: string;
  };
  cooldown?: {
    maxPerHour?: number;
    maxPerDay?: number;
    minIntervalMs?: number;
  };
  allowedUsers?: "assignee-only" | string[];
  escalateAbove?: {
    usd?: number;
  };
  timeout?: number; // seconds
}

/** Resolved policy after applying defaults and wildcards */
export interface ResolvedPolicy {
  tier: Tier;
  requireConfirmation: boolean;
  confirmationChannel: ConfirmationChannel;
  maxAmount?: {
    usd?: number;
    eth?: string;
    token?: string;
  };
  cooldown?: {
    maxPerHour?: number;
    maxPerDay?: number;
    minIntervalMs?: number;
  };
  allowedUsers: "assignee-only" | string[];
  escalateAbove?: {
    usd?: number;
  };
  timeout: number;
}

/** Policy decision result */
export interface PolicyDecision {
  action: "allow" | "confirm" | "deny" | "escalate";
  tier: Tier;
  effectiveTier: Tier; // after escalation
  reason?: string;
  confirmationChannel?: ConfirmationChannel;
}

/** Tier confirmation request (sent to Companion App or inline) */
export interface TierConfirmationRequest {
  requestId: string;
  tool: string;
  tier: Tier;
  channel: ConfirmationChannel;
  params: Record<string, unknown>; // redacted
  amount?: {
    value: string;
    currency: string;
    usdEquivalent: number;
  };
  expiresAt: number; // unix timestamp
  createdAt: number;
}

/** Tier confirmation response */
export interface TierConfirmationResponse {
  requestId: string;
  approved: boolean;
  respondedAt: number;
  respondedBy: string;
}

/** Cooldown tracking state */
export interface CooldownState {
  toolName: string;
  hourlyCount: number;
  dailyCount: number;
  hourlyResetAt: number;
  dailyResetAt: number;
  lastExecutedAt: number;
}

/** Escalation context for decision making */
export interface EscalationContext {
  amountUsd?: number;
  thresholds: {
    tier3MaxUsd: number;
    tier2MaxUsd: number;
    tier2DailyUsd: number;
  };
  dailySpentUsd: number;
  consecutiveDenials: number;
}
