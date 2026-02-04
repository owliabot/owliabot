import { describe, it, expect } from "vitest";
import type {
  ChannelId,
  ChannelPlugin,
  MessageHandler,
  MsgContext,
  OutboundMessage,
  MessageButton,
  ChannelCapabilities,
} from "../interface.js";

describe("channels interface", () => {
  it("should allow importing ChannelId type", () => {
    const id: ChannelId = "discord";
    expect(id).toBe("discord");

    const id2: ChannelId = "telegram";
    expect(id2).toBe("telegram");
  });

  it("should allow importing MsgContext type", () => {
    const ctx: MsgContext = {
      from: "user123",
      senderName: "John Doe",
      senderUsername: "johndoe",
      body: "Hello!",
      messageId: "msg_123",
      channel: "discord",
      chatType: "direct",
      timestamp: Date.now(),
    };

    expect(ctx.from).toBe("user123");
    expect(ctx.channel).toBe("discord");
  });

  it("should allow importing OutboundMessage type", () => {
    const message: OutboundMessage = {
      text: "Hello, world!",
      replyToId: "msg_456",
      buttons: [
        { text: "Click me", callbackData: "button_1" },
      ],
    };

    expect(message.text).toBe("Hello, world!");
    expect(message.buttons).toHaveLength(1);
  });

  it("should allow importing MessageButton type", () => {
    const button: MessageButton = {
      text: "Accept",
      callbackData: "accept_123",
    };

    expect(button.text).toBe("Accept");
  });

  it("should allow importing ChannelCapabilities type", () => {
    const capabilities: ChannelCapabilities = {
      reactions: true,
      threads: true,
      buttons: true,
      markdown: true,
      maxMessageLength: 2000,
    };

    expect(capabilities.reactions).toBe(true);
    expect(capabilities.maxMessageLength).toBe(2000);
  });

  it("should support different chat types", () => {
    const directCtx: MsgContext = {
      from: "user1",
      senderName: "Alice",
      body: "Hi",
      messageId: "msg1",
      channel: "telegram",
      chatType: "direct",
      timestamp: Date.now(),
    };

    const groupCtx: MsgContext = {
      from: "user2",
      senderName: "Bob",
      body: "Hello everyone",
      messageId: "msg2",
      channel: "discord",
      chatType: "group",
      groupId: "group_123",
      groupName: "General",
      timestamp: Date.now(),
    };

    expect(directCtx.chatType).toBe("direct");
    expect(groupCtx.chatType).toBe("group");
    expect(groupCtx.groupId).toBe("group_123");
  });

  it("should support optional media fields", () => {
    const ctx: MsgContext = {
      from: "user1",
      senderName: "Alice",
      body: "Check this out!",
      messageId: "msg1",
      channel: "telegram",
      chatType: "direct",
      timestamp: Date.now(),
      mediaUrls: ["https://example.com/image.jpg"],
      audioUrl: "https://example.com/audio.mp3",
    };

    expect(ctx.mediaUrls).toHaveLength(1);
    expect(ctx.audioUrl).toBeDefined();
  });
});
