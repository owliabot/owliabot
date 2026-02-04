import { Client, GatewayIntentBits, Events } from "discord.js";
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
  allowList?: string[];
  /** Allow list of guild channel IDs where the bot will respond */
  channelAllowList?: string[];
  /** Deprecated: use config.group.activation in gateway. */
  requireMentionInGuild?: boolean;
}

export function createDiscordPlugin(config: DiscordConfig): ChannelPlugin {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
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
        if (config.allowList && config.allowList.length > 0) {
          if (!config.allowList.includes(message.author.id)) {
            log.warn(`User ${message.author.id} not in allowlist`);
            return;
          }
        }

        // Compute mention signal (gateway will decide whether to respond)
        // Explicitly ignore @everyone/@here, role mentions, and reply-to mentions
        // so that only a direct @bot mention triggers activation.
        const botUser = client.user;
        const mentioned =
          !isDM && botUser
            ? message.mentions.has(botUser, {
                ignoreEveryone: true,
                ignoreRoles: true,
                ignoreRepliedUser: true,
              })
            : false;

        // Strip bot mention prefix for cleaner prompts (best-effort)
        let body = message.content;
        if (!isDM && botUser) {
          const prefixRe = new RegExp(`^<@!?${botUser.id}>\\s*`);
          body = body.replace(prefixRe, "");
        }
        body = body.trim();

        const msgCtx: MsgContext = {
          from: message.author.id,
          senderName: message.author.displayName ?? message.author.username,
          senderUsername: message.author.username,
          mentioned: isDM ? true : mentioned,
          body: body.length > 0 ? body : message.content,
          messageId: message.id,
          replyToId: message.reference?.messageId,
          channel: "discord",
          chatType: isDM ? "direct" : "group",
          groupId: isDM ? undefined : message.channel.id,
          groupName: isDM ? undefined : message.guild?.name,
          timestamp: message.createdTimestamp,
        };

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
