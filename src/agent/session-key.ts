/**
 * Session key resolver
 *
 * v1: stable, explicit keys that include agentId + channel + conversation bucket.
 */

import type { Config } from "../config/schema.js";
import type { MsgContext } from "../channels/interface.js";

export type AgentId = string;

export function resolveAgentId(options: {
  config: Config;
  agentIdOverride?: string | null;
}): AgentId {
  const { config, agentIdOverride } = options;
  return agentIdOverride?.trim()
    ? agentIdOverride.trim()
    : config.agents?.defaultId ?? "main";
}

export function resolveConversationId(options: {
  ctx: MsgContext;
  config: Config;
}): string {
  const { ctx, config } = options;

  // DM buckets depend on scope
  if (ctx.chatType === "direct") {
    const mainKey = config.session?.mainKey ?? "main";
    const scope = config.session?.scope ?? "per-agent";

    if (scope === "global") return `global:${mainKey}`;
    return `main:${mainKey}`;
  }

  // Group/channel contexts should be isolated.
  // Discord: ctx.groupId == channelId. Telegram: ctx.groupId == groupId.
  return ctx.groupId ?? ctx.from;
}

export function resolveSessionKey(options: {
  ctx: MsgContext;
  config: Config;
  agentIdOverride?: string | null;
}): string {
  const { ctx, config, agentIdOverride } = options;
  const agentId = resolveAgentId({ config, agentIdOverride });
  const conversationId = resolveConversationId({ ctx, config });

  // Format: agent:<agentId>:<channel>:conv:<conversationId>
  return `agent:${agentId}:${ctx.channel}:conv:${conversationId}`;
}
