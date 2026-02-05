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

export interface DiscordConfig {
  token: string;
  /** Allow list of Discord user IDs */
  memberAllowList?: string[];
  /** Allow list of guild channel IDs where the bot will respond */
  channelAllowList?: string[];
  /** If true, only respond in guild when mentioned OR channel is allowlisted */
  requireMentionInGuild?: boolean;
  /**
   * Optional pre-filter called before guild mention/channel gating.
   * If it returns true the message is forwarded to the handler immediately,
   * bypassing mention and channel-allowlist checks (user allowlist still applies).
   * Used by WriteGate to let confirmation replies ("yes"/"no") through.
   */
  preFilter?: (ctx: MsgContext) => boolean;
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
        // Ignore bot messages
        if (message.author.bot) return;
        if (!messageHandler) return;

        const isDM = !message.guild;

        // Check user allowlist (applies to both DM + guild)
        if (config.memberAllowList && config.memberAllowList.length > 0) {
          if (!config.memberAllowList.includes(message.author.id)) {
            log.warn(`User ${message.author.id} not in memberAllowList`);
            return;
          }
        }

        // Build MsgContext early so preFilter can inspect it
        const body = message.content.replace(/<@!?\d+>\s*/g, "").trim();

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
          const botUser = client.user;
          // Explicitly ignore @everyone/@here, role mentions, and reply-to
          // mentions so only a direct @botUser mention triggers activation.
          const mentioned = botUser
            ? message.mentions.has(botUser, {
                ignoreEveryone: true,
                ignoreRoles: true,
                ignoreRepliedUser: true,
              })
            : false;
          const inAllowedChannel =
            config.channelAllowList && config.channelAllowList.length > 0
              ? config.channelAllowList.includes(message.channel.id)
              : false;

          const requireMention = config.requireMentionInGuild ?? true;

          // Strict mode: if mention is required, ONLY respond when the bot user is mentioned.
          // (Channel allowlist does not bypass mention requirement.)
          if (requireMention && !mentioned) {
            return;
          }

          // If mention is not required, and a channel allowlist is set, gate by it.
          if (!requireMention && config.channelAllowList && !inAllowedChannel) {
            return;
          }
        }

        try {
          await messageHandler(msgCtx);
        } catch (err) {
          log.error("Error handling message", err);
        }
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
