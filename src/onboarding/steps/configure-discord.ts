/**
 * Step module: Discord configuration.
 */

import { createInterface } from "node:readline";
import type { AppConfig } from "../types.js";
import { info, header } from "../shared.js";
import type { UserAllowLists } from "./types.js";

export async function configureDiscordConfig(
  _rl: ReturnType<typeof createInterface>,
  config: AppConfig,
  userAllowLists: UserAllowLists,
): Promise<void> {
  header("Discord configuration");
  info("Ensure your bot has these permissions: View Channels, Send Messages, Send Messages in Threads, Read Message History");
  info("See: https://github.com/owliabot/owliabot/blob/main/docs/discord-setup.md");
  console.log("");

  // Default: allow all channels and all members
  userAllowLists.discord = [];

  config.discord = {
    requireMentionInGuild: true,
    channelAllowList: [],
  };
}
