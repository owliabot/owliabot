/**
 * Notification service
 * @see design.md Section 5.7
 */

export interface NotificationService {
  notify(message: string, options?: NotifyOptions): Promise<void>;
  notifyChannel(channel: string, message: string): Promise<void>;
}

export interface NotifyOptions {
  priority?: "normal" | "high";
  silent?: boolean;
}
