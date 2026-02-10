/**
 * Channel setup for onboarding (Discord, Telegram)
 */

import type { SecretsConfig } from "../secrets.js";
import type { AppConfig } from "../types.js";
import { ask, askYN, selectOption, info, success, warn, header } from "../shared.js";
import type { createInterface } from "node:readline";

type RL = ReturnType<typeof createInterface>;
type TelegramGroups = NonNullable<NonNullable<AppConfig["telegram"]>["groups"]>;

export interface DetectedConfig {
  anthropicKey?: string;
  anthropicToken?: string;
  openaiKey?: string;
  openaiCompatKey?: string;
  discordToken?: string;
  telegramToken?: string;
  gatewayToken?: string;
  anthropicOAuth?: boolean;
  openaiOAuth?: boolean;
  telegramAllowList?: string[];
  telegramGroups?: TelegramGroups;
}

export interface ChannelResult {
  discordEnabled: boolean;
  telegramEnabled: boolean;
  discordToken: string;
  telegramToken: string;
  reuseTelegramConfig: boolean;
  telegramAllowList?: string[];
  telegramGroups?: TelegramGroups;
}

/**
 * Interactive prompt for chat channels.
 */
export async function askChannels(
  rl: RL,
  secrets: SecretsConfig,
  existing: DetectedConfig | null,
): Promise<ChannelResult> {
  const chatChoice = await selectOption(rl, "Where should OwliaBot chat with you?", [
    "Discord",
    "Telegram",
    "Both (Discord + Telegram)",
  ]);

  const discordEnabled = chatChoice === 0 || chatChoice === 2;
  const telegramEnabled = chatChoice === 1 || chatChoice === 2;
  let discordToken = "";
  let telegramToken = "";
  let reuseTelegramConfig = false;
  let telegramAllowList: string[] | undefined;
  let telegramGroups: TelegramGroups | undefined;

  // Telegram reuse prompt (only when user selected Telegram and we detected existing settings).
  if (telegramEnabled && existing) {
    const allowCount = existing.telegramAllowList?.length ?? 0;
    const groupCount = existing.telegramGroups ? Object.keys(existing.telegramGroups).length : 0;
    const hasExistingTelegram = Boolean(existing.telegramToken) || allowCount > 0 || groupCount > 0;

    if (hasExistingTelegram) {
      console.log("");
      info(`I found existing Telegram settings (allowed users: ${allowCount}, groups: ${groupCount}).`);
      const reuse = await askYN(
        rl,
        "Reuse your existing Telegram setup?",
        true,
      );
      if (reuse) {
        reuseTelegramConfig = true;
        telegramAllowList = existing.telegramAllowList;
        telegramGroups = existing.telegramGroups;

        if (existing.telegramToken) {
          secrets.telegram = { token: existing.telegramToken };
          telegramToken = existing.telegramToken;
        }
        success("Got it. I'll reuse your existing Telegram configuration.");
      }
    }
  }

  if (discordEnabled) {
    console.log("");
    info("You'll find your bot token in the Discord developer portal: https://discord.com/developers/applications");
    info("Guide: https://github.com/owliabot/owliabot/blob/main/docs/discord-setup.md");
    info("Quick reminder: enable MESSAGE CONTENT INTENT, otherwise I won't receive messages.");
    const token = await ask(
      rl,
      "Paste your Discord bot token (or press Enter to do this later): ",
      true,
    );
    if (token) {
      secrets.discord = { token };
      discordToken = token;
      success("Got it. I'll use that Discord token.");
    }
  }

  if (telegramEnabled) {
    // If we chose to reuse and a token exists, skip the token prompt.
    if (!(reuseTelegramConfig && telegramToken)) {
      console.log("");
      info("Create a bot with BotFather: https://t.me/BotFather");
      const token = await ask(
        rl,
        "Paste your Telegram bot token (or press Enter to do this later): ",
        true,
      );
      if (token) {
        secrets.telegram = { token };
        telegramToken = token;
        success("Got it. I'll use that Telegram token.");
      }
    }
  }

  return {
    discordEnabled,
    telegramEnabled,
    discordToken,
    telegramToken,
    reuseTelegramConfig,
    telegramAllowList,
    telegramGroups,
  };
}

type UserAllowLists = { discord: string[]; telegram: string[] };

/**
 * Configure Discord-specific settings.
 */
export async function configureDiscordConfig(
  rl: RL,
  config: AppConfig,
  userAllowLists: UserAllowLists,
): Promise<void> {
  header("Discord");
  info("Quick checklist: View Channels, Send Messages, Send Messages in Threads, Read Message History");
  info("Guide: https://github.com/owliabot/owliabot/blob/main/docs/discord-setup.md");
  console.log("");

  const channelIds = await ask(rl, "Which channels should I respond in? (comma-separated channel IDs; press Enter for all): ");
  const channelAllowList = channelIds.split(",").map((s) => s.trim()).filter(Boolean);

  const memberIds = await ask(rl, "Who can talk to me? (comma-separated Discord user IDs; press Enter to skip): ");
  const memberAllowList = memberIds.split(",").map((s) => s.trim()).filter(Boolean);
  userAllowLists.discord = memberAllowList;

  config.discord = {
    requireMentionInGuild: true,
    channelAllowList,
    ...(memberAllowList.length > 0 && { memberAllowList }),
  };

  if (memberAllowList.length > 0) {
    success(`I'll only respond to these Discord user IDs: ${memberAllowList.join(", ")}`);
  }
}

/**
 * Configure Telegram-specific settings.
 */
export async function configureTelegramConfig(
  rl: RL,
  config: AppConfig,
  userAllowLists: UserAllowLists,
): Promise<void> {
  header("Telegram");

  const telegramUserIds = await ask(rl, "Who can talk to me? (comma-separated Telegram user IDs; press Enter to skip): ");
  const allowList = telegramUserIds.split(",").map((s) => s.trim()).filter(Boolean);
  userAllowLists.telegram = allowList;

  config.telegram = {
    ...(allowList.length > 0 && { allowList }),
  };

  if (allowList.length > 0) {
    success(`I'll only respond to these Telegram user IDs: ${allowList.join(", ")}`);
  }
}

/**
 * Get channel setup - either reuse existing or prompt for new.
 */
export async function getChannelsSetup(
  rl: RL,
  dockerMode: boolean,
  secrets: SecretsConfig,
  existing: DetectedConfig | null,
  reuseExisting: boolean,
): Promise<ChannelResult> {
  header("Chat");

  if (reuseExisting && (existing?.discordToken || existing?.telegramToken)) {
    let discordEnabled = false;
    let telegramEnabled = false;
    let discordToken = "";
    let telegramToken = "";
    let reuseTelegramConfig = false;
    let telegramAllowList: string[] | undefined;
    let telegramGroups: TelegramGroups | undefined;

    success("Using your existing chat setup:");
    if (existing?.discordToken) {
      discordEnabled = true;
      discordToken = existing.discordToken;
      secrets.discord = { token: discordToken };
      info("  - Discord");
    }
    if (existing?.telegramToken) {
      telegramEnabled = true;
      info("  - Telegram");

      // Ask whether to reuse when there are allowList/groups to carry over.
      // If it's token-only, silently reuse (nothing security-sensitive to confirm).
      const allowCount = existing.telegramAllowList?.length ?? 0;
      const groupCount = existing.telegramGroups ? Object.keys(existing.telegramGroups).length : 0;
      if (allowCount > 0 || groupCount > 0) {
        console.log("");
        info(`I found existing Telegram settings (allowed users: ${allowCount}, groups: ${groupCount}).`);
        const reuse = await askYN(rl, "Reuse your existing Telegram setup?", true);
        if (reuse) {
          reuseTelegramConfig = true;
          telegramAllowList = existing.telegramAllowList;
          telegramGroups = existing.telegramGroups;
        } else {
          reuseTelegramConfig = false;
        }
      } else {
        // Token only — silently reuse.
        reuseTelegramConfig = true;
      }

      if (reuseTelegramConfig) {
        telegramToken = existing.telegramToken;
        secrets.telegram = { token: telegramToken };
      } else {
        console.log("");
        info("Create a bot with BotFather: https://t.me/BotFather");
        const token = await ask(
          rl,
          "Paste your Telegram bot token (or press Enter to do this later): ",
          true,
        );
        if (token) {
          telegramToken = token;
          secrets.telegram = { token };
        }
      }
    }

    if (!discordToken && !telegramToken) {
      warn("No chat token yet. You can add it later.");
    }
    return {
      discordEnabled,
      telegramEnabled,
      discordToken,
      telegramToken,
      reuseTelegramConfig,
      telegramAllowList,
      telegramGroups,
    };
  }

  const ch = await askChannels(rl, secrets, existing);
  if (!ch.discordToken && !ch.telegramToken) {
    warn("No chat token yet. You can add it later.");
  }
  return ch;
}
