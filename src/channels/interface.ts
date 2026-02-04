/**
 * Channel plugin interface
 * @see design.md Section 5.1
 */

export type ChannelId = "telegram" | "discord";

export interface ChannelPlugin {
  id: ChannelId;

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;

  // Message handling
  onMessage(handler: MessageHandler): void;

  // Send message
  send(target: string, message: OutboundMessage): Promise<void>;

  // Capabilities
  capabilities: ChannelCapabilities;
}

export type MessageHandler = (ctx: MsgContext) => Promise<void>;

export interface MsgContext {
  // Sender
  from: string;
  senderName: string;
  senderUsername?: string;

  /**
   * Whether the bot was explicitly mentioned / invoked in this message.
   * Used for mention-only activation in group chats.
   */
  mentioned?: boolean;

  // Message
  body: string;
  messageId: string;
  replyToId?: string;

  // Channel
  channel: ChannelId;
  chatType: "direct" | "group" | "channel";
  groupId?: string;
  groupName?: string;

  // Media
  mediaUrls?: string[];
  audioUrl?: string;

  // Metadata
  timestamp: number;
}

export interface OutboundMessage {
  text: string;
  replyToId?: string;
  buttons?: MessageButton[];
}

export interface MessageButton {
  text: string;
  callbackData: string;
}

export interface ChannelCapabilities {
  reactions: boolean;
  threads: boolean;
  buttons: boolean;
  markdown: boolean;
  maxMessageLength: number;
}
