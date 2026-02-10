/**
 * Step module: channel setup (Discord, Telegram).
 */

import { createInterface } from "node:readline";
import type { SecretsConfig } from "../secrets.js";
import { info, success, warn, header, ask, selectOption } from "../shared.js";
import type { DetectedConfig, ChannelResult, ChannelsSetup } from "./types.js";

export async function askChannels(
  rl: ReturnType<typeof createInterface>,
  secrets: SecretsConfig,
): Promise<ChannelResult> {
  const chatChoice = await selectOption(rl, "Where would you like to chat with OwliaBot?", [
    "Discord",
    "Telegram",
    "Both",
  ]);

  const discordEnabled = chatChoice === 0 || chatChoice === 2;
  const telegramEnabled = chatChoice === 1 || chatChoice === 2;
  let discordToken = "";
  let telegramToken = "";

  if (discordEnabled) {
    console.log("");
    info("Discord developer portal: https://discord.com/developers/applications");
    info("Setup guide: https://github.com/owliabot/owliabot/blob/main/docs/discord-setup.md");
    info("Remember to enable MESSAGE CONTENT INTENT in the developer portal!");
    const token = await ask(
      rl,
      "If you have it handy, paste your Discord bot token (or press Enter to do this later): ",
    );
    if (token) {
      secrets.discord = { token };
      discordToken = token;
      success("Discord token saved");
    }
  }

  if (telegramEnabled) {
    console.log("");
    info("Telegram BotFather: https://t.me/BotFather");
    const token = await ask(
      rl,
      "If you have it handy, paste your Telegram bot token (or press Enter to do this later): ",
    );
    if (token) {
      secrets.telegram = { token };
      telegramToken = token;
      success("Telegram token saved");
    }
  }

  return { discordEnabled, telegramEnabled, discordToken, telegramToken };
}

export async function getChannelsSetup(
  rl: ReturnType<typeof createInterface>,
  secrets: SecretsConfig,
  existing: DetectedConfig | null,
  reuseExisting: boolean,
): Promise<ChannelsSetup> {
  header("Chat apps");

  if (reuseExisting && (existing?.discordToken || existing?.telegramToken)) {
    let discordEnabled = false;
    let telegramEnabled = false;
    let discordToken = "";
    let telegramToken = "";

    success("Found existing chat settings. We'll reuse them:");
    if (existing?.discordToken) {
      discordEnabled = true;
      discordToken = existing.discordToken;
      secrets.discord = { token: discordToken };
      info("  - Discord");
    }
    if (existing?.telegramToken) {
      telegramEnabled = true;
      telegramToken = existing.telegramToken;
      secrets.telegram = { token: telegramToken };
      info("  - Telegram");
    }

    if (!discordToken && !telegramToken) {
      warn("No chat token yet. That's fine, you can add one later in the config file.");
    }
    return { discordEnabled, telegramEnabled, discordToken, telegramToken };
  }

  const ch = await askChannels(rl, secrets);
  if (!ch.discordToken && !ch.telegramToken) {
    warn("No chat token yet. That's fine, you can add one later in the config file.");
  }
  return ch;
}
