/**
 * Policy engine - resolves and decides tool execution policies
 * @see docs/design/tier-policy.md Section 5
 */

import { minimatch } from "minimatch";
import { createLogger } from "../utils/logger.js";
import { PolicyLoader } from "./loader.js";
import type {
  Tier,
  ToolPolicy,
  ResolvedPolicy,
  PolicyDecision,
  EscalationContext,
} from "./types.js";
import type { PolicyConfig } from "./schema.js";
import type { SignerTier } from "../signer/interface.js";

const log = createLogger("policy-engine");

export class PolicyEngine {
  private loader: PolicyLoader;

  constructor(policyPath?: string) {
    this.loader = new PolicyLoader(policyPath);
  }

  /**
   * Resolve policy for a tool (exact match -> wildcard -> fallback)
   */
  /**
   * Get loaded policy thresholds for building EscalationContext
   */
  async getThresholds(): Promise<{
    tier3MaxUsd: number;
    tier2MaxUsd: number;
    tier2DailyUsd: number;
  }> {
    const config = await this.loader.load();
    return {
      tier3MaxUsd: config.thresholds.tier3MaxUsd,
      tier2MaxUsd: config.thresholds.tier2MaxUsd,
      tier2DailyUsd: config.thresholds.tier2DailyUsd,
    };
  }

  async resolve(toolName: string): Promise<ResolvedPolicy> {
    const config = await this.loader.load();

    // 1. Exact match
    if (config.tools[toolName]) {
      log.debug(`Policy matched (exact): ${toolName}`);
      return this.mergeWithDefaults(config.tools[toolName], config);
    }

    // 2. Wildcard match (first match wins)
    if (config.wildcards) {
      for (const wildcard of config.wildcards) {
        if (minimatch(toolName, wildcard.pattern)) {
          log.debug(`Policy matched (wildcard): ${toolName} <- ${wildcard.pattern}`);
          const { pattern, ...policy } = wildcard;
          return this.mergeWithDefaults(policy, config);
        }
      }
    }

    // 3. Fallback
    log.debug(`Policy matched (fallback): ${toolName}`);
    return this.mergeWithDefaults(config.fallback, config);
  }

  /**
   * Decide execution based on policy and context
   */
  async decide(
    toolName: string,
    params: unknown,
    context: EscalationContext
  ): Promise<PolicyDecision> {
    const policy = await this.resolve(toolName);

    // 1. Session Key availability check
    let effectiveTier = policy.tier;
    if (effectiveTier === 2 || effectiveTier === 3) {
      if (
        !context.sessionKey ||
        context.sessionKey.expired ||
        context.sessionKey.revoked
      ) {
        log.warn(`Session key unavailable, escalating ${toolName} to Tier 1`);
        return {
          action: "escalate",
          tier: policy.tier,
          effectiveTier: 1,
          reason: "session-key-unavailable",
          signerTier: "app",
          confirmationChannel: "companion-app",
        };
      }
    }

    // 2. Amount threshold check
    if (context.amountUsd !== undefined) {
      if (effectiveTier === 3 && context.amountUsd > context.thresholds.tier3MaxUsd) {
        effectiveTier = 2;
        log.info(`Amount exceeds Tier 3 limit, escalating ${toolName} to Tier 2`);
      }
      if (
        effectiveTier === 2 &&
        policy.escalateAbove?.usd &&
        context.amountUsd > policy.escalateAbove.usd
      ) {
        effectiveTier = 1;
        log.info(
          `Amount exceeds escalateAbove threshold, escalating ${toolName} to Tier 1`
        );
        return {
          action: "escalate",
          tier: policy.tier,
          effectiveTier: 1,
          reason: "escalate-above-threshold",
          signerTier: "app",
          confirmationChannel: "companion-app",
        };
      }
    }

    // 3. Daily limit check (include pending amount)
    const effectiveDailySpent = context.dailySpentUsd + (context.amountUsd ?? 0);
    if (
      effectiveTier === 2 &&
      effectiveDailySpent > context.thresholds.tier2DailyUsd
    ) {
      log.warn(
        `Daily spending limit exceeded, escalating ${toolName} to Tier 1`
      );
      return {
        action: "escalate",
        tier: policy.tier,
        effectiveTier: 1,
        reason: "daily-limit-exceeded",
        signerTier: "app",
        confirmationChannel: "companion-app",
      };
    }

    // 4. Consecutive denials check
    if (context.consecutiveDenials >= 3) {
      log.error(`Consecutive denials threshold reached for ${toolName}`);
      return {
        action: "deny",
        tier: policy.tier,
        effectiveTier: effectiveTier,
        reason: "consecutive-denials-halt",
        signerTier: this.mapTierToSigner(effectiveTier),
      };
    }

    // 5. Map to signer tier
    const signerTier = this.mapTierToSigner(effectiveTier);

    // 6. Determine action
    if (effectiveTier === "none") {
      return {
        action: "allow",
        tier: policy.tier,
        effectiveTier,
        signerTier,
      };
    }

    // Tier 1 ALWAYS requires confirmation (security invariant)
    if (effectiveTier === 1 || policy.requireConfirmation) {
      return {
        action: "confirm",
        tier: policy.tier,
        effectiveTier,
        signerTier,
        confirmationChannel:
          effectiveTier === 1 ? "companion-app" : policy.confirmationChannel,
      };
    }

    return {
      action: "allow",
      tier: policy.tier,
      effectiveTier,
      signerTier,
    };
  }

  private mergeWithDefaults(
    policy: Partial<ToolPolicy>,
    config: PolicyConfig
  ): ResolvedPolicy {
    const defaults = config.defaults;
    return {
      tier: policy.tier ?? defaults.tier ?? "none",
      requireConfirmation: policy.requireConfirmation ?? defaults.requireConfirmation ?? false,
      confirmationChannel: policy.confirmationChannel ?? defaults.confirmationChannel ?? "inline",
      maxAmount: policy.maxAmount ?? defaults.maxAmount ?? undefined,
      cooldown: policy.cooldown ?? defaults.cooldown ?? undefined,
      allowedUsers: policy.allowedUsers ?? defaults.allowedUsers ?? "assignee-only",
      escalateAbove: policy.escalateAbove ?? defaults.escalateAbove ?? undefined,
      timeout: policy.timeout ?? defaults.timeout ?? 120,
    };
  }

  private mapTierToSigner(tier: Tier): SignerTier {
    if (tier === 1) return "app";
    if (tier === 2 || tier === 3) return "session-key";
    return "none"; // tier none doesn't need signing
  }

  async reload(): Promise<void> {
    await this.loader.reload();
  }
}
