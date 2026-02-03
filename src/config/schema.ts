/**
 * Configuration schema (Zod)
 * @see design.md Section 7
 */

import { z } from "zod";

export const providerSchema = z.object({
  id: z.string(),
  model: z.string(),
  apiKey: z.string(),
  priority: z.number().int().positive(),
  baseUrl: z.string().url().optional(),
});

export const telegramConfigSchema = z.object({
  // token can be set via onboarding + secrets.yaml (or env) later
  token: z.string().optional(),
  /** Allow list of Telegram user IDs */
  allowList: z.array(z.string()).optional(),
  /** Allow list of Telegram group IDs where the bot will respond even in mention-only mode */
  groupAllowList: z.array(z.string()).optional(),
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
  writeToolAllowList: z.array(z.string()).default([]),
  writeToolConfirmation: z.boolean().default(true),
  writeToolConfirmationTimeoutMs: z.number().int().default(60_000),
});

export const notificationsSchema = z.object({
  channel: z.string(), // e.g., "telegram:883499266"
});

export const skillsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  directory: z.string().optional(), // defaults to workspace/skills
});

const gatewayHttpSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().int().default(8787),
  token: z.string().optional(),
  allowlist: z.array(z.string()).default([]),
  sqlitePath: z.string().default("./workspace/gateway.db"),
  idempotencyTtlMs: z.number().int().default(10 * 60 * 1000),
  eventTtlMs: z.number().int().default(24 * 60 * 60 * 1000),
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
  })
  .default({ scope: "per-agent", mainKey: "main" });

const agentsSchema = z
  .object({
    defaultId: z.string().default("main"),
  })
  .default({ defaultId: "main" });

const groupSchema = z
  .object({
    activation: z.enum(["mention", "always"]).default("mention"),
  })
  .default({ activation: "mention" });

const memorySearchSchema = z
  .object({
    enabled: z.boolean().default(false),
    provider: z.enum(["openai", "gemini", "local"]).default("openai"),
    model: z.string().optional(),
    fallback: z.enum(["openai", "gemini", "local", "none"]).default("none"),
    store: z
      .object({
        path: z.string().default("~/.owliabot/memory/{agentId}.sqlite"),
      })
      .default({ path: "~/.owliabot/memory/{agentId}.sqlite" }),
    extraPaths: z.array(z.string()).default([]),
  })
  .default({
    enabled: false,
    provider: "openai",
    fallback: "none",
    store: { path: "~/.owliabot/memory/{agentId}.sqlite" },
    extraPaths: [],
  });

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
  workspace: z.string().default("./workspace"),

  // Timezone (used in prompts)
  timezone: z.string().default("UTC"),

  // Cron
  heartbeat: z
    .object({
      enabled: z.boolean().default(false),
      cron: z.string().default("0 * * * *"), // hourly
    })
    .optional(),

  // Security
  security: securitySchema.optional(),

  // Skills
  skills: skillsConfigSchema.optional(),

  // Memory search (OpenClaw-style; PR3-1 scaffold)
  memorySearch: memorySearchSchema,

  // Gateway HTTP (optional)
  gateway: z
    .object({
      http: gatewayHttpSchema.optional(),
    })
    .optional(),
});

export type Config = z.infer<typeof configSchema>;
export type ProviderConfig = z.infer<typeof providerSchema>;
