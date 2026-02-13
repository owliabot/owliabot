import { describe, it, expect } from "vitest";
import { shouldHandleMessage, passesUserAllowlist } from "../activation.js";
import { configSchema } from "../../config/schema.js";
import type { MsgContext } from "../../channels/interface.js";

function makeBaseConfig(overrides: any = {}) {
  return configSchema.parse({
    providers: [{ id: "test", model: "m", apiKey: "k", priority: 1 }],
    workspace: "/tmp/workspace",
    infra: { enabled: false },
    skills: { enabled: false },
    heartbeat: { enabled: false },
    cron: { enabled: false },
    ...overrides,
  });
}

describe("activation (user allowlist)", () => {
  it("rejects when no allowList is configured", () => {
    const config = makeBaseConfig({ telegram: { token: "t" } });

    const ctx: MsgContext = {
      channel: "telegram",
      chatType: "direct",
      from: "111",
      senderName: "Alice",
      body: "hello",
      messageId: "m1",
      timestamp: Date.now(),
    };

    expect(passesUserAllowlist(ctx, config)).toBe(false);
    expect(shouldHandleMessage(ctx, config)).toBe(false);
  });

  it("allows user on the allowList", () => {
    const config = makeBaseConfig({
      telegram: { token: "t", allowList: ["111"] },
    });

    const ctx: MsgContext = {
      channel: "telegram",
      chatType: "direct",
      from: "111",
      senderName: "Alice",
      body: "hello",
      messageId: "m1",
      timestamp: Date.now(),
    };

    expect(passesUserAllowlist(ctx, config)).toBe(true);
    expect(shouldHandleMessage(ctx, config)).toBe(true);
  });

  it("rejects user not on the allowList", () => {
    const config = makeBaseConfig({
      telegram: { token: "t", allowList: ["222"] },
    });

    const ctx: MsgContext = {
      channel: "telegram",
      chatType: "direct",
      from: "111",
      senderName: "Alice",
      body: "hello",
      messageId: "m1",
      timestamp: Date.now(),
    };

    expect(passesUserAllowlist(ctx, config)).toBe(false);
    expect(shouldHandleMessage(ctx, config)).toBe(false);
  });
});

describe("activation (telegram group policies)", () => {
  it("requires mention by default when group.activation=mention and no per-group config", () => {
    const config = makeBaseConfig({
      group: { activation: "mention" },
      telegram: { token: "t", allowList: ["111"] },
    });

    const ctx: MsgContext = {
      channel: "telegram",
      chatType: "group",
      groupId: "-1001",
      from: "111",
      senderName: "Alice",
      body: "hello",
      messageId: "m1",
      timestamp: Date.now(),
      mentioned: false,
    };

    expect(shouldHandleMessage(ctx, config)).toBe(false);
  });

  it("telegram.groups requireMention=false allows responding without mention", () => {
    const config = makeBaseConfig({
      group: { activation: "mention" },
      telegram: {
        token: "t",
        allowList: ["111"],
        groups: { "-1001": { requireMention: false } },
      },
    });

    const ctx: MsgContext = {
      channel: "telegram",
      chatType: "group",
      groupId: "-1001",
      from: "111",
      senderName: "Alice",
      body: "hello",
      messageId: "m1",
      timestamp: Date.now(),
      mentioned: false,
    };

    expect(shouldHandleMessage(ctx, config)).toBe(true);
  });

  it("telegram.groups enabled=false disables the bot for that group", () => {
    const config = makeBaseConfig({
      group: { activation: "always" },
      telegram: {
        token: "t",
        allowList: ["111"],
        groups: { "-1001": { enabled: false, requireMention: false } },
      },
    });

    const ctx: MsgContext = {
      channel: "telegram",
      chatType: "group",
      groupId: "-1001",
      from: "111",
      senderName: "Alice",
      body: "hello",
      messageId: "m1",
      timestamp: Date.now(),
      mentioned: true,
    };

    expect(shouldHandleMessage(ctx, config)).toBe(false);
  });

  it("telegram.groups allowFrom gates triggers by user id and @username", () => {
    const config = makeBaseConfig({
      group: { activation: "always" },
      telegram: {
        token: "t",
        allowList: ["123", "999"],
        groups: {
          "-1001": { requireMention: false, allowFrom: ["123", "@alice"] },
        },
      },
    });

    const allowedById: MsgContext = {
      channel: "telegram",
      chatType: "group",
      groupId: "-1001",
      from: "123",
      senderName: "X",
      body: "hi",
      messageId: "m1",
      timestamp: Date.now(),
    };
    expect(shouldHandleMessage(allowedById, config)).toBe(true);

    const allowedByUser: MsgContext = {
      channel: "telegram",
      chatType: "group",
      groupId: "-1001",
      from: "999",
      senderName: "Alice",
      senderUsername: "Alice",
      body: "hi",
      messageId: "m2",
      timestamp: Date.now(),
    };
    expect(shouldHandleMessage(allowedByUser, config)).toBe(true);

    const blocked: MsgContext = {
      channel: "telegram",
      chatType: "group",
      groupId: "-1001",
      from: "999",
      senderName: "Bob",
      senderUsername: "bob",
      body: "hi",
      messageId: "m3",
      timestamp: Date.now(),
      mentioned: true,
    };
    expect(shouldHandleMessage(blocked, config)).toBe(false);
  });

  it("group.mentionPatterns can promote a group message to mentioned", () => {
    const config = makeBaseConfig({
      group: { activation: "mention", mentionPatterns: ["owlia"] },
      telegram: { token: "t", allowList: ["111"] },
    });

    const ctx: MsgContext = {
      channel: "telegram",
      chatType: "group",
      groupId: "-1001",
      from: "111",
      senderName: "Alice",
      body: "hello owlia",
      messageId: "m1",
      timestamp: Date.now(),
    };

    expect(ctx.mentioned).toBeUndefined();
    expect(shouldHandleMessage(ctx, config)).toBe(true);
    expect(ctx.mentioned).toBe(true);
  });
});
