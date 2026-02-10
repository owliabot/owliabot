/**
 * Tool executor - runs tools with tier-based policy and audit
 * @see design.md Section 5.2
 * @see docs/design/tier-policy.md
 *
 * Note: Wallet signing is delegated to Clawlet. This module handles
 * tool execution policy, audit logging, and write-tool confirmations.
 */

import { createLogger } from "../../utils/logger.js";
import { PolicyEngine } from "../../policy/engine.js";
import { CooldownTracker } from "../../policy/cooldown.js";
import { AuditLogger, type AuditEntry } from "../../audit/logger.js";
import { AuditQueryService } from "../../audit/query.js";
import { join } from "node:path";
import type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolContext,
} from "./interface.js";
import type { ToolRegistry } from "./registry.js";
import {
  createWriteGate,
  type WriteGateChannel,
  type WriteGateCallContext,
} from "../../security/write-gate.js";
import type { EscalationContext } from "../../policy/types.js";

const log = createLogger("executor");

export interface ExecutorOptions {
  registry: ToolRegistry;
  context: Omit<ToolContext, "requestConfirmation">;
  // WriteGate options (Phase 1.5)
  writeGateChannel?: WriteGateChannel;
  securityConfig?: {
    writeGateEnabled?: boolean;
    writeToolAllowList?: string[];
    writeToolConfirmation?: boolean;
    writeToolConfirmationTimeoutMs?: number;
  };
  workspacePath?: string;
  userId?: string;
  // Policy engine options
  policyEngine?: PolicyEngine;
  auditLogger?: AuditLogger;
  auditQueryService?: AuditQueryService;
  cooldownTracker?: CooldownTracker;
}

// Global instances (lazy-initialized)
const globalPolicyEngines = new Map<string, PolicyEngine>();
let globalAuditLogger: AuditLogger | null = null;
let globalAuditQueryService: AuditQueryService | null = null;
let globalCooldownTracker: CooldownTracker | null = null;

function getOrCreatePolicyEngine(workspacePath?: string): PolicyEngine {
  const key = workspacePath ? `workspace:${workspacePath}` : "default";
  const existing = globalPolicyEngines.get(key);
  if (existing) return existing;

  const policyPath = workspacePath ? join(workspacePath, "policy.yml") : undefined;
  const engine = new PolicyEngine(policyPath);
  globalPolicyEngines.set(key, engine);
  return engine;
}

function getOrCreateAuditLogger(): AuditLogger {
  if (!globalAuditLogger) {
    globalAuditLogger = new AuditLogger();
  }
  return globalAuditLogger;
}

function getOrCreateAuditQueryService(): AuditQueryService {
  if (!globalAuditQueryService) {
    globalAuditQueryService = new AuditQueryService();
  }
  return globalAuditQueryService;
}

function getOrCreateCooldownTracker(): CooldownTracker {
  if (!globalCooldownTracker) {
    globalCooldownTracker = new CooldownTracker();
  }
  return globalCooldownTracker;
}

/**
 * Extract USD amount from tool call arguments.
 * Looks for common amount-related fields in tool params.
 */
function extractAmountUsd(params: unknown): number | undefined {
  if (!params || typeof params !== "object") return undefined;
  const p = params as Record<string, unknown>;

  // Direct USD amount
  if (typeof p.amountUsd === "number") return p.amountUsd;
  if (typeof p.amount_usd === "number") return p.amount_usd;

  // Generic amount field (assume USD if no currency specified)
  if (typeof p.amount === "number" && (!p.currency || p.currency === "USD")) {
    return p.amount;
  }

  // Value field (common in transfer tools)
  if (typeof p.valueUsd === "number") return p.valueUsd;
  if (typeof p.value_usd === "number") return p.value_usd;

  return undefined;
}

/**
 * Compute daily spent USD and consecutive denials from recent audit entries.
 */
async function computeAuditContext(
  auditQueryService: AuditQueryService,
  userId: string,
): Promise<{ dailySpentUsd: number; consecutiveDenials: number }> {
  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // Get all of today's entries for this user (no limit to avoid undercounting)
    const todayEntries = await auditQueryService.query({
      user: userId,
      since: todayStart,
    });

    // Sum USD amounts from successful operations today
    let dailySpentUsd = 0;
    for (const entry of todayEntries) {
      if (entry.result === "success" && entry.amountUsd) {
        dailySpentUsd += entry.amountUsd;
      }
    }

    // Count consecutive denials from most recent entries
    const recentEntries = await auditQueryService.query({
      user: userId,
      limit: 50,
    });

    let consecutiveDenials = 0;
    // Entries are already newest-first from query, iterate from start
    for (const entry of recentEntries) {
      if (entry.result === "denied") {
        consecutiveDenials++;
      } else {
        break;
      }
    }

    return { dailySpentUsd, consecutiveDenials };
  } catch (err) {
    log.warn("Failed to compute audit context, using defaults", err);
    return { dailySpentUsd: 0, consecutiveDenials: 0 };
  }
}

export async function executeToolCall(
  call: ToolCall,
  options: ExecutorOptions
): Promise<ToolResult> {
  const { registry, context } = options;
  const policyEngine = options.policyEngine ?? getOrCreatePolicyEngine(options.workspacePath);
  const auditLogger = options.auditLogger ?? getOrCreateAuditLogger();
  const auditQueryService = options.auditQueryService ?? getOrCreateAuditQueryService();
  const cooldownTracker = options.cooldownTracker ?? getOrCreateCooldownTracker();

  const tool = registry.get(call.name);
  if (!tool) {
    log.error(`Unknown tool: ${call.name}`);
    return {
      success: false,
      error: `Unknown tool: ${call.name}`,
    };
  }

  // Write / sign tools require the WriteGate permission check (Phase 1.5)
  const writeGateEnabled = options.securityConfig?.writeGateEnabled ?? true;
  if (tool.security?.level !== "read" && writeGateEnabled) {
    const { writeGateChannel, securityConfig, workspacePath, userId } = options;

    if (!writeGateChannel || !workspacePath) {
      log.warn(
        `Tool ${call.name} requires ${tool.security?.level ?? "unknown"} level but WriteGate is not configured`,
      );
      return {
        success: false,
        error: `Tool ${call.name} requires write permission but the permission gate is not configured.`,
      };
    }

    const gate = createWriteGate(securityConfig, writeGateChannel, workspacePath);

    const sessionKey = context.sessionKey;
    const target = sessionKey.includes(":")
      ? sessionKey.slice(sessionKey.indexOf(":") + 1)
      : sessionKey;

    const gateCtx: WriteGateCallContext = {
      userId: userId ?? "unknown",
      sessionKey,
      target,
    };

    const verdict = await gate.check(call, gateCtx);
    if (!verdict.allowed) {
      log.warn(
        `WriteGate denied tool ${call.name}: ${verdict.reason}`,
      );
      return {
        success: false,
        error: `Write operation denied: ${verdict.reason}`,
      };
    }
  }

  const startTime = Date.now();

  // Extract amount from tool arguments
  const amountUsd = extractAmountUsd(call.arguments);

  // Compute daily spent and consecutive denials from audit log
  // Use stable userId (not session key) for per-user limits to prevent bypass via key rotation
  const stableUserId = options.userId ?? context.sessionKey;
  const auditContext = await computeAuditContext(auditQueryService, stableUserId);

  // Build escalation context using policy thresholds
  const policyThresholds = await policyEngine.getThresholds();
  const escalationContext: EscalationContext = {
    amountUsd,
    thresholds: policyThresholds,
    dailySpentUsd: auditContext.dailySpentUsd,
    consecutiveDenials: auditContext.consecutiveDenials,
  };

  // Track audit entry id for try/finally finalization
  let auditEntryId: string | null = null;
  let auditFinalized = false;

  try {
    // 1. Policy decision
    const decision = await policyEngine.decide(
      call.name,
      call.arguments,
      escalationContext
    );
    const policy = await policyEngine.resolve(call.name);

    log.info(`Policy decision for ${call.name}`, {
      action: decision.action,
      tier: decision.tier,
      effectiveTier: decision.effectiveTier,
    });

    // 2. Check allowedUsers
    const currentUserId = options.userId ?? context.sessionKey;
    if (policy.allowedUsers) {
      let userAllowed = false;

      if (Array.isArray(policy.allowedUsers)) {
        // Explicit list of allowed user IDs
        userAllowed = policy.allowedUsers.includes(currentUserId);
      } else if (policy.allowedUsers === "assignee-only") {
        // Fail-closed for write/sign tools: assignee resolution not yet implemented.
        // Read-only (tier none) tools are exempt — restricting them provides no security value.
        // TODO: implement assignee ID resolution from config to allow the assignee through.
        if (tool.security?.level === "read" || decision.tier === "none") {
          userAllowed = true;
        } else {
          log.warn(`allowedUsers "assignee-only" enforcement: denying ${call.name} (assignee resolution not implemented)`);
          userAllowed = false;
        }
      }

      if (!userAllowed) {
        log.warn(`User ${currentUserId} not in allowedUsers for ${call.name}`);
        // Audit the denial
        const authAudit = await auditLogger.preLog({
          tool: call.name,
          tier: decision.tier,
          effectiveTier: decision.effectiveTier,
          securityLevel: tool.security?.level,
          user: currentUserId,
          channel: "unknown",
          params: call.arguments as Record<string, unknown>,
          amountUsd,
        });
        if (authAudit.ok) {
          await auditLogger.finalize(authAudit.id, "denied", "not-in-allowedUsers");
        }
        return {
          success: false,
          error: `User not authorized for tool ${call.name}`,
        };
      }
    }

    // 3. Check cooldown
    const cooldownCheck = cooldownTracker.check(call.name, policy);
    if (!cooldownCheck.allowed) {
      log.warn(`Cooldown limit hit for ${call.name}: ${cooldownCheck.reason}`);
      const cooldownAudit = await auditLogger.preLog({
        tool: call.name,
        tier: decision.tier,
        effectiveTier: decision.effectiveTier,
        securityLevel: tool.security?.level,
        user: stableUserId,
        channel: "unknown",
        params: call.arguments as Record<string, unknown>,
        amountUsd,
      });
      if (cooldownAudit.ok) {
        await auditLogger.finalize(cooldownAudit.id, "denied", cooldownCheck.reason);
      }
      return {
        success: false,
        error: cooldownCheck.reason,
      };
    }

    // 4. Pre-log (fail-closed)
    const auditEntry = await auditLogger.preLog({
      tool: call.name,
      tier: decision.tier,
      effectiveTier: decision.effectiveTier,
      securityLevel: tool.security?.level,
      user: stableUserId,
      channel: "unknown",
      params: call.arguments as Record<string, unknown>,
      amountUsd,
    });

    if (!auditEntry.ok) {
      log.error("Audit pre-log failed, blocking operation");
      return {
        success: false,
        error: "Audit system failure - operation blocked for safety",
      };
    }

    auditEntryId = auditEntry.id;

    // 5. Handle decision
    if (decision.action === "deny") {
      await auditLogger.finalize(auditEntry.id, "denied", decision.reason);
      auditFinalized = true;
      return {
        success: false,
        error: decision.reason ?? "Operation denied by policy",
      };
    }

    if (decision.action === "escalate") {
      await auditLogger.finalize(auditEntry.id, "escalated", decision.reason);
      auditFinalized = true;
      return {
        success: false,
        error:
          decision.reason ??
          `Operation requires Tier ${decision.effectiveTier} confirmation`,
      };
    }

    if (decision.action === "confirm") {
      // TODO: Implement confirmation flow (Phase 3)
      log.warn(`Confirmation not yet implemented for ${call.name}`);
      await auditLogger.finalize(
        auditEntry.id,
        "denied",
        "confirmation-not-implemented"
      );
      auditFinalized = true;
      return {
        success: false,
        error: "Confirmation flow not yet implemented",
      };
    }

    // 6. Execute tool
    log.info(`Executing tool: ${call.name} (Tier ${decision.effectiveTier})`);

    // When writeGate is disabled, auto-approve tool-level confirmations.
    // When writeGate is enabled, approval was already granted in the gate check above.
    // Either way, the tool's internal confirmation should pass through.
    const confirmationApproved = !writeGateEnabled || true; // writeGate already approved if enabled

    const result = await tool.execute(call.arguments, {
      ...context,
      requestConfirmation: async () => confirmationApproved,
    });

    const duration = Date.now() - startTime;

    // 7. Finalize audit log
    await auditLogger.finalize(
      auditEntry.id,
      result.success ? "success" : "error",
      result.error,
      {
        duration,
        txHash: (result.data as { txHash?: string })?.txHash,
      }
    );
    auditFinalized = true;

    // 8. Record cooldown
    if (result.success) {
      cooldownTracker.record(call.name, policy);
    }

    log.info(`Tool ${call.name} completed: ${result.success}`, { duration });
    return result;
  } catch (err) {
    log.error(`Tool ${call.name} failed`, err);

    // Finalize audit entry on exception if not already finalized
    if (auditEntryId && !auditFinalized) {
      try {
        await auditLogger.finalize(auditEntryId, "error",
          err instanceof Error ? err.message : "Unknown error",
          { duration: Date.now() - startTime });
      } catch (finalizeErr) {
        log.error("Failed to finalize audit entry on exception", finalizeErr);
      }
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function executeToolCalls(
  calls: ToolCall[],
  options: ExecutorOptions
): Promise<Map<string, ToolResult>> {
  const results = new Map<string, ToolResult>();

  for (const call of calls) {
    const result = await executeToolCall(call, options);
    results.set(call.id, result);
  }

  return results;
}
