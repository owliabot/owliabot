/**
 * Discord interactive setup - guild detection and channel selection
 */

import { createInterface } from "node:readline";
import { createLogger } from "../utils/logger.js";
import { info, success, warn, header, ask, askYN, multiSelect } from "./shared.js";

const log = createLogger("discord-setup");

type RL = ReturnType<typeof createInterface>;

// Discord REST API types
interface DiscordGuild {
  id: string;
  name: string;
}

interface DiscordChannel {
  id: string;
  name: string;
  type: number; // 0 = GUILD_TEXT
}

export interface DiscordGuildConfig {
  channelAllowList?: string[];
  memberAllowList?: string[];
  requireMentionInGuild?: boolean;
  adminUsers?: string[];
}

export interface DiscordSetupResult {
  // Flat config (backward compatible)
  channelAllowList?: string[];
  memberAllowList?: string[];
  requireMentionInGuild?: boolean;
  adminUsers?: string[];
  // Per-guild config
  guilds?: Record<string, DiscordGuildConfig>;
}

/**
 * Fetch guilds the bot has joined using Discord REST API
 */
async function fetchGuilds(token: string): Promise<DiscordGuild[]> {
  try {
    const response = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: {
        Authorization: `Bot ${token}`,
      },
    });

    if (!response.ok) {
      log.error(`Discord API error: ${response.status} ${response.statusText}`);
      return [];
    }

    return (await response.json()) as DiscordGuild[];
  } catch (err) {
    log.error("Failed to fetch guilds", err);
    return [];
  }
}

/**
 * Fetch channels for a guild using Discord REST API
 */
async function fetchGuildChannels(token: string, guildId: string): Promise<DiscordChannel[]> {
  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: {
        Authorization: `Bot ${token}`,
      },
    });

    if (!response.ok) {
      log.error(`Discord API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const channels = (await response.json()) as DiscordChannel[];
    // Filter text channels (type 0)
    return channels.filter((ch) => ch.type === 0);
  } catch (err) {
    log.error(`Failed to fetch channels for guild ${guildId}`, err);
    return [];
  }
}

/**
 * Generate Discord bot invite URL
 */
function generateInviteUrl(clientId: string): string {
  const permissions = "274877910016"; // Send Messages, Read Messages, Use Slash Commands
  const scopes = "bot%20applications.commands";
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=${scopes}`;
}

/**
 * Extract client ID from bot token (first part before first dot)
 */
function extractClientId(token: string): string | null {
  const parts = token.split(".");
  if (parts.length >= 3) {
    try {
      // Discord bot tokens encode the application/client ID as base64 in the first segment
      const decoded = Buffer.from(parts[0], "base64").toString("utf-8");
      // Validate it looks like a snowflake (numeric string, 17-20 digits)
      if (/^\d{17,20}$/.test(decoded)) {
        return decoded;
      }
    } catch {
      // Fall through
    }
  }
  return null;
}

/**
 * Run interactive Discord guild/channel setup
 */
export async function runDiscordSetup(rl: RL, token: string): Promise<DiscordSetupResult> {
  header("Discord Guild Configuration");

  info("Detecting Discord servers (guilds)...");
  const guilds = await fetchGuilds(token);

  if (guilds.length === 0) {
    warn("Bot has not joined any Discord servers yet.");
    const clientId = extractClientId(token);
    if (clientId) {
      const inviteUrl = generateInviteUrl(clientId);
      console.log("");
      info(`Invite your bot using this URL:`);
      console.log(`  ${inviteUrl}`);
      console.log("");
      info("After inviting the bot, re-run onboarding to configure guild settings.");
    } else {
      warn("Could not generate invite URL from token.");
    }

    // Fallback to manual ID input
    return await manualDiscordSetup(rl);
  }

  success(`Found ${guilds.length} server(s):`);
  guilds.forEach((g, i) => {
    console.log(`  ${i + 1}. ${g.name} (ID: ${g.id})`);
  });
  console.log("");

  const usePerGuildConfig = await askYN(
    rl,
    "Configure per-guild settings? (recommended for multiple servers)",
    guilds.length > 1
  );

  if (!usePerGuildConfig) {
    // Use flat config
    return await configureFlatDiscord(rl, token, guilds);
  } else {
    // Use per-guild config
    return await configurePerGuild(rl, token, guilds);
  }
}

/**
 * Configure flat (backward-compatible) Discord config
 */
async function configureFlatDiscord(
  rl: RL,
  token: string,
  guilds: DiscordGuild[]
): Promise<DiscordSetupResult> {
  // Collect all channels from all guilds
  const allChannels: Array<{ guildName: string; channel: DiscordChannel }> = [];
  for (const guild of guilds) {
    const channels = await fetchGuildChannels(token, guild.id);
    for (const ch of channels) {
      allChannels.push({ guildName: guild.name, channel: ch });
    }
  }

  if (allChannels.length === 0) {
    warn("No text channels found in any guild.");
    return await manualDiscordSetup(rl);
  }

  console.log("");
  info("Text channels across all servers:");
  allChannels.forEach((item, i) => {
    console.log(`  ${i + 1}. #${item.channel.name} (${item.guildName}) - ID: ${item.channel.id}`);
  });
  console.log("");

  const channelIndices = await multiSelect(
    rl,
    "Select channels to allow (leave empty for all channels):",
    allChannels.map((item) => `#${item.channel.name} (${item.guildName})`)
  );

  const channelAllowList =
    channelIndices.length > 0 ? channelIndices.map((i) => allChannels[i].channel.id) : undefined;

  const requireMentionInGuild = await askYN(
    rl,
    "Require @mention to respond in servers? (recommended)",
    true
  );

  const memberListAns = await ask(
    rl,
    "Member allowlist - Discord user IDs allowed to interact (comma-separated, leave empty for all): "
  );
  const memberAllowList = memberListAns
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    channelAllowList,
    memberAllowList: memberAllowList.length > 0 ? memberAllowList : undefined,
    requireMentionInGuild,
    adminUsers: [],
  };
}

/**
 * Configure per-guild Discord config
 */
async function configurePerGuild(
  rl: RL,
  token: string,
  guilds: DiscordGuild[]
): Promise<DiscordSetupResult> {
  const guildConfigs: Record<string, DiscordGuildConfig> = {};

  // Ask which guilds to configure
  const guildIndices = await multiSelect(
    rl,
    "Select servers to configure:",
    guilds.map((g) => g.name)
  );

  if (guildIndices.length === 0) {
    warn("No servers selected. Using default settings.");
    return {};
  }

  for (const idx of guildIndices) {
    const guild = guilds[idx];
    header(`Configuring: ${guild.name}`);

    const channels = await fetchGuildChannels(token, guild.id);
    if (channels.length === 0) {
      warn(`No text channels found in ${guild.name}. Skipping.`);
      continue;
    }

    console.log("");
    info("Text channels:");
    channels.forEach((ch, i) => {
      console.log(`  ${i + 1}. #${ch.name} (ID: ${ch.id})`);
    });
    console.log("");

    const channelIndices = await multiSelect(
      rl,
      "Select channels to allow (leave empty for all channels):",
      channels.map((ch) => `#${ch.name}`)
    );

    const channelAllowList =
      channelIndices.length > 0 ? channelIndices.map((i) => channels[i].id) : undefined;

    const requireMentionInGuild = await askYN(
      rl,
      "Require @mention to respond in this server? (recommended)",
      true
    );

    const memberListAns = await ask(
      rl,
      "Member allowlist for this server (comma-separated user IDs, leave empty for all): "
    );
    const memberAllowList = memberListAns
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    guildConfigs[guild.id] = {
      channelAllowList,
      memberAllowList: memberAllowList.length > 0 ? memberAllowList : undefined,
      requireMentionInGuild,
      adminUsers: [],
    };

    success(`Configured ${guild.name}`);
  }

  return {
    guilds: guildConfigs,
  };
}

/**
 * Fallback to manual ID input if API calls fail
 */
async function manualDiscordSetup(rl: RL): Promise<DiscordSetupResult> {
  warn("Falling back to manual configuration.");
  console.log("");
  info("You can find channel IDs by enabling Developer Mode in Discord settings,");
  info("then right-clicking a channel and selecting 'Copy ID'.");
  console.log("");

  const channelIds = await ask(
    rl,
    "Channel allowlist (comma-separated channel IDs, leave empty for all): "
  );
  const channelAllowList = channelIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const memberIds = await ask(
    rl,
    "Member allowlist - user IDs allowed to interact (comma-separated, leave empty for all): "
  );
  const memberAllowList = memberIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const requireMentionInGuild = await askYN(
    rl,
    "Require @mention to respond in servers? (recommended)",
    true
  );

  return {
    channelAllowList: channelAllowList.length > 0 ? channelAllowList : undefined,
    memberAllowList: memberAllowList.length > 0 ? memberAllowList : undefined,
    requireMentionInGuild,
    adminUsers: [],
  };
}
