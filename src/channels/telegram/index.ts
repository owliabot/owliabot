import { Bot, type Context } from "grammy";
import { autoChatAction, type AutoChatActionFlavor } from "@grammyjs/auto-chat-action";
import { createLogger } from "../../utils/logger.js";
import type {
  ChannelPlugin,
  MessageHandler,
  MsgContext,
  OutboundMessage,
  ChannelCapabilities,
} from "../interface.js";

const log = createLogger("telegram");

/**
 * Convert markdown to Telegram HTML
 * Telegram supports: <b>, <i>, <code>, <pre>, <a>, <u>, <s>
 * Does NOT support: headers, lists, tables
 */
function markdownToTelegramHtml(text: string): string {
  let html = text;
  
  // Escape HTML entities first
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  
  // Headers (## Title) -> Bold with newline
  html = html.replace(/^### (.+)$/gm, "\n<b>$1</b>");
  html = html.replace(/^## (.+)$/gm, "\n<b>$1</b>");
  html = html.replace(/^# (.+)$/gm, "\n<b>$1</b>\n");
  
  // Horizontal rules (---) -> just a line
  html = html.replace(/^---+$/gm, "───────────");
  
  // Code blocks (```...```) - must be before inline code
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, "<pre>$2</pre>");
  
  // Inline code (`...`)
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  
  // Bold (**...**)
  html = html.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  
  // Italic (*...* but not **)
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<i>$1</i>");
  
  // Strikethrough (~~...~~)
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  
  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  
  // List items (- item) -> bullet
  html = html.replace(/^- (.+)$/gm, "• $1");
  
  // Clean up multiple newlines
  html = html.replace(/\n{3,}/g, "\n\n");
  
  return html.trim();
}

export interface TelegramConfig {
  token: string;
  allowList?: string[];
}

function normalizeBotUsername(username?: string | null): string | null {
  const u = (username ?? "").trim();
  return u ? u.replace(/^@/, "").toLowerCase() : null;
}

export function createTelegramPlugin(config: TelegramConfig): ChannelPlugin {
  const bot = new Bot<Context & AutoChatActionFlavor>(config.token);
  let messageHandler: MessageHandler | null = null;

  // Filled on start()
  let botUsername: string | null = null;
  let botUserId: number | null = null;

  const capabilities: ChannelCapabilities = {
    reactions: true,
    threads: false,
    buttons: true,
    markdown: true,
    maxMessageLength: 4096,
  };

  return {
    id: "telegram",
    capabilities,

    async start() {
      log.info("Starting Telegram bot...");

      // Cache bot identity for mention / reply detection
      try {
        const me = await bot.api.getMe();
        botUsername = normalizeBotUsername(me.username);
        botUserId = me.id;
        log.info(`Telegram bot identity: @${botUsername ?? "(no-username)"} (${botUserId})`);
      } catch (err) {
        log.warn("Failed to fetch Telegram bot identity (getMe)", err);
      }

      bot.on("message:text", async (ctx) => {
        if (!messageHandler) return;

        const chatType = ctx.chat.type === "private" ? "direct" : "group";

        // Check allowlist (applies to both DM + group)
        if (config.allowList && config.allowList.length > 0) {
          const userId = ctx.from?.id.toString();
          if (!userId || !config.allowList.includes(userId)) {
            log.warn(`User ${userId} not in allowlist`);
            return;
          }
        }

        const rawText = ctx.message.text;

        // Mention signal for gateway gating
        let mentioned = chatType === "direct";

        if (!mentioned && chatType === "group") {
          // A) reply-to-bot counts as mention
          const repliedFrom = ctx.message.reply_to_message?.from;
          if (repliedFrom?.is_bot) {
            if (botUserId && repliedFrom.id === botUserId) mentioned = true;
            const repliedUsername = normalizeBotUsername(repliedFrom.username);
            if (botUsername && repliedUsername === botUsername) mentioned = true;
          }

          // B) @botusername in text counts as mention
          if (!mentioned && botUsername) {
            const atRe = new RegExp(`(^|\\s)@${botUsername}(\\s|$)`, "i");
            if (atRe.test(rawText)) mentioned = true;
          }

          // C) /command@botusername counts as mention
          if (!mentioned) {
            const m = rawText.match(/^\/(\w+)(?:@([A-Za-z0-9_]+))?\b/);
            if (m) {
              const addr = normalizeBotUsername(m[2] ?? null);
              if (!addr) {
                // /command with no explicit @target: treat as mention
                mentioned = true;
              } else if (botUsername && addr === botUsername) {
                mentioned = true;
              }
            }
          }
        }

        // Strip bot addressing prefix for cleaner prompts (best effort)
        let body = rawText;
        if (chatType === "group" && botUsername) {
          // Remove leading @bot
          body = body.replace(new RegExp(`^@${botUsername}\\s*`, "i"), "");
          // Remove leading /cmd@bot
          body = body.replace(new RegExp(`^\/(\\w+)@${botUsername}\\s*`, "i"), "/$1 ");
        }
        body = body.trim();

        const msgCtx: MsgContext = {
          from: ctx.from?.id.toString() ?? "",
          senderName: ctx.from?.first_name ?? "Unknown",
          senderUsername: ctx.from?.username,
          mentioned,
          body: body.length > 0 ? body : rawText,
          messageId: ctx.message.message_id.toString(),
          replyToId: ctx.message.reply_to_message?.message_id.toString(),
          channel: "telegram",
          chatType,
          groupId: chatType === "group" ? ctx.chat.id.toString() : undefined,
          groupName: chatType === "group" ? ("title" in ctx.chat ? (ctx.chat as any).title : undefined) : undefined,
          timestamp: ctx.message.date * 1000,
        };

        try {
          // Send "typing..." only for messages the bot will actually handle.
          // Use autoChatAction as local middleware so it keeps resending
          // the indicator periodically for long-running responses.
          const chatAction = autoChatAction();
          await chatAction(ctx, async () => {
            await messageHandler!(msgCtx);
          });
        } catch (err) {
          log.error("Error handling message", err);
        }
      });

      await bot.start();
      log.info("Telegram bot started");
    },

    async stop() {
      log.info("Stopping Telegram bot...");
      await bot.stop();
      log.info("Telegram bot stopped");
    },

    onMessage(handler: MessageHandler) {
      messageHandler = handler;
    },

    async send(target: string, message: OutboundMessage) {
      const chatId = parseInt(target, 10);
      
      // Convert markdown to HTML for Telegram
      const html = markdownToTelegramHtml(message.text);
      
      try {
        await bot.api.sendMessage(chatId, html, {
          parse_mode: "HTML",
          reply_to_message_id: message.replyToId
            ? parseInt(message.replyToId, 10)
            : undefined,
        });
      } catch (err) {
        // Fallback to plain text if HTML parsing fails
        log.warn("HTML parsing failed, sending as plain text", err);
        await bot.api.sendMessage(chatId, message.text, {
          reply_to_message_id: message.replyToId
            ? parseInt(message.replyToId, 10)
            : undefined,
        });
      }
    },
  };
}
