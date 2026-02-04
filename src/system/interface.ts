import { z } from "zod";

/**
 * System Capability interface (HTTP v1)
 * @see docs/architecture/system-capability.md
 */

export type SecurityLevel = "read" | "write" | "sign";

export type SystemAction = "exec" | "web.fetch" | "web.search";

export interface SystemRequest {
  requestId?: string;
  idempotencyKey?: string;
  payload: {
    action: SystemAction;
    args: unknown;
    sessionId?: string;
    cwd?: string;
    env?: Record<string, string>;
  };
  security?: { level: SecurityLevel };
}

export type SystemResult =
  | { success: true; data: unknown }
  | { success: false; error: { code: string; message: string; details?: unknown } };

export interface SystemExecutorContext {
  workspacePath: string;
  /** If provided, used for outbound HTTP requests (test injection) */
  fetchImpl?: typeof fetch;
}

export interface ExecArgs {
  command: string;
  params?: string[];
  timeoutMs?: number;
}

export interface WebFetchArgs {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface WebSearchArgs {
  query: string;
  count?: number;
  provider?: "brave" | "duckduckgo";
  timeoutMs?: number;
}

export interface SystemCapabilityConfig {
  exec?: {
    /** Only these commands may be executed */
    commandAllowList: string[];
    /** Only these env var names may be passed through */
    envAllowList: string[];
    timeoutMs: number;
    maxOutputBytes: number;
  };
  web?: {
    /** If non-empty, only these domains are allowed (supports "*.example.com"). */
    domainAllowList: string[];
    /** Always denied domains (supports "*.example.com"). */
    domainDenyList: string[];
    /** Allow requests to private/loopback IP hosts if explicitly allowlisted */
    allowPrivateNetworks: boolean;
    timeoutMs: number;
    maxResponseBytes: number;
    userAgent?: string;
    /** If true, block POST/PUT/PATCH bodies when secret scanner hits high confidence */
    blockOnSecret: boolean;
  };
  webSearch?: {
    defaultProvider: "brave" | "duckduckgo";
    brave?: { apiKey: string; endpoint?: string };
    duckduckgo?: { endpoint?: string };
    timeoutMs: number;
    maxResults: number;
  };
}

// ── Zod schemas for request validation ───────────────────────────────────

export const securityLevelSchema = z.enum(["read", "write", "sign"]);
export const systemActionSchema = z.enum(["exec", "web.fetch", "web.search"]);

export const execArgsSchema = z.object({
  command: z.string().min(1),
  params: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive().optional(),
});

export const webFetchArgsSchema = z.object({
  url: z.string().min(1),
  method: z.string().optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxResponseBytes: z.number().int().positive().optional(),
});

export const webSearchArgsSchema = z.object({
  query: z.string().min(1),
  count: z.number().int().positive().max(50).optional(),
  provider: z.enum(["brave", "duckduckgo"]).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const systemRequestSchema = z.object({
  requestId: z.string().optional(),
  idempotencyKey: z.string().optional(),
  payload: z.object({
    action: systemActionSchema,
    args: z.unknown(),
    sessionId: z.string().optional(),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
  }),
  security: z
    .object({
      level: securityLevelSchema,
    })
    .optional(),
});
