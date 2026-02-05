/**
 * Tool Router - routes skill tool calls through appropriate security gates
 *
 * Implements the security pipeline for skill tool execution:
 * - Read tools: execute directly
 * - Write tools: go through WriteGate
 * - Sign tools: go through TierPolicy (future)
 *
 * @see docs/design/skill-system.md Section 3.1
 */

import { createLogger } from "../utils/logger.js";
import type { ToolCall, ToolDefinition, ToolResult, ToolSecurity } from "../agent/tools/interface.js";
import type { WriteGate, WriteGateCallContext, WriteGateResult } from "../security/write-gate.js";

const log = createLogger("tool-router");

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Registry of available tools
 */
export interface ToolRegistry {
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
}

/**
 * Audit logger for recording tool calls
 */
export interface AuditLogger {
  log(entry: AuditEntry): Promise<void>;
}

/**
 * Audit log entry for tool calls
 */
export interface AuditEntry {
  ts: string;
  tool: string;
  securityLevel: ToolSecurity["level"];
  userId: string;
  sessionId: string;
  channel: string;
  params: Record<string, unknown>;
  result: "success" | "denied" | "rejected" | "error" | "tool_not_found";
  gate?: "WriteGate" | "TierPolicy";
  gateDecision?: string;
  durationMs: number;
  error?: string;
}

/**
 * Context for routing tool calls
 */
export interface ToolRouterContext {
  userId: string;
  sessionId: string;
  channel: string;
  /** Target for sending messages (e.g., channel ID) */
  target: string;
  /** Request confirmation from user */
  requestConfirmation?: (prompt: string) => Promise<boolean>;
}

/**
 * Options for creating a ToolRouter
 */
export interface ToolRouterOptions {
  writeGate: WriteGate;
  toolRegistry: ToolRegistry;
  auditLogger?: AuditLogger;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract safe-to-log fields from tool params.
 * Strips large text blobs to keep audit logs manageable.
 */
function sanitizeParams(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object") return {};
  const raw = params as Record<string, unknown>;
  const safe: Record<string, unknown> = {};

  // Keep path/file identifiers
  for (const key of ["path", "file", "filename", "directory", "url", "name"]) {
    if (key in raw) safe[key] = raw[key];
  }

  // Truncate text fields
  for (const key of ["old_text", "new_text", "content", "query"]) {
    if (key in raw && typeof raw[key] === "string") {
      const text = raw[key] as string;
      safe[key] = text.length > 100 ? `${text.slice(0, 100)}…` : text;
    }
  }

  return safe;
}

// ── ToolRouter ─────────────────────────────────────────────────────────────

/**
 * Routes tool calls through the appropriate security gates.
 *
 * @example
 * ```ts
 * const router = new ToolRouter({
 *   writeGate,
 *   toolRegistry,
 *   auditLogger,
 * });
 *
 * const result = await router.callTool("edit-file", { path: "test.md", content: "Hello" }, context);
 * ```
 */
export class ToolRouter {
  private readonly writeGate: WriteGate;
  private readonly toolRegistry: ToolRegistry;
  private readonly auditLogger?: AuditLogger;

  constructor(options: ToolRouterOptions) {
    this.writeGate = options.writeGate;
    this.toolRegistry = options.toolRegistry;
    this.auditLogger = options.auditLogger;
  }

  /**
   * Call a tool through the security pipeline.
   *
   * @param name Tool name
   * @param args Tool arguments
   * @param context Routing context with user/session info
   * @returns Tool result
   */
  async callTool(
    name: string,
    args: unknown,
    context: ToolRouterContext,
  ): Promise<ToolResult> {
    const start = Date.now();
    let result: ToolResult;
    let gateDecision: string | undefined;
    let gate: "WriteGate" | "TierPolicy" | undefined;

    try {
      // Resolve the tool
      const tool = this.resolveTool(name);
      if (!tool) {
        result = {
          success: false,
          error: `Tool not found: ${name}`,
        };
        await this.logAudit(name, "read", args, context, "tool_not_found", undefined, undefined, Date.now() - start, result.error);
        return result;
      }

      const securityLevel = tool.security.level;

      // Route based on security level
      if (securityLevel === "write") {
        gate = "WriteGate";
        const gateResult = await this.checkWriteGate(name, args, context);
        gateDecision = gateResult.reason;

        if (!gateResult.allowed) {
          log.info(`Tool ${name} denied by WriteGate: ${gateResult.reason}`);
          result = {
            success: false,
            error: `Access denied: ${gateResult.reason}`,
          };
          await this.logAudit(name, securityLevel, args, context, "denied", gate, gateDecision, Date.now() - start);
          return result;
        }

        log.debug(`Tool ${name} approved by WriteGate`);
      } else if (securityLevel === "sign") {
        // Sign-level tools are executed normally; their code calls callSigner()
        // which routes through SignerRouter/TierPolicy. The security level here
        // is metadata indicating the tool may perform signing operations.
        gate = "TierPolicy";
        gateDecision = "delegated_to_callSigner";
        log.debug(`Sign-level tool ${name} - TierPolicy will be evaluated on callSigner()`);
      }

      // Execute the tool
      log.debug(`Executing tool ${name}`);
      result = await tool.execute(args, {
        sessionKey: context.sessionId,
        agentId: "skill-router",
        signer: null,
        config: {},
        requestConfirmation: context.requestConfirmation
          ? async (req) => context.requestConfirmation!(req.description)
          : undefined,
      });

      await this.logAudit(
        name,
        securityLevel,
        args,
        context,
        result.success ? "success" : "error",
        gate,
        gateDecision,
        Date.now() - start,
        result.error,
      );

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`Tool ${name} execution failed`, err);
      result = {
        success: false,
        error: `Execution failed: ${errorMsg}`,
      };
      await this.logAudit(name, "read", args, context, "error", gate, gateDecision, Date.now() - start, errorMsg);
      return result;
    }
  }

  /**
   * Resolve a tool by name from the registry.
   */
  private resolveTool(name: string): ToolDefinition | undefined {
    return this.toolRegistry.get(name);
  }

  /**
   * Check WriteGate for write-level tools.
   */
  private async checkWriteGate(
    name: string,
    args: unknown,
    context: ToolRouterContext,
  ): Promise<WriteGateResult> {
    const call: ToolCall = {
      id: `${context.sessionId}-${Date.now()}`,
      name,
      arguments: args,
    };

    const gateContext: WriteGateCallContext = {
      userId: context.userId,
      sessionKey: context.sessionId,
      target: context.target,
    };

    return this.writeGate.check(call, gateContext);
  }

  /**
   * Log tool call to audit logger if available.
   */
  private async logAudit(
    tool: string,
    securityLevel: ToolSecurity["level"],
    args: unknown,
    context: ToolRouterContext,
    result: AuditEntry["result"],
    gate?: AuditEntry["gate"],
    gateDecision?: string,
    durationMs: number = 0,
    error?: string,
  ): Promise<void> {
    if (!this.auditLogger) return;

    try {
      await this.auditLogger.log({
        ts: new Date().toISOString(),
        tool,
        securityLevel,
        userId: context.userId,
        sessionId: context.sessionId,
        channel: context.channel,
        params: sanitizeParams(args),
        result,
        gate,
        gateDecision,
        durationMs,
        error,
      });
    } catch (err) {
      // Audit failure should not block tool execution
      log.error("Failed to write audit log", err);
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a ToolRouter with the given options.
 *
 * @example
 * ```ts
 * const router = createToolRouter({
 *   writeGate: createWriteGate(config, channel, workspace),
 *   toolRegistry: registry,
 *   auditLogger: fileAuditLogger,
 * });
 * ```
 */
export function createToolRouter(options: ToolRouterOptions): ToolRouter {
  return new ToolRouter(options);
}
