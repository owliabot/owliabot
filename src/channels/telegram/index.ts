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

// Telegram reactions are chat-configurable and can be restricted. Keep a small
// set of common reactions as fallbacks to avoid repeated REACTION_INVALID errors.
const REACTION_FALLBACKS = ["👍", "❤", "🔥", "🎉", "🤔", "😁"] as const;

function isTelegramReactionInvalid(err: unknown): boolean {
  const e = err as any;
  const desc = typeof e?.description === "string" ? e.description : "";
  return e?.error_code === 400 && /REACTION_INVALID/i.test(desc);
}

function isTelegramReactionsNotAllowed(err: unknown): boolean {
  const e = err as any;
  const desc = typeof e?.description === "string" ? e.description : "";
  return e?.error_code === 400 && /REACTIONS_NOT_ALLOWED/i.test(desc);
}

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
  /** Optional allowlist for direct messages. Group messages should be gated via telegram.groups.* */
  allowList?: string[];
}

function normalizeBotUsername(username?: string | null): string | null {
  const u = (username ?? "").trim();
  return u ? u.replace(/^@/, "").toLowerCase() : null;
}

export function createTelegramPlugin(config: TelegramConfig): ChannelPlugin {
  const bot = new Bot<Context & AutoChatActionFlavor>(config.token);
  let messageHandler: MessageHandler | null = null;
  const reactionDisabledChats = new Set<string>();
  let chatActionInstalled = false;

  // Filled on start()
  let botUsername: string | null = null;
  let botUserId: number | null = null;

  const capabilities: ChannelCapabilities = {
    reactions: true,
    threads: true,
    buttons: true,
    markdown: true,
    maxMessageLength: 4096,
  };

  return {
    id: "telegram",
    capabilities,

    async start() {
      log.info("Starting Telegram bot...");

      if (!chatActionInstalled) {
        bot.use(autoChatAction());
        chatActionInstalled = true;
      }

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

        // NOTE: allowlist gating is handled by the gateway (passesUserAllowlist +
        // UnboundNotifier).  Do NOT block here — the gateway needs to see the
        // message so it can send the onboard prompt to unbound users.

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
          threadId: (ctx.message as any).message_thread_id
            ? String((ctx.message as any).message_thread_id)
            : undefined,
          replyToBody:
            (ctx.message.reply_to_message as any)?.text ??
            (ctx.message.reply_to_message as any)?.caption,
          replyToSender:
            ctx.message.reply_to_message?.from?.first_name ??
            ctx.message.reply_to_message?.from?.username,
          mentioned,
          body: body.length > 0 ? body : rawText,
          messageId: ctx.message.message_id.toString(),
          replyToId: ctx.message.reply_to_message?.message_id.toString(),
          channel: "telegram",
          chatType,
          groupId: chatType === "group" ? ctx.chat.id.toString() : undefined,
          groupName: chatType === "group" ? ("title" in ctx.chat ? (ctx.chat as any).title : undefined) : undefined,
          timestamp: ctx.message.date * 1000,
          // Let the gateway decide when we're actually going to respond.
          // autoChatAction will emit indicators while this is set during processing.
          setTyping: (isTyping: boolean) => {
            ctx.chatAction = isTyping ? "typing" : (null as any);
          },
        };

        try {
          await messageHandler!(msgCtx);
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

      if (!message.text || message.text.trim().length === 0) {
        log.warn("Skipping send: message text is empty");
        return;
      }

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

    async addReaction(chatId: string, messageId: string, emoji: string) {
      if (reactionDisabledChats.has(chatId)) return;
      try {
        await bot.api.setMessageReaction(
          parseInt(chatId, 10),
          parseInt(messageId, 10),
          [{ type: "emoji", emoji }] as any,
        );
      } catch (err) {
        if (isTelegramReactionsNotAllowed(err)) {
          reactionDisabledChats.add(chatId);
          log.debug("Reactions not allowed in chat; disabling reaction attempts", {
            chatId,
          });
          return;
        }

        if (isTelegramReactionInvalid(err)) {
          for (const fallback of REACTION_FALLBACKS) {
            if (fallback === emoji) continue;
            try {
              await bot.api.setMessageReaction(
                parseInt(chatId, 10),
                parseInt(messageId, 10),
                [{ type: "emoji", emoji: fallback }] as any,
              );
              log.debug("Reaction emoji invalid; used fallback", {
                chatId,
                messageId,
                requested: emoji,
                fallback,
              });
              return;
            } catch (err2) {
              if (isTelegramReactionsNotAllowed(err2)) {
                reactionDisabledChats.add(chatId);
                return;
              }
              if (isTelegramReactionInvalid(err2)) continue;
              log.warn("Failed to add reaction (fallback)", err2);
              return;
            }
          }

          // None accepted: treat as reactions effectively unavailable for this chat.
          reactionDisabledChats.add(chatId);
          log.debug("No valid reactions accepted; disabling reaction attempts", {
            chatId,
            messageId,
          });
          return;
        }

        // Reaction UX is best-effort; only warn on unexpected errors.
        log.warn("Failed to add reaction", err);
      }
    },

    async removeReaction(chatId: string, messageId: string, _emoji: string) {
      try {
        await bot.api.setMessageReaction(
          parseInt(chatId, 10),
          parseInt(messageId, 10),
          [] as any,
        );
      } catch (err) {
        log.warn("Failed to remove reaction", err);
      }
    },
  };
}
