/**
 * Notification service
 * @see design.md Section 5.7
 */

import { createLogger } from "../utils/logger.js";
import type { ChannelRegistry } from "../channels/registry.js";
import type { ChannelId } from "../channels/interface.js";

const log = createLogger("notifications");

export interface NotificationService {
  notify(message: string, options?: NotifyOptions): Promise<void>;
  notifyChannel(channel: string, message: string): Promise<void>;
}

export interface NotifyOptions {
  priority?: "normal" | "high";
  silent?: boolean;
}

export interface NotificationServiceOptions {
  defaultChannel?: string;
  channels: ChannelRegistry;
}

export function createNotificationService(
  options: NotificationServiceOptions
): NotificationService {
  const { defaultChannel, channels } = options;

  return {
    async notify(message: string, _options?: NotifyOptions): Promise<void> {
      if (!defaultChannel) {
        log.warn("No default notification channel configured");
        return;
      }
      await this.notifyChannel(defaultChannel, message);
    },

    async notifyChannel(target: string, message: string): Promise<void> {
      // Parse channel target: "telegram:123456" or "discord:789012"
      const [channelId, userId] = target.split(":");
      if (!channelId || !userId) {
        log.error(`Invalid notification target: ${target}`);
        return;
      }

      const channel = channels.get(channelId as ChannelId);
      if (!channel) {
        log.error(`Channel not found: ${channelId}`);
        return;
      }

      try {
        await channel.send(userId, { text: message });
        log.info(`Notification sent to ${target}`);
      } catch (err) {
        log.error(`Failed to send notification to ${target}`, err);
      }
    },
  };
}
