// src/gateway/channels-init.ts
/**
 * Channel initialization module.
 * Handles Telegram and Discord channel registration with WriteGate adapters.
 */

import { createLogger } from "../utils/logger.js";
import { ChannelRegistry } from "../channels/registry.js";
import { createTelegramPlugin } from "../channels/telegram/index.js";
import { createDiscordPlugin } from "../channels/discord/index.js";
import {
  WriteGateReplyRouter,
  createWriteGateChannelAdapter,
} from "../security/write-gate-adapter.js";
import type { WriteGateChannel } from "../security/write-gate.js";
import type { MsgContext } from "../channels/interface.js";
import type { Config } from "../config/schema.js";

const log = createLogger("gateway:channels");

/**
 * Configuration for channel initialization.
 */
export interface ChannelsInitConfig {
  /** Telegram channel configuration */
  telegram?: Config["telegram"];
  /** Discord channel configuration */
  discord?: Config["discord"];
}

/**
 * Message handler callback type.
 */
export type MessageHandler = (ctx: MsgContext) => Promise<void>;

/**
 * Result of channel initialization.
 */
export interface ChannelsInitResult {
  /** Channel registry containing all registered plugins */
  registry: ChannelRegistry;
  /** Map of channel id to WriteGate adapter */
  writeGateChannels: Map<string, WriteGateChannel>;
  /** Shared reply router for WriteGate confirmations */
  replyRouter: WriteGateReplyRouter;
}

/**
 * Initializes all configured channels with WriteGate adapters.
 * 
 * Each channel is wrapped with a WriteGateChannelAdapter for security-aware
 * message sending that requires confirmation for certain operations.
 * 
 * @param config - Channel configuration
 * @param onMessage - Callback for incoming messages (after WriteGate routing)
 * @returns Channel initialization result with registry and WriteGate adapters
 * 
 * @example
 * ```ts
 * const channels = initializeChannels(
 *   { telegram: config.telegram, discord: config.discord },
 *   async (ctx) => {
 *     await handleMessage(ctx, ...);
 *   }
 * );
 * await channels.registry.startAll();
 * ```
 */
export function initializeChannels(
  config: ChannelsInitConfig,
  onMessage: MessageHandler,
): ChannelsInitResult {
  const registry = new ChannelRegistry();
  const replyRouter = new WriteGateReplyRouter();
  const writeGateChannels = new Map<string, WriteGateChannel>();

  // Register Telegram if configured
  if (config.telegram?.token) {
    const telegram = createTelegramPlugin({
      token: config.telegram.token,
      allowList: config.telegram.allowList,
    });

    writeGateChannels.set(
      "telegram",
      createWriteGateChannelAdapter(telegram, replyRouter),
    );

    telegram.onMessage(async (ctx) => {
      // Check if this is a WriteGate confirmation reply
      if (replyRouter.tryRoute(ctx)) return;
      await onMessage(ctx);
    });

    registry.register(telegram);
    log.info("Telegram channel registered");
  } else if (config.telegram) {
    log.warn("Telegram configured but token missing; skipping Telegram channel startup");
  }

  // Register Discord if configured
  if (config.discord?.token) {
    const discord = createDiscordPlugin({
      token: config.discord.token,
      memberAllowList: config.discord.memberAllowList,
      channelAllowList: config.discord.channelAllowList,
      requireMentionInGuild: config.discord.requireMentionInGuild,
      // Let WriteGate confirmation replies bypass the mention gate
      preFilter: (ctx) => replyRouter.hasPendingWaiter(ctx),
    });

    writeGateChannels.set(
      "discord",
      createWriteGateChannelAdapter(discord, replyRouter),
    );

    discord.onMessage(async (ctx) => {
      // Check if this is a WriteGate confirmation reply
      if (replyRouter.tryRoute(ctx)) return;
      await onMessage(ctx);
    });

    registry.register(discord);
    log.info("Discord channel registered");
  } else if (config.discord) {
    log.warn("Discord configured but token missing; skipping Discord channel startup");
  }

  return { registry, writeGateChannels, replyRouter };
}

/**
 * Starts all registered channels.
 * 
 * @param registry - Channel registry to start
 */
export async function startChannels(registry: ChannelRegistry): Promise<void> {
  await registry.startAll();
  log.info("All channels started");
}

/**
 * Stops all registered channels.
 * 
 * @param registry - Channel registry to stop
 */
export async function stopChannels(registry: ChannelRegistry): Promise<void> {
  await registry.stopAll();
  log.info("All channels stopped");
}
