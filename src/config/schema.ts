/**
 * Configuration schema (Zod)
 * @see design.md Section 7
 */

import { z } from "zod";
import { CliBackendsSchema } from "../agent/cli/cli-schema.js";
import { mcpServerConfigSchema } from "../mcp/types.js";

export const providerSchema = z
  .object({
    id: z.string(),
    model: z.string(),
    apiKey: z.string().optional(),
    priority: z.number().int().positive(),
    baseUrl: z.string().url().optional(),
    authType: z
      .enum(["bearer", "api-key", "header", "none"])
      .default("bearer")
      .optional(),
    authHeader: z.string().optional(),
  })
  .refine(
    (data) => {
      // If provider is openai-compatible, baseUrl is required
      if (data.id === "openai-compatible" && !data.baseUrl) {
        return false;
      }
      return true;
    },
    {
      message:
        "baseUrl is required when provider id is 'openai-compatible'. " +
        "Example: http://localhost:11434/v1 for Ollama",
      path: ["baseUrl"],
    },
  )
  .refine(
    (data) => {
      if (data.authType === "header" && !data.authHeader) {
        return false;
      }
      return true;
    },
    {
      message:
        "authHeader is required when authType is 'header'. " +
        "Example: authHeader: 'X-API-Key'",
      path: ["authHeader"],
    },
  );

export const telegramConfigSchema = z.object({
  // token can be set via onboarding + secrets.yaml (or env) later
  token: z.string().optional(),
  /** Allow list of Telegram user IDs (direct messages only) */
  allowList: z.array(z.string()).optional(),
  /**
   * Per-group overrides (by Telegram chat id), plus optional "*" default.
   * Example:
   * telegram.groups["-100123"].requireMention = false
   */
  groups: z
    .record(
      z.string(),
      z.object({
        enabled: z.boolean().optional(),
        requireMention: z.boolean().optional(),
        allowFrom: z.array(z.string()).optional(),
        historyLimit: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),
});

export const discordConfigSchema = z.object({
  // token can be set via onboarding + secrets.yaml (or env) later
  token: z.string().optional(),
  /** Allow list of Discord user IDs (DMs or guild messages) */
  memberAllowList: z.array(z.string()).optional(),
  /** Allow list of guild channel IDs where the bot will respond */
  channelAllowList: z.array(z.string()).optional(),
  /** If true (default), only respond in guild when mentioned OR channel is allowlisted */
  requireMentionInGuild: z.boolean().default(true),
});

export const securitySchema = z.object({
  writeGateEnabled: z.boolean().default(true),
  writeToolAllowList: z.array(z.string()).default([]),
  writeToolConfirmation: z.boolean().default(true),
  writeToolConfirmationTimeoutMs: z.number().int().default(60_000),
});

// System Capability (exec / web.fetch / web.search)
export const systemCapabilitySchema = z
  .object({
    exec: z
      .object({
        commandAllowList: z.array(z.string()).default([]),
        envAllowList: z.array(z.string()).default(["PATH", "LANG"]),
        timeoutMs: z.number().int().default(60_000),
        maxOutputBytes: z
          .number()
          .int()
          .default(256 * 1024),
      })
      .default({
        commandAllowList: [],
        envAllowList: ["PATH", "LANG"],
        timeoutMs: 60_000,
        maxOutputBytes: 256 * 1024,
      }),
    web: z
      .object({
        domainAllowList: z.array(z.string()).default([]),
        domainDenyList: z.array(z.string()).default([]),
        allowPrivateNetworks: z.boolean().default(false),
        timeoutMs: z.number().int().default(15_000),
        maxResponseBytes: z
          .number()
          .int()
          .default(512 * 1024),
        userAgent: z.string().optional(),
        blockOnSecret: z.boolean().default(true),
      })
      .default({
        domainAllowList: [],
        domainDenyList: [],
        allowPrivateNetworks: false,
        timeoutMs: 15_000,
        maxResponseBytes: 512 * 1024,
        blockOnSecret: true,
      }),
    webSearch: z
      .object({
        defaultProvider: z.enum(["brave", "duckduckgo"]).default("duckduckgo"),
        brave: z
          .object({
            apiKey: z.string(),
            endpoint: z.string().url().optional(),
          })
          .optional(),
        duckduckgo: z
          .object({
            endpoint: z.string().url().optional(),
          })
          .optional(),
        timeoutMs: z.number().int().default(15_000),
        maxResults: z.number().int().default(10),
      })
      .default({
        defaultProvider: "duckduckgo",
        timeoutMs: 15_000,
        maxResults: 10,
      }),
  })
  .default({
    exec: {
      commandAllowList: [],
      envAllowList: ["PATH", "LANG"],
      timeoutMs: 60_000,
      maxOutputBytes: 256 * 1024,
    },
    web: {
      domainAllowList: [],
      domainDenyList: [],
      allowPrivateNetworks: false,
      timeoutMs: 15_000,
      maxResponseBytes: 512 * 1024,
      blockOnSecret: true,
    },
    webSearch: {
      defaultProvider: "duckduckgo",
      timeoutMs: 15_000,
      maxResults: 10,
    },
  });

export const notificationsSchema = z.object({
  channel: z.string(), // e.g., "telegram:883499266"
});

export const skillsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  directory: z.string().optional(), // defaults to workspace/skills
});

export const toolPolicySchema = z
  .object({
    /** Only allow these tools (takes precedence over denyList) */
    allowList: z.array(z.string()).optional(),
    /** Deny these tools (ignored if allowList is set) */
    denyList: z.array(z.string()).optional(),
  })
  .optional();

export const toolsConfigSchema = z
  .object({
    /** Enable write tools (edit_file). Default: false */
    allowWrite: z.boolean().default(false),
    /** Tool policy for filtering available tools */
    policy: toolPolicySchema,
  })
  .default({ allowWrite: false });

const gatewayHttpSchema = z.object({
  enabled: z.boolean().default(true),
  host: z.string().default("127.0.0.1"),
  port: z.number().int().default(8787),
  token: z.string().optional(),
  allowlist: z.array(z.string()).default([]),
  // NOTE: Defaults to OWLIABOT_HOME so it is stable across CWD changes.
  sqlitePath: z.string().default("${OWLIABOT_HOME}/gateway/http.db"),
  idempotencyTtlMs: z
    .number()
    .int()
    .default(10 * 60 * 1000),
  eventTtlMs: z
    .number()
    .int()
    .default(24 * 60 * 60 * 1000),
  rateLimit: z
    .object({
      windowMs: z.number().int().default(60_000),
      max: z.number().int().default(60),
    })
    .default({ windowMs: 60_000, max: 60 }),
});

const sessionSchema = z
  .object({
    scope: z.enum(["global", "per-agent"]).default("per-agent"),
    mainKey: z.string().default("main"),
    storePath: z.string().optional(),
    resetTriggers: z.array(z.string()).optional(),
    summaryModel: z.string().optional(),
    summarizeOnReset: z.boolean().default(true),
  })
  .default({ scope: "per-agent", mainKey: "main" });

// Infrastructure config for rate limiting, idempotency, event logging
const infraSchema = z
  .object({
    enabled: z.boolean().default(true),
    // Stored under OWLIABOT_HOME/gateway by default.
    sqlitePath: z.string().default("${OWLIABOT_HOME}/gateway/infra.db"),
    rateLimit: z
      .object({
        enabled: z.boolean().default(true),
        windowMs: z.number().int().default(60_000), // 1 minute
        maxMessages: z.number().int().default(30), // 30 messages per minute per user
      })
      .default({ enabled: true, windowMs: 60_000, maxMessages: 30 }),
    idempotency: z
      .object({
        enabled: z.boolean().default(true),
        ttlMs: z
          .number()
          .int()
          .default(5 * 60 * 1000), // 5 minutes
      })
      .default({ enabled: true, ttlMs: 5 * 60 * 1000 }),
    eventStore: z
      .object({
        enabled: z.boolean().default(true),
        ttlMs: z
          .number()
          .int()
          .default(24 * 60 * 60 * 1000), // 24 hours
      })
      .default({ enabled: true, ttlMs: 24 * 60 * 60 * 1000 }),
  })
  .default({
    enabled: true,
    sqlitePath: "${OWLIABOT_HOME}/gateway/infra.db",
    rateLimit: { enabled: true, windowMs: 60_000, maxMessages: 30 },
    idempotency: { enabled: true, ttlMs: 5 * 60 * 1000 },
    eventStore: { enabled: true, ttlMs: 24 * 60 * 60 * 1000 },
  });

const agentsSchema = z
  .object({
    defaultId: z.string().default("main"),
    defaults: z
      .object({
        /** CLI backends configuration */
        cliBackends: CliBackendsSchema,
      })
      .optional(),
    /** Agentic loop configuration */
    loop: z
      .object({
        /** Maximum iterations (hard safety ceiling, default: 50) */
        maxIterations: z.number().int().positive().default(50),
        /** Timeout in seconds (default: 600 = 10 minutes) */
        timeoutSeconds: z.number().int().positive().default(600),
      })
      .default({ maxIterations: 50, timeoutSeconds: 600 }),
  })
  .default({ defaultId: "main", loop: { maxIterations: 50, timeoutSeconds: 600 } });

const groupSchema = z
  .object({
    activation: z.enum(["mention", "always"]).default("mention"),
    /** In group chats, keep a rolling buffer of recent messages as mention-time context. */
    historyLimit: z.number().int().nonnegative().default(50),
    /** Custom mention trigger patterns (regex strings, case-insensitive). */
    mentionPatterns: z.array(z.string()).optional(),
    /** Max concurrent group mention requests per session key (default 3). */
    maxConcurrent: z.number().int().positive().default(3),
  })
  .default({ activation: "mention", historyLimit: 50, maxConcurrent: 3 });

// Clawlet-specific configuration (nested under wallet.clawlet)
const clawletConfigSchema = z
  .object({
    /** Enable Clawlet wallet integration */
    enabled: z.boolean().default(false),
    /** HTTP base URL for Clawlet daemon (auto-resolved at runtime if omitted) */
    baseUrl: z.string().url().optional(),
    /** Auth token - supports env var expansion like ${CLAWLET_TOKEN} */
    token: z.string().optional(),
    /** Request timeout in ms */
    requestTimeout: z.number().int().default(30_000),
    /** Default chain ID for wallet operations (8453 = Base) */
    defaultChainId: z.number().int().default(8453),
  })
  .default({
    enabled: false,
    requestTimeout: 30_000,
    defaultChainId: 8453,
  });

// Wallet configuration wrapper
const walletSchema = z
  .object({
    clawlet: clawletConfigSchema,
  })
  .default({
    clawlet: {
      enabled: false,
      requestTimeout: 30_000,
      defaultChainId: 8453,
    },
  })
  // Validation: if enabled=true, token must be non-empty
  .refine(
    (data) => {
      if (data.clawlet.enabled && !data.clawlet.token?.trim()) {
        return false;
      }
      return true;
    },
    {
      message:
        "wallet.clawlet.token is required when wallet.clawlet.enabled is true. " +
        "Set it directly or use ${CLAWLET_TOKEN} for env var expansion.",
      path: ["clawlet", "token"],
    }
  );

export type ClawletConfig = z.infer<typeof clawletConfigSchema>;

const memorySearchSchema = z
  .object({
    enabled: z.boolean().default(true),

    // Memory-search backend (not embedding provider).
    provider: z.enum(["sqlite", "naive"]).default("sqlite"),
    fallback: z.enum(["sqlite", "naive", "none"]).default("none"),

    store: z
      .object({
        path: z.string().min(1).default("{workspace}/memory/{agentId}.sqlite"),
      })
      .default({ path: "{workspace}/memory/{agentId}.sqlite" }),

    extraPaths: z.array(z.string()).default([]),

    // Which sources should be searched/indexed.
    // Default: only workspace memory files.
    sources: z
      .array(z.enum(["files", "transcripts"]).catch("files"))
      .default(["files"]),

    indexing: z
      .object({
        /**
         * When true, attempt to build/refresh the sqlite index on-demand before a
         * sqlite search (fail-closed; will never read outside allowlists).
         */
        autoIndex: z.boolean().default(true),

        /** Minimum time between indexing attempts for the same DB path. */
        minIntervalMs: z
          .number()
          .int()
          .nonnegative()
          .default(5 * 60 * 1000),

        /** Optional override for which sources to index (defaults to memorySearch.sources). */
        sources: z
          .array(z.enum(["files", "transcripts"]).catch("files"))
          .optional(),
      })
      .default({ autoIndex: true, minIntervalMs: 5 * 60 * 1000 }),
  })
  .default({
    enabled: true,
    provider: "sqlite",
    fallback: "none",
    store: { path: "{workspace}/memory/{agentId}.sqlite" },
    extraPaths: [],
    sources: ["files"],
    indexing: { autoIndex: true, minIntervalMs: 5 * 60 * 1000 },
  });

// MCP (Model Context Protocol) configuration
export const mcpGatewayConfigSchema = z
  .object({
    /** Named presets to auto-expand (e.g. ["playwright"]) */
    presets: z.array(z.string()).default([]),
    /** Explicit server definitions (reuses mcpServerConfigSchema with transport validation) */
    servers: z
      .array(mcpServerConfigSchema)
      .default([]),
    /** Start MCP servers automatically on gateway boot (default: true) */
    autoStart: z.boolean().default(true),
    /** Default settings for all MCP servers */
    defaults: z
      .object({
        timeout: z.number().int().default(30000),
        connectTimeout: z.number().int().default(10000),
        restartOnCrash: z.boolean().default(true),
        maxRestarts: z.number().int().default(3),
        restartDelay: z.number().int().default(1000),
      })
      .optional(),
    /** Security overrides for specific MCP tools (keyed by serverName__toolName) */
    securityOverrides: z.record(
      z.object({
        level: z.enum(["read", "write", "sign"]),
        confirmRequired: z.boolean().optional(),
      }),
    ).optional(),
  })
  .optional();

export type MCPGatewayConfig = z.infer<typeof mcpGatewayConfigSchema>;

export const configSchema = z.object({
  // AI providers
  providers: z.array(providerSchema).min(1),

  // Channels
  telegram: telegramConfigSchema.optional(),
  discord: discordConfigSchema.optional(),

  // Session
  session: sessionSchema,
  agents: agentsSchema,
  group: groupSchema,

  // Notifications
  notifications: notificationsSchema.optional(),

  // Workspace path
  workspace: z.string().default("${OWLIABOT_HOME}/workspace"),

  // Timezone (used in prompts)
  timezone: z.string().default("UTC"),

  // Heartbeat (legacy cron scheduling)
  heartbeat: z
    .object({
      enabled: z.boolean().default(false),
      cron: z.string().default("0 * * * *"), // hourly
    })
    .optional(),

  // Cron scheduler (OpenClaw-compatible)
  cron: z
    .object({
      enabled: z.boolean().default(true),
      store: z.string().optional(), // defaults to ~/.owliabot/cron/jobs.json
    })
    .optional(),

  // Security
  security: securitySchema.optional(),

  // System capabilities (exec/web.fetch/web.search)
  system: systemCapabilitySchema.optional(),

  // Skills
  skills: skillsConfigSchema.optional(),

  // Tools configuration
  tools: toolsConfigSchema,

  // Memory search (OpenClaw-style; PR3-1 scaffold)
  memorySearch: memorySearchSchema,

  // Gateway HTTP (optional)
  gateway: z
    .object({
      http: gatewayHttpSchema.optional(),
    })
    .optional(),

  // Infrastructure (rate limiting, idempotency, event store)
  infra: infraSchema,

  // Wallet integration (Clawlet)
  wallet: walletSchema,

  // MCP (Model Context Protocol) servers
  mcp: mcpGatewayConfigSchema,
});

export type Config = z.infer<typeof configSchema>;
export type WalletConfig = z.infer<typeof walletSchema>;
export type ProviderConfig = z.infer<typeof providerSchema>;
export type ToolPolicy = z.infer<typeof toolPolicySchema>;
export type ToolsConfig = z.infer<typeof toolsConfigSchema>;
