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
  token: z.string(),
  allowList: z.array(z.string()).optional(),
});

export const discordConfigSchema = z.object({
  token: z.string(),
  allowList: z.array(z.string()).optional(),
});

export const notificationsSchema = z.object({
  channel: z.string(), // e.g., "telegram:883499266"
});

export const configSchema = z.object({
  // AI providers
  providers: z.array(providerSchema).min(1),

  // Channels
  telegram: telegramConfigSchema.optional(),
  discord: discordConfigSchema.optional(),

  // Notifications
  notifications: notificationsSchema.optional(),

  // Workspace path
  workspace: z.string().default("./workspace"),

  // Cron
  heartbeat: z
    .object({
      enabled: z.boolean().default(false),
      cron: z.string().default("0 * * * *"), // hourly
    })
    .optional(),
});

export type Config = z.infer<typeof configSchema>;
export type ProviderConfig = z.infer<typeof providerSchema>;
