/**
 * Gateway / Main Loop
 * @see design.md Section 5.8
 */

import { createLogger } from "../utils/logger.js";
import type { Config } from "../config/schema.js";
import type { WorkspaceFiles } from "../workspace/types.js";
import { ChannelRegistry } from "../channels/registry.js";
import { createTelegramPlugin } from "../channels/telegram/index.js";
import { createDiscordPlugin } from "../channels/discord/index.js";
import { createSessionManager, type Message, type SessionKey } from "../agent/session.js";
import { callWithFailover, type LLMProvider } from "../agent/runner.js";
import { buildSystemPrompt } from "../agent/system-prompt.js";
import type { MsgContext } from "../channels/interface.js";

const log = createLogger("gateway");

export interface GatewayOptions {
  config: Config;
  workspace: WorkspaceFiles;
  sessionsDir: string;
}

export async function startGateway(options: GatewayOptions): Promise<() => Promise<void>> {
  const { config, workspace, sessionsDir } = options;

  const channels = new ChannelRegistry();
  const sessions = createSessionManager(sessionsDir);

  // Register Telegram if configured
  if (config.telegram) {
    const telegram = createTelegramPlugin({
      token: config.telegram.token,
      allowList: config.telegram.allowList,
    });

    telegram.onMessage(async (ctx) => {
      await handleMessage(ctx, config, workspace, sessions, channels);
    });

    channels.register(telegram);
  }

  // Register Discord if configured
  if (config.discord) {
    const discord = createDiscordPlugin({
      token: config.discord.token,
      allowList: config.discord.allowList,
    });

    discord.onMessage(async (ctx) => {
      await handleMessage(ctx, config, workspace, sessions, channels);
    });

    channels.register(discord);
  }

  // Start all channels
  await channels.startAll();
  log.info("Gateway started");

  // Return cleanup function
  return async () => {
    await channels.stopAll();
    log.info("Gateway stopped");
  };
}

async function handleMessage(
  ctx: MsgContext,
  config: Config,
  workspace: WorkspaceFiles,
  sessions: ReturnType<typeof createSessionManager>,
  channels: ChannelRegistry
): Promise<void> {
  const sessionKey: SessionKey = `${ctx.channel}:${ctx.from}`;

  log.info(`Message from ${sessionKey}: ${ctx.body.slice(0, 50)}...`);

  // Append user message to session
  const userMessage: Message = {
    role: "user",
    content: ctx.body,
    timestamp: ctx.timestamp,
  };
  await sessions.append(sessionKey, userMessage);

  // Get conversation history
  const history = await sessions.getHistory(sessionKey);

  // Build system prompt
  const systemPrompt = buildSystemPrompt({
    workspace,
    channel: ctx.channel,
    timezone: "UTC+8", // TODO: from config
    model: config.providers[0].model,
  });

  // Prepare messages for LLM
  const messages: Message[] = [
    { role: "system", content: systemPrompt, timestamp: Date.now() },
    ...history,
  ];

  // Call LLM
  const providers: LLMProvider[] = config.providers;
  const response = await callWithFailover(providers, messages);

  log.info(`Response from ${response.provider}: ${response.content.slice(0, 50)}...`);

  // Append assistant response to session
  const assistantMessage: Message = {
    role: "assistant",
    content: response.content,
    timestamp: Date.now(),
  };
  await sessions.append(sessionKey, assistantMessage);

  // Send response
  const channel = channels.get(ctx.channel);
  if (channel) {
    await channel.send(ctx.from, {
      text: response.content,
      replyToId: ctx.messageId,
    });
  }
}
