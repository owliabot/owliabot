/**
 * Step module: Discord configuration.
 */

import { createInterface } from "node:readline";
import type { AppConfig } from "../types.js";
import { info, success, header, ask } from "../shared.js";
import type { UserAllowLists } from "./types.js";

export async function configureDiscordConfig(
  rl: ReturnType<typeof createInterface>,
  config: AppConfig,
  userAllowLists: UserAllowLists,
): Promise<void> {
  header("Discord configuration");
  info("Ensure your bot has these permissions: View Channels, Send Messages, Send Messages in Threads, Read Message History");
  info("See: https://github.com/owliabot/owliabot/blob/main/docs/discord-setup.md");
  console.log("");

  const channelIds = await ask(rl, "Channel allowlist (comma-separated channel IDs, leave empty for all): ");
  const channelAllowList = channelIds.split(",").map((s) => s.trim()).filter(Boolean);

  const memberIds = await ask(rl, "Member allowlist - user IDs allowed to interact (comma-separated): ");
  const memberAllowList = memberIds.split(",").map((s) => s.trim()).filter(Boolean);
  userAllowLists.discord = memberAllowList;

  config.discord = {
    requireMentionInGuild: true,
    channelAllowList,
    ...(memberAllowList.length > 0 && { memberAllowList }),
  };

  if (memberAllowList.length > 0) {
    success(`Discord member allowlist: ${memberAllowList.join(", ")}`);
  }
}
