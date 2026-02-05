/**
 * Signer Router - routes skill signer calls through TierPolicy
 * Handles callSigner(operation, params) calls from skills and applies
 * the appropriate confirmation flow based on tier policy decisions.
 *
 * @see docs/design/skill-system.md Section 3.2
 * @see docs/design/tier-policy.md
 */

import { createLogger } from "../utils/logger.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { PolicyDecision, EscalationContext } from "../policy/types.js";
import type { AuditLogger, AuditEntry } from "../audit/logger.js";
import type { SignerTier } from "../signer/interface.js";
import type {
  SignerService,
  SignerCall,
  SignerRouterContext,
  SignerRouterResult,
  SessionKeyStatus,
} from "./signer-service-interface.js";

const log = createLogger("signer-router");

/**
 * Options for creating a SignerRouter instance
 */
export interface SignerRouterOptions {
  /** Policy engine for tier evaluation */
  policyEngine: PolicyEngine;
  /** Signer service for executing operations */
  signerService: SignerService;
  /** Optional audit logger (fail-closed if provided) */
  auditLogger?: AuditLogger;
  /** Timeout for inline confirmation (ms), default 120000 (2 min) */
  confirmationTimeoutMs?: number;
}

/**
 * SignerRouter handles callSigner() calls from skills and routes them
 * through the TierPolicy system, handling:
 * - Tier 3 (allow): auto-execute with session key
 * - Tier 2 (confirm): inline confirmation + session key
 * - Tier 1 (escalate): Companion App required
 * - Deny: return error with reason
 */
export class SignerRouter {
  private policyEngine: PolicyEngine;
  private signerService: SignerService;
  private auditLogger?: AuditLogger;
  private confirmationTimeoutMs: number;

  constructor(options: SignerRouterOptions) {
    this.policyEngine = options.policyEngine;
    this.signerService = options.signerService;
    this.auditLogger = options.auditLogger;
    this.confirmationTimeoutMs = options.confirmationTimeoutMs ?? 120_000;
  }

  /**
   * Route a signer call through the tier policy system
   * @param call - The signer call from a skill
   * @param context - Execution context with user info and confirmation callback
   * @returns Result of the operation
   */
  async callSigner(
    call: SignerCall,
    context: SignerRouterContext
  ): Promise<SignerRouterResult> {
    log.info(`Signer call: ${call.operation}`, {
      userId: context.userId,
      estimatedValueUsd: call.estimatedValueUsd,
    });

    // Build escalation context for policy decision
    const escalationContext = await this.buildEscalationContext(context);

    // 1. Evaluate tier policy
    const decision = await this.policyEngine.decide(
      call.operation,
      call.params,
      escalationContext
    );

    log.debug("Policy decision", {
      operation: call.operation,
      action: decision.action,
      tier: decision.tier,
      effectiveTier: decision.effectiveTier,
      signerTier: decision.signerTier,
    });

    // Pre-log audit entry (fail-closed)
    let auditId: string | undefined;
    if (this.auditLogger) {
      const preLog = await this.auditLogger.preLog({
        tool: call.operation,
        tier: decision.tier,
        effectiveTier: decision.effectiveTier,
        securityLevel: "sign",
        user: context.userId,
        channel: context.channel,
        deviceId: context.deviceId,
        params: call.params as Record<string, unknown>,
        amountUsd: call.estimatedValueUsd,
        signerTier: decision.signerTier,
      });

      if (!preLog.ok) {
        log.error("Audit pre-log failed, blocking operation");
        return {
          success: false,
          error: "Audit log write failed, operation blocked",
        };
      }
      auditId = preLog.id;
    }

    // 2. Handle based on decision
    try {
      const result = await this.handleDecision(call, decision, context);

      // Finalize audit
      if (this.auditLogger && auditId) {
        await this.auditLogger.finalize(
          auditId,
          result.success ? "success" : "denied",
          result.error,
          result.data?.txHash
        );
      }

      return {
        ...result,
        auditId,
        effectiveTier: decision.effectiveTier,
        confirmationRequired: decision.action === "confirm",
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error("Signer call failed", { error: errorMsg, operation: call.operation });

      if (this.auditLogger && auditId) {
        await this.auditLogger.finalize(auditId, "error", errorMsg);
      }

      return {
        success: false,
        error: errorMsg,
        auditId,
      };
    }
  }

  /**
   * Handle the policy decision and execute the appropriate flow
   */
  private async handleDecision(
    call: SignerCall,
    decision: PolicyDecision,
    context: SignerRouterContext
  ): Promise<SignerRouterResult> {
    switch (decision.action) {
      case "allow":
        // Tier 3: auto-execute with session key
        log.info(`Auto-executing ${call.operation} (Tier ${decision.effectiveTier})`);
        return this.executeSigner(call, decision.signerTier);

      case "confirm":
        // Tier 2: inline confirmation required
        return this.handleConfirmation(call, decision, context);

      case "escalate":
        // Tier 1: Companion App required (not implemented yet)
        log.warn(`Escalation required for ${call.operation} (Tier 1)`);
        if (context.sendMessage) {
          await context.sendMessage(
            "⏳ This operation requires Companion App confirmation (not yet implemented)."
          );
        }
        return {
          success: false,
          error: "Tier 1 operations require Companion App (not yet implemented)",
        };

      case "deny":
        log.warn(`Operation denied: ${call.operation}`, { reason: decision.reason });
        return {
          success: false,
          error: decision.reason ?? "Operation denied by policy",
        };

      default: {
        // Exhaustive check
        const _exhaustive: never = decision.action;
        return {
          success: false,
          error: `Unknown policy action: ${decision.action}`,
        };
      }
    }
  }

  /**
   * Handle Tier 2 inline confirmation flow
   */
  private async handleConfirmation(
    call: SignerCall,
    decision: PolicyDecision,
    context: SignerRouterContext
  ): Promise<SignerRouterResult> {
    const confirmationChannel = decision.confirmationChannel ?? "inline";

    // For Tier 1 (companion-app), we don't have that implemented yet
    if (confirmationChannel === "companion-app") {
      return {
        success: false,
        error: "Companion App confirmation not yet implemented",
      };
    }

    // Format and request inline confirmation
    const confirmMsg = this.formatConfirmationMessage(call);
    log.info(`Requesting inline confirmation for ${call.operation}`);

    let confirmed: boolean;
    try {
      confirmed = await this.withTimeout(
        context.askConfirmation(confirmMsg),
        this.confirmationTimeoutMs
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        log.warn(`Confirmation timeout for ${call.operation}`);
        return {
          success: false,
          error: "Confirmation timed out",
        };
      }
      throw err;
    }

    if (!confirmed) {
      log.info(`User rejected ${call.operation}`);
      return {
        success: false,
        error: "User rejected",
      };
    }

    // User confirmed, execute
    log.info(`User confirmed ${call.operation}, executing...`);
    return this.executeSigner(call, decision.signerTier);
  }

  /**
   * Execute the signer operation
   */
  private async executeSigner(
    call: SignerCall,
    signerTier: SignerTier
  ): Promise<SignerRouterResult> {
    if (!this.signerService.canExecute(signerTier)) {
      return {
        success: false,
        error: `Signer not available for tier: ${signerTier}`,
      };
    }

    const result = await this.signerService.execute(
      call.operation,
      call.params,
      signerTier
    );

    return result;
  }

  /**
   * Build escalation context from router context
   */
  private async buildEscalationContext(
    context: SignerRouterContext
  ): Promise<EscalationContext> {
    const sessionKeyStatus = await this.signerService.getSessionKeyStatus();
    const thresholds = await this.policyEngine.getThresholds();

    return {
      sessionKey: sessionKeyStatus.available
        ? {
            id: sessionKeyStatus.id ?? "unknown",
            expired: sessionKeyStatus.expired,
            revoked: sessionKeyStatus.revoked,
          }
        : undefined,
      thresholds,
      dailySpentUsd: context.dailySpentUsd ?? 0,
      consecutiveDenials: context.consecutiveDenials ?? 0,
    };
  }

  /**
   * Format a human-readable confirmation message
   */
  private formatConfirmationMessage(call: SignerCall): string {
    const parts: string[] = [];

    // Operation header
    parts.push(`🔐 Confirm ${this.humanizeOperation(call.operation)}?`);
    parts.push("");

    // Amount if available
    if (call.estimatedValueUsd !== undefined && call.estimatedValueUsd > 0) {
      parts.push(`💰 Amount: ~$${call.estimatedValueUsd.toFixed(2)} USD`);
    }

    // Key parameters (redacted sensitive data)
    const safeParams = this.extractSafeParams(call.params);
    if (Object.keys(safeParams).length > 0) {
      parts.push("");
      for (const [key, value] of Object.entries(safeParams)) {
        parts.push(`  ${key}: ${value}`);
      }
    }

    parts.push("");
    parts.push("Reply 'yes' to confirm or 'no' to cancel.");

    return parts.join("\n");
  }

  /**
   * Convert operation name to human-readable format
   */
  private humanizeOperation(operation: string): string {
    // "transfer__send_token" -> "Transfer: Send Token"
    // "dex-swap__swap" -> "DEX Swap: Swap"
    return operation
      .split("__")
      .map((part) =>
        part
          .split(/[-_]/)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ")
      )
      .join(": ");
  }

  /**
   * Extract safe-to-display parameters
   */
  private extractSafeParams(
    params: Record<string, unknown>
  ): Record<string, string> {
    const safe: Record<string, string> = {};
    const displayKeys = ["to", "amount", "token", "chain", "symbol", "from"];
    const sensitivePatterns = [/key/i, /secret/i, /password/i, /private/i];

    for (const [key, value] of Object.entries(params)) {
      // Skip sensitive keys
      if (sensitivePatterns.some((p) => p.test(key))) continue;

      // Only include known safe keys
      if (!displayKeys.includes(key)) continue;

      // Format value
      if (typeof value === "string") {
        // Truncate addresses
        if (value.startsWith("0x") && value.length > 20) {
          safe[key] = `${value.slice(0, 10)}...${value.slice(-6)}`;
        } else if (value.length > 50) {
          safe[key] = `${value.slice(0, 47)}...`;
        } else {
          safe[key] = value;
        }
      } else if (typeof value === "number" || typeof value === "bigint") {
        safe[key] = String(value);
      }
    }

    return safe;
  }

  /**
   * Wrap a promise with a timeout
   */
  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new TimeoutError(`Operation timed out after ${ms}ms`));
      }, ms);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (err) {
      clearTimeout(timeoutId!);
      throw err;
    }
  }
}

/**
 * Custom timeout error
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Factory function for creating SignerRouter with default dependencies
 */
export function createSignerRouter(
  options: SignerRouterOptions
): SignerRouter {
  return new SignerRouter(options);
}
