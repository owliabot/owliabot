/**
 * Zod schema for policy.yml validation
 * @see docs/design/tier-policy.md Section 3.2
 */

import { z } from "zod";

const amountLimitSchema = z.object({
  usd: z.number().positive().optional(),
  eth: z.string().optional(),
  token: z.string().optional(),
});

const cooldownSchema = z.object({
  maxPerHour: z.number().int().positive().optional(),
  maxPerDay: z.number().int().positive().optional(),
  minIntervalMs: z.number().int().positive().optional(),
});

const tierSchema = z.union([
  z.literal("none"),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

const confirmationChannelSchema = z.enum([
  "companion-app",
  "inline",
  "notification",
]);

const toolPolicySchema = z.object({
  tier: tierSchema,
  requireConfirmation: z.boolean().optional(),
  confirmationChannel: confirmationChannelSchema.optional(),
  maxAmount: amountLimitSchema.optional(),
  cooldown: cooldownSchema.optional(),
  allowedUsers: z
    .union([z.literal("assignee-only"), z.array(z.string())])
    .optional(),
  escalateAbove: amountLimitSchema.optional(),
  timeout: z.number().optional(),
});

export const policySchema = z.object({
  version: z.literal("1"),
  defaults: toolPolicySchema.partial(),
  thresholds: z.object({
    tier2MaxUsd: z.number(),
    tier2DailyUsd: z.number(),
    tier3MaxUsd: z.number(),
    sessionKeyTtlHours: z.number(),
    sessionKeyMaxBalance: z.string(),
  }),
  emergencyStop: z.object({
    enabled: z.boolean(),
    commands: z.array(z.string()),
    channels: z.array(z.string()),
    action: z.enum(["revoke-all-session-keys", "pause-all", "shutdown"]),
  }),
  tools: z.record(z.string(), toolPolicySchema),
  wildcards: z
    .array(toolPolicySchema.extend({ pattern: z.string() }))
    .optional(),
  fallback: toolPolicySchema,
});

export type PolicyConfig = z.infer<typeof policySchema>;
export type ToolPolicyConfig = z.infer<typeof toolPolicySchema>;
export type WildcardPolicyConfig = z.infer<
  typeof toolPolicySchema
> & { pattern: string };
