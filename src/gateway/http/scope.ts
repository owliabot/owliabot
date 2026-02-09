/**
 * Device Scope Model for HTTP Channel Authorization
 *
 * Scope controls what operations a paired device can perform:
 * - tools: "read" | "write" | "sign" - tool permission levels
 * - system: boolean - system capabilities (exec, web.fetch, web.search)
 * - mcp: boolean - MCP service access
 *
 * Scope is checked BEFORE tier policy (hard reject = 403).
 *
 * @see docs/plans/gateway-unification.md Section 2.3
 */

import { z } from "zod";

/**
 * Tool permission levels for scope authorization.
 *
 * - "read": Only tier-none read-only tools (e.g., read_file, list_files)
 * - "write": Tier-none + tier-3 tools that auto-execute (e.g., edit_file)
 * - "sign": All tiers including tier-1/2 that require confirmation (e.g., wallet operations)
 */
export const ToolScopeLevel = z.enum(["read", "write", "sign"]);
export type ToolScopeLevel = z.infer<typeof ToolScopeLevel>;

/**
 * Device scope schema for validation
 */
export const DeviceScopeSchema = z.object({
  /** Tool permission level */
  tools: ToolScopeLevel.default("read"),
  /** System capabilities access (exec, web.fetch, web.search) */
  system: z.boolean().default(false),
  /** MCP service access */
  mcp: z.boolean().default(false),
});

export type DeviceScope = z.infer<typeof DeviceScopeSchema>;

/**
 * Default scope with minimal permissions (principle of least privilege)
 */
export const DEFAULT_SCOPE: DeviceScope = {
  tools: "read",
  system: false,
  mcp: false,
};

/**
 * Parse scope from JSON string, falling back to default on error
 */
export function parseScope(json: string | null): DeviceScope {
  if (!json) return { ...DEFAULT_SCOPE };
  try {
    const parsed = JSON.parse(json);
    return DeviceScopeSchema.parse(parsed);
  } catch {
    return { ...DEFAULT_SCOPE };
  }
}

/**
 * Serialize scope to JSON string for storage
 */
export function serializeScope(scope: DeviceScope): string {
  return JSON.stringify(scope);
}

/**
 * Tool tier mapping for scope authorization.
 * Maps tool names to their tier levels.
 */
export type ToolTier = "none" | "tier3" | "tier2" | "tier1";

/**
 * Check if a tool scope level allows the given tool tier.
 *
 * Scope hierarchy:
 * - "read" → only tier-none read-only tools
 * - "write" → tier-none + tier3 (auto-execute)
 * - "sign" → all tiers (tier-none + tier3 + tier2 + tier1)
 */
export function scopeAllowsTier(scopeLevel: ToolScopeLevel, tier: ToolTier): boolean {
  switch (scopeLevel) {
    case "read":
      return tier === "none";
    case "write":
      return tier === "none" || tier === "tier3";
    case "sign":
      return true; // All tiers allowed (tier flow still applies)
  }
}

/**
 * Error codes for scope authorization failures
 */
export const ScopeErrorCode = {
  INSUFFICIENT_TOOLS: "ERR_SCOPE_INSUFFICIENT_TOOLS",
  INSUFFICIENT_SYSTEM: "ERR_SCOPE_INSUFFICIENT_SYSTEM",
  INSUFFICIENT_MCP: "ERR_SCOPE_INSUFFICIENT_MCP",
} as const;

/**
 * Check scope for tool execution.
 * Returns null if allowed, or error info if denied.
 */
export function checkToolScope(
  scope: DeviceScope,
  toolName: string,
  tier: ToolTier = "none"
): { code: string; message: string } | null {
  if (!scopeAllowsTier(scope.tools, tier)) {
    return {
      code: ScopeErrorCode.INSUFFICIENT_TOOLS,
      message: `Scope 'tools:${scope.tools}' does not allow ${tier} tools. Required: ${tier === "tier1" || tier === "tier2" ? "sign" : tier === "tier3" ? "write" : "read"}`,
    };
  }
  return null;
}

/**
 * Check scope for system capability access
 */
export function checkSystemScope(
  scope: DeviceScope
): { code: string; message: string } | null {
  if (!scope.system) {
    return {
      code: ScopeErrorCode.INSUFFICIENT_SYSTEM,
      message: "Scope does not allow system capabilities. Set 'system: true' on device scope.",
    };
  }
  return null;
}

/**
 * Check scope for MCP access
 */
export function checkMcpScope(
  scope: DeviceScope
): { code: string; message: string } | null {
  if (!scope.mcp) {
    return {
      code: ScopeErrorCode.INSUFFICIENT_MCP,
      message: "Scope does not allow MCP access. Set 'mcp: true' on device scope.",
    };
  }
  return null;
}
