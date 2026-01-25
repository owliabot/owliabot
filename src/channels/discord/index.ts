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
  allowList?: string[];
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

        // MVP: only handle DMs
        const isDM = !message.guild;
        if (!isDM) {
          log.debug("Ignoring guild message");
          return;
        }

        // Check allowlist
        if (config.allowList && config.allowList.length > 0) {
          if (!config.allowList.includes(message.author.id)) {
            log.warn(`User ${message.author.id} not in allowlist`);
            return;
          }
        }

        const msgCtx: MsgContext = {
          from: message.author.id,
          senderName: message.author.displayName ?? message.author.username,
          senderUsername: message.author.username,
          body: message.content,
          messageId: message.id,
          replyToId: message.reference?.messageId,
          channel: "discord",
          chatType: "direct",
          groupId: undefined,
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
