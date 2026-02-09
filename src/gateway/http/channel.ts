/**
 * HTTP Channel Plugin
 *
 * Implements the ChannelPlugin interface for the HTTP Gateway, making it
 * a peer of Discord/Telegram channels within the unified Gateway.
 *
 * Key differences from traditional channels:
 * - No persistent connection (pull-based via /events/poll)
 * - Lifecycle managed by the HTTP server, not this plugin
 * - Messages sent to devices via events store
 *
 * @see docs/plans/gateway-unification.md Phase 2
 */

import type {
  ChannelPlugin,
  ChannelCapabilities,
  MessageHandler,
  OutboundMessage,
} from "../../channels/interface.js";
import type { Store } from "./store.js";

export interface HttpChannelOptions {
  /** Device/event store for pushing messages */
  store: Store;
}

/**
 * HTTP channel capabilities
 * - No reactions, threads, or buttons (simple JSON messages)
 * - No markdown rendering (client handles formatting)
 * - Large message limit (JSON payload, not chat message)
 */
const HTTP_CAPABILITIES: ChannelCapabilities = {
  reactions: false,
  threads: false,
  buttons: false,
  markdown: false,
  maxMessageLength: 1_000_000, // 1MB JSON payload
};

/**
 * Create HTTP Channel Plugin
 *
 * The HTTP channel:
 * - Has id "http"
 * - start()/stop() are no-ops (HTTP server manages lifecycle)
 * - send() pushes events to the store for devices to poll
 * - onMessage() is never called (HTTP routes handle requests directly)
 */
export function createHttpChannel(opts: HttpChannelOptions): ChannelPlugin {
  const { store } = opts;

  // Message handlers (not used - HTTP routes handle messages directly)
  const handlers: MessageHandler[] = [];

  return {
    id: "http",

    capabilities: HTTP_CAPABILITIES,

    /**
     * Start the HTTP channel.
     * No-op because HTTP server lifecycle is managed by the gateway.
     */
    async start(): Promise<void> {
      // HTTP server is started separately by startGatewayHttp()
      // This plugin only handles message routing
    },

    /**
     * Stop the HTTP channel.
     * No-op because HTTP server lifecycle is managed by the gateway.
     */
    async stop(): Promise<void> {
      // HTTP server is stopped separately
    },

    /**
     * Register a message handler.
     * Note: HTTP channel doesn't use this - routes handle messages directly.
     * Kept for interface compliance.
     */
    onMessage(handler: MessageHandler): void {
      handlers.push(handler);
    },

    /**
     * Send a message to a device via the events store.
     *
     * @param target - Device ID to send to
     * @param message - Message content
     */
    async send(target: string, message: OutboundMessage): Promise<void> {
      const eventTime = Date.now();
      // Default TTL: 24 hours
      const ttlMs = 24 * 60 * 60 * 1000;

      store.insertEvent({
        type: "message",
        time: eventTime,
        status: "pending",
        source: "gateway",
        message: message.text,
        metadataJson: JSON.stringify({
          targetDeviceId: target,
          replyToId: message.replyToId,
          buttons: message.buttons,
        }),
        expiresAt: eventTime + ttlMs,
      });
    },
  };
}
