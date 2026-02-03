import type { Config } from "../config/schema.js";
import type { MsgContext } from "../channels/interface.js";

/**
 * Decide whether a message should be processed by the gateway.
 *
 * Policy:
 * - If allowList is configured for a channel, only allow messages from those users.
 * - For group chats, `group.activation=mention` gates responses unless allowlisted channel/group.
 */
export function shouldHandleMessage(ctx: MsgContext, config: Config): boolean {
  // 1) User allowlist gate (applies to DM + group)
  const allowList =
    ctx.channel === "discord"
      ? config.discord?.allowList
      : ctx.channel === "telegram"
        ? config.telegram?.allowList
        : undefined;

  if (allowList && allowList.length > 0) {
    if (!allowList.includes(ctx.from)) {
      return false;
    }
  }

  // 2) Group activation gate
  if (ctx.chatType === "direct") {
    return true;
  }

  const activation = config.group?.activation ?? "mention";
  if (activation === "always") {
    return true;
  }

  const allowlistedGroup =
    !!ctx.groupId &&
    ((ctx.channel === "discord" &&
      !!config.discord?.channelAllowList?.includes(ctx.groupId)) ||
      (ctx.channel === "telegram" &&
        !!config.telegram?.groupAllowList?.includes(ctx.groupId)));

  return !!ctx.mentioned || allowlistedGroup;
}
