/**
 * Tool executor - runs tools with tier-based policy and audit
 * @see design.md Section 5.2
 * @see docs/design/tier-policy.md
 */

import { createLogger } from "../../utils/logger.js";
import { PolicyEngine } from "../../policy/engine.js";
import { CooldownTracker } from "../../policy/cooldown.js";
import { AuditLogger, type AuditEntry } from "../../audit/logger.js";
import { AuditQueryService } from "../../audit/query.js";
import { SessionKeyLogger } from "../../audit/session-key-logger.js";
import { AutoRevokeService } from "../../audit/auto-revoke.js";
import { EmergencyStop } from "../../policy/emergency.js";
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
    writeToolAllowList?: string[];
    writeToolConfirmation?: boolean;
    writeToolConfirmationTimeoutMs?: number;
  };
  workspacePath?: string;
  userId?: string;
  // Policy engine options (Tier 1/2/3)
  policyEngine?: PolicyEngine;
  auditLogger?: AuditLogger;
  auditQueryService?: AuditQueryService;
  sessionKeyLogger?: SessionKeyLogger;
  autoRevokeService?: AutoRevokeService;
  emergencyStop?: EmergencyStop;
  cooldownTracker?: CooldownTracker;
}

// Global instances (lazy-initialized)
let globalPolicyEngine: PolicyEngine | null = null;
let globalAuditLogger: AuditLogger | null = null;
let globalAuditQueryService: AuditQueryService | null = null;
let globalSessionKeyLogger: SessionKeyLogger | null = null;
let globalCooldownTracker: CooldownTracker | null = null;
let globalAutoRevokeService: AutoRevokeService | null = null;
let globalEmergencyStop: EmergencyStop | null = null;

function getOrCreatePolicyEngine(): PolicyEngine {
  if (!globalPolicyEngine) {
    globalPolicyEngine = new PolicyEngine();
  }
  return globalPolicyEngine;
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

function getOrCreateSessionKeyLogger(): SessionKeyLogger {
  if (!globalSessionKeyLogger) {
    globalSessionKeyLogger = new SessionKeyLogger();
  }
  return globalSessionKeyLogger;
}

function getOrCreateCooldownTracker(): CooldownTracker {
  if (!globalCooldownTracker) {
    globalCooldownTracker = new CooldownTracker();
  }
  return globalCooldownTracker;
}

function getOrCreateAutoRevokeService(): AutoRevokeService {
  if (!globalAutoRevokeService) {
    const sessionKeyLogger = getOrCreateSessionKeyLogger();
    const handlers = {
      revokeSessionKey: async (reason: string) => {
        log.warn(`Auto-revoke triggered: ${reason}`);
      },
      pauseTool: async (tool: string, reason: string) => {
        log.warn(`Pause tool ${tool}: ${reason}`);
      },
      notify: async (message: string) => {
        log.info(`Notification: ${message}`);
      },
      emergencyStop: async (reason: string) => {
        log.error(`Emergency stop: ${reason}`);
      },
    };
    globalAutoRevokeService = new AutoRevokeService(handlers, sessionKeyLogger);
  }
  return globalAutoRevokeService;
}

function getOrCreateEmergencyStop(): EmergencyStop {
  if (!globalEmergencyStop) {
    const sessionKeyLogger = getOrCreateSessionKeyLogger();
    const auditLogger = getOrCreateAuditLogger();
    const handlers = {
      revokeAllSessionKeys: async () => {
        log.warn("Revoking all session keys");
        return [];
      },
      pauseAllToolExecution: async () => {
        log.warn("Pausing all tool execution");
      },
      resumeAllToolExecution: async () => {
        log.info("Resuming all tool execution");
      },
      notify: async (message: string) => {
        log.info(`Emergency notification: ${message}`);
      },
    };
    globalEmergencyStop = new EmergencyStop(handlers, sessionKeyLogger, auditLogger);
  }
  return globalEmergencyStop;
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

    // Get today's entries for this user
    const todayEntries = await auditQueryService.query({
      user: userId,
      since: todayStart,
      limit: 1000,
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
  const policyEngine = options.policyEngine ?? getOrCreatePolicyEngine();
  const auditLogger = options.auditLogger ?? getOrCreateAuditLogger();
  const auditQueryService = options.auditQueryService ?? getOrCreateAuditQueryService();
  const cooldownTracker = options.cooldownTracker ?? getOrCreateCooldownTracker();
  const autoRevokeService = options.autoRevokeService ?? getOrCreateAutoRevokeService();
  const emergencyStop = options.emergencyStop ?? getOrCreateEmergencyStop();

  const tool = registry.get(call.name);
  if (!tool) {
    log.error(`Unknown tool: ${call.name}`);
    return {
      success: false,
      error: `Unknown tool: ${call.name}`,
    };
  }

  // Check emergency stop
  if (emergencyStop.isStopped()) {
    log.error("Tool execution blocked: emergency stop active");
    return {
      success: false,
      error: "Emergency stop active - all operations paused",
    };
  }

  // Write / sign tools require the WriteGate permission check (Phase 1.5)
  if (tool.security.level !== "read") {
    const { writeGateChannel, securityConfig, workspacePath, userId } = options;

    if (!writeGateChannel || !workspacePath) {
      log.warn(
        `Tool ${call.name} requires ${tool.security.level} level but WriteGate is not configured`,
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
    sessionKey: context.signer
      ? {
          id: context.sessionKey,
          expired: false,
          revoked: false,
        }
      : undefined,
    thresholds: policyThresholds,
    dailySpentUsd: auditContext.dailySpentUsd,
    consecutiveDenials: auditContext.consecutiveDenials,
  };

  // Helper: feed entry into anomaly detection for all outcomes
  const feedAnomaly = async (result: AuditEntry["result"]) => {
    try {
      await autoRevokeService.onAuditEntry({
        id: "pending",
        ts: new Date().toISOString(),
        version: 1,
        tool: call.name,
        tier: 0 as any, // Will be set properly below
        effectiveTier: 0 as any,
        securityLevel: tool.security.level,
        user: stableUserId,
        channel: "unknown",
        params: call.arguments as Record<string, unknown>,
        result,
        duration: Date.now() - startTime,
      });
    } catch (err) {
      log.warn("Anomaly detection failed", err);
    }
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
    // "assignee-only" is the default but assignee resolution is not yet implemented;
    // skip enforcement for now to avoid bricking the bot. Only enforce explicit arrays.
    if (policy.allowedUsers && Array.isArray(policy.allowedUsers)) {
      const userId = options.userId ?? context.sessionKey;
      if (!policy.allowedUsers.includes(userId)) {
        log.warn(`User ${userId} not in allowedUsers for ${call.name}`);
        // Audit the denial
        const authAudit = await auditLogger.preLog({
          tool: call.name,
          tier: decision.tier,
          effectiveTier: decision.effectiveTier,
          securityLevel: tool.security.level,
          user: userId,
          channel: "unknown",
          params: call.arguments as Record<string, unknown>,
          amountUsd,
        });
        if (authAudit.ok) {
          await auditLogger.finalize(authAudit.id, "denied", "not-in-allowedUsers");
        }
        await feedAnomaly("denied");
        return {
          success: false,
          error: `User not authorized for tool ${call.name}`,
        };
      }
    }
    // TODO: enforce "assignee-only" once assignee ID resolution from config is implemented

    // 3. Check cooldown
    const cooldownCheck = cooldownTracker.check(call.name, policy);
    if (!cooldownCheck.allowed) {
      log.warn(`Cooldown limit hit for ${call.name}: ${cooldownCheck.reason}`);
      const cooldownAudit = await auditLogger.preLog({
        tool: call.name,
        tier: decision.tier,
        effectiveTier: decision.effectiveTier,
        securityLevel: tool.security.level,
        user: stableUserId,
        channel: "unknown",
        params: call.arguments as Record<string, unknown>,
        amountUsd,
      });
      if (cooldownAudit.ok) {
        await auditLogger.finalize(cooldownAudit.id, "denied", cooldownCheck.reason);
      }
      await feedAnomaly("denied");
      return {
        success: false,
        error: cooldownCheck.reason,
      };
    }

    // 3. Pre-log (fail-closed)
    const auditEntry = await auditLogger.preLog({
      tool: call.name,
      tier: decision.tier,
      effectiveTier: decision.effectiveTier,
      securityLevel: tool.security.level,
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

    // 4. Handle decision
    if (decision.action === "deny") {
      await auditLogger.finalize(auditEntry.id, "denied", decision.reason);
      auditFinalized = true;
      await feedAnomaly("denied");
      return {
        success: false,
        error: decision.reason ?? "Operation denied by policy",
      };
    }

    if (decision.action === "escalate") {
      await auditLogger.finalize(auditEntry.id, "escalated", decision.reason);
      auditFinalized = true;
      await feedAnomaly("escalated");
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
      await feedAnomaly("denied");
      return {
        success: false,
        error: "Confirmation flow not yet implemented",
      };
    }

    // 5. Execute tool
    log.info(`Executing tool: ${call.name} (Tier ${decision.effectiveTier})`);
    const result = await tool.execute(call.arguments, {
      ...context,
      requestConfirmation: async () => false, // TODO: Implement
    });

    const duration = Date.now() - startTime;

    // 6. Finalize audit log
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

    // 7. Record cooldown
    if (result.success) {
      cooldownTracker.record(call.name, policy);
    }

    // 8. Anomaly detection
    await autoRevokeService.onAuditEntry({
      id: auditEntry.id,
      ts: new Date().toISOString(),
      version: 1,
      tool: call.name,
      tier: decision.tier,
      effectiveTier: decision.effectiveTier,
      securityLevel: tool.security.level,
      user: stableUserId,
      channel: "unknown",
      params: call.arguments as Record<string, unknown>,
      result: result.success ? "success" : "error",
      duration,
    });

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

    await feedAnomaly("error");

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
