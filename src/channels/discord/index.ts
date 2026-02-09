import { Client, GatewayIntentBits, Events, Partials } from "discord.js";
import { createLogger } from "../../utils/logger.js";
import type {
  ChannelPlugin,
  MessageHandler,
  MsgContext,
  OutboundMessage,
  ChannelCapabilities,
} from "../interface.js";

const log = createLogger("discord");

export interface DiscordGuildConfig {
  channelAllowList?: string[];
  memberAllowList?: string[];
  requireMentionInGuild?: boolean;
  adminUsers?: string[];
}

export interface DiscordConfig {
  token: string;
  /** Allow list of Discord user IDs (global default) */
  memberAllowList?: string[];
  /** Allow list of guild channel IDs where the bot will respond (global default) */
  channelAllowList?: string[];
  /** If true, only respond in guild when mentioned OR channel is allowlisted (global default) */
  requireMentionInGuild?: boolean;
  /** Global admin users (for slash commands) */
  adminUsers?: string[];
  /** Per-guild configuration overrides */
  guilds?: Record<string, DiscordGuildConfig>;
  /**
   * Optional pre-filter called before guild mention/channel gating.
   * If it returns true the message is forwarded to the handler immediately,
   * bypassing mention and channel-allowlist checks (user allowlist still applies).
   * Used by WriteGate to let confirmation replies ("yes"/"no") through.
   */
  preFilter?: (ctx: MsgContext) => boolean;
}

/**
 * Resolve guild-specific config with fallback to global defaults
 */
export function resolveGuildConfig(
  config: DiscordConfig,
  guildId: string | undefined
): {
  channelAllowList?: string[];
  memberAllowList?: string[];
  requireMentionInGuild: boolean;
  adminUsers: string[];
} {
  if (!guildId || !config.guilds?.[guildId]) {
    // No guild or no per-guild config, use global defaults
    return {
      channelAllowList: config.channelAllowList,
      memberAllowList: config.memberAllowList,
      requireMentionInGuild: config.requireMentionInGuild ?? true,
      adminUsers: config.adminUsers ?? [],
    };
  }

  const guildOverride = config.guilds[guildId];
  return {
    channelAllowList: guildOverride.channelAllowList ?? config.channelAllowList,
    memberAllowList: guildOverride.memberAllowList ?? config.memberAllowList,
    requireMentionInGuild: guildOverride.requireMentionInGuild ?? config.requireMentionInGuild ?? true,
    adminUsers: [
      ...new Set([
        ...(config.adminUsers ?? []),
        ...(guildOverride.adminUsers ?? []),
      ]),
    ],
  };
}

export function createDiscordPlugin(config: DiscordConfig): ChannelPlugin {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [
      Partials.Channel, // Required for DMs
      Partials.Message,
      Partials.ThreadMember, // Required for threads
    ],
  });

  let messageHandler: MessageHandler | null = null;

  const capabilities: ChannelCapabilities = {
    reactions: true,
    threads: true,
    buttons: true,
    markdown: true,
    maxMessageLength: 2000,
  };

  return {
    id: "discord",
    capabilities,

    async start() {
      log.info("Starting Discord bot...");

      client.on(Events.MessageCreate, async (message) => {
        log.debug(`MessageCreate: from=${message.author.tag} content="${message.content.substring(0, 50)}..." guild=${message.guild?.name || 'DM'}`);

        // Ignore bot messages
        if (message.author.bot) return;
        if (!messageHandler) return;

        const isDM = !message.guild;
        const guildId = message.guild?.id;

        // Resolve guild-specific config
        const guildConfig = resolveGuildConfig(config, guildId);

        // Check user allowlist (applies to both DM + guild)
        if (guildConfig.memberAllowList && guildConfig.memberAllowList.length > 0) {
          if (!guildConfig.memberAllowList.includes(message.author.id)) {
            log.warn(`User ${message.author.id} not in memberAllowList for guild ${guildId}`);
            return;
          }
        }

        // Build MsgContext early so preFilter can inspect it
        const body = message.content.replace(/<@!?\d+>\s*/g, "").trim();

        // Calculate mentioned status early (needed for msgCtx)
        const botUser = client.user;
        const mentioned = !isDM && botUser
          ? message.mentions.has(botUser, {
              ignoreEveryone: true,
              ignoreRoles: true,
              ignoreRepliedUser: true,
            })
          : false;

        const msgCtx: MsgContext = {
          from: message.author.id,
          senderName: message.author.displayName ?? message.author.username,
          senderUsername: message.author.username,
          body: body.length > 0 ? body : message.content,
          messageId: message.id,
          replyToId: message.reference?.messageId,
          channel: "discord",
          chatType: isDM ? "direct" : "group",
          groupId: isDM ? undefined : message.channel.id,
          groupName: isDM ? undefined : message.guild?.name,
          timestamp: message.createdTimestamp,
          mentioned,  // Pass mention status to gateway
        };

        // Pre-filter bypass (e.g. WriteGate confirmation replies)
        if (config.preFilter && config.preFilter(msgCtx)) {
          try {
            await messageHandler(msgCtx);
          } catch (err) {
            log.error("Error handling pre-filtered message", err);
          }
          return;
        }

        // Guild filtering rules
        if (!isDM) {
          const inAllowedChannel =
            guildConfig.channelAllowList && guildConfig.channelAllowList.length > 0
              ? guildConfig.channelAllowList.includes(message.channel.id)
              : false;

          const requireMention = guildConfig.requireMentionInGuild;

          log.debug(`Guild message: mentioned=${mentioned}, requireMention=${requireMention}, botUser=${botUser?.id}`);

          // Strict mode: if mention is required, ONLY respond when the bot user is mentioned.
          // (Channel allowlist does not bypass mention requirement.)
          if (requireMention && !mentioned) {
            return;
          }

          // If mention is not required, and a channel allowlist is set, gate by it.
          if (!requireMention && guildConfig.channelAllowList && !inAllowedChannel) {
            return;
          }
        }

        try {
          await messageHandler(msgCtx);
        } catch (err) {
          log.error("Error handling message", err);
        }
      });

      // Log when client is ready
      client.once(Events.ClientReady, (c) => {
        log.info(`Logged in as ${c.user.tag}, guilds: ${c.guilds.cache.size}`);
      });
      
      await client.login(config.token);
      log.info("Discord bot started");
    },

    async stop() {
      log.info("Stopping Discord bot...");
      client.destroy();
      log.info("Discord bot stopped");
    },

    onMessage(handler: MessageHandler) {
      messageHandler = handler;
    },

    async send(target: string, message: OutboundMessage) {
      try {
        // target can be a user id (DM) or a channel id (guild)
        const channel = await client.channels.fetch(target).catch(() => null);
        if (channel && channel.isTextBased() && "send" in channel) {
          await (channel as any).send({
            content: message.text,
            reply: message.replyToId
              ? { messageReference: message.replyToId }
              : undefined,
          });
          return;
        }

        const user = await client.users.fetch(target);
        const dmChannel = await user.createDM();
        await dmChannel.send({
          content: message.text,
          reply: message.replyToId
            ? { messageReference: message.replyToId }
            : undefined,
        });
      } catch (err) {
        log.error(`Failed to send message to ${target}`, err);
        throw err;
      }
    },
  };
}
