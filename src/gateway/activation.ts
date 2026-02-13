import type { Config } from "../config/schema.js";
import type { MsgContext } from "../channels/interface.js";

/**
 * Decide whether a message should be processed by the gateway.
 *
 * Policy:
 * - If allowList is configured for a channel, only allow messages from those users.
 * - For group chats, `group.activation=mention` gates responses unless allowlisted channel/group.
 */
/** Returns true if no allowlist is configured or the sender is on it. */
export function passesUserAllowlist(ctx: MsgContext, config: Config): boolean {
  const allowList =
    ctx.channel === "discord"
      ? config.discord?.memberAllowList
      : ctx.channel === "telegram"
        ? config.telegram?.allowList
        : undefined;
  return !allowList || allowList.length === 0 || allowList.includes(ctx.from);
}

type TelegramGroupPolicy = {
  enabled: boolean;
  requireMention: boolean;
  allowFrom?: string[];
  historyLimit?: number;
};

function resolveTelegramGroupPolicy(
  ctx: MsgContext,
  config: Config,
): TelegramGroupPolicy | null {
  if (ctx.channel !== "telegram") return null;
  if (!ctx.groupId) return null;

  const groups = config.telegram?.groups;
  if (!groups) return null;

  const merged = {
    ...(groups["*"] ?? {}),
    ...(groups[ctx.groupId] ?? {}),
  };

  const enabled = merged.enabled ?? true;

  const globalActivation = config.group?.activation ?? "mention";
  const requireMention =
    typeof merged.requireMention === "boolean"
      ? merged.requireMention
      : globalActivation !== "always";

  return {
    enabled,
    requireMention,
    allowFrom: merged.allowFrom,
    historyLimit: merged.historyLimit,
  };
}

export function passesGroupSenderAllowFrom(
  ctx: MsgContext,
  config: Config,
): boolean {
  const policy = resolveTelegramGroupPolicy(ctx, config);
  const allowFrom = policy?.allowFrom;

  if (!allowFrom || allowFrom.length === 0) return true;

  const senderId = ctx.from;
  const senderUsername = ctx.senderUsername?.trim().toLowerCase();

  for (const raw of allowFrom) {
    const v = raw.trim();
    if (!v) continue;
    if (v === senderId) return true;
    if (v.startsWith("@")) {
      const u = v.slice(1).trim().toLowerCase();
      if (u && senderUsername && u === senderUsername) return true;
    }
  }

  return false;
}

function matchesMentionPatterns(body: string, patterns?: readonly string[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  const text = body ?? "";
  for (const p of patterns) {
    const pat = (p ?? "").trim();
    if (!pat) continue;
    try {
      const re = new RegExp(pat, "i");
      if (re.test(text)) return true;
    } catch {
      // Invalid regex: fall back to case-insensitive substring match.
      if (text.toLowerCase().includes(pat.toLowerCase())) return true;
    }
  }
  return false;
}

export function shouldHandleMessage(ctx: MsgContext, config: Config): boolean {
  // 1) User allowlist gate (applies to DM + group)
  if (!passesUserAllowlist(ctx, config)) return false;

  // 2) Group activation gate
  if (ctx.chatType === "direct") {
    return true;
  }

  // Mention patterns can promote an otherwise-unmentioned message.
  if (!ctx.mentioned && matchesMentionPatterns(ctx.body, config.group?.mentionPatterns)) {
    ctx.mentioned = true;
  }

  // Telegram per-group policy (takes precedence over global group.activation)
  const tgPolicy = resolveTelegramGroupPolicy(ctx, config);
  if (tgPolicy) {
    if (!tgPolicy.enabled) return false;
    if (!passesGroupSenderAllowFrom(ctx, config)) return false;
    if (!tgPolicy.requireMention) return true;
  } else {
    // No per-group config: fall back to global activation behavior
    const activation = config.group?.activation ?? "mention";
    if (activation === "always") return true;
  }

  const allowlistedDiscordChannel =
    !!ctx.groupId &&
    ctx.channel === "discord" &&
    !!config.discord?.channelAllowList?.includes(ctx.groupId);

  return !!ctx.mentioned || allowlistedDiscordChannel;
}
