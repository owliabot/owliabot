import { describe, expect, it } from "vitest";
import { resolveSessionKey } from "./session-key.js";
import type { Config } from "../config/schema.js";
import type { MsgContext } from "../channels/interface.js";

function makeConfig(partial?: Partial<Config>): Config {
  // Minimal required fields for Config type
  return {
    providers: [
      {
        id: "test",
        model: "test",
        apiKey: "test",
        priority: 1,
      },
    ],
    workspace: "./workspace",
    telegram: undefined,
    discord: undefined,
    notifications: undefined,
    heartbeat: undefined,
    skills: undefined,
    gateway: undefined,
    session: { scope: "per-agent", mainKey: "main" },
    agents: { defaultId: "main" },
    group: { activation: "mention" },
    ...partial,
  } as Config;
}

describe("resolveSessionKey", () => {
  it("discord DM + per-agent (default)", () => {
    const ctx: MsgContext = {
      from: "u1",
      senderName: "u1",
      body: "hi",
      messageId: "m1",
      channel: "discord",
      chatType: "direct",
      timestamp: Date.now(),
    };

    const key = resolveSessionKey({ ctx, config: makeConfig() });
    expect(key).toBe("agent:main:discord:conv:main:main");
  });

  it("discord DM + global", () => {
    const ctx: MsgContext = {
      from: "u1",
      senderName: "u1",
      body: "hi",
      messageId: "m1",
      channel: "discord",
      chatType: "direct",
      timestamp: Date.now(),
    };

    const config = makeConfig({ session: { scope: "global", mainKey: "main" } });
    const key = resolveSessionKey({ ctx, config });
    expect(key).toBe("agent:main:discord:conv:global:main");
  });

  it("discord guild message isolates by channelId (groupId)", () => {
    const ctx: MsgContext = {
      from: "u1",
      senderName: "u1",
      body: "hi",
      messageId: "m1",
      channel: "discord",
      chatType: "group",
      groupId: "c123",
      groupName: "guild",
      timestamp: Date.now(),
    };

    const key = resolveSessionKey({ ctx, config: makeConfig() });
    expect(key).toBe("agent:main:discord:conv:c123");
  });

  it("telegram group isolates by groupId", () => {
    const ctx: MsgContext = {
      from: "u1",
      senderName: "u1",
      body: "hi",
      messageId: "m1",
      channel: "telegram",
      chatType: "group",
      groupId: "g555",
      groupName: "tg-group",
      timestamp: Date.now(),
    };

    const key = resolveSessionKey({ ctx, config: makeConfig() });
    expect(key).toBe("agent:main:telegram:conv:g555");
  });

  it("agentId override affects the key", () => {
    const ctx: MsgContext = {
      from: "u1",
      senderName: "u1",
      body: "hi",
      messageId: "m1",
      channel: "discord",
      chatType: "direct",
      timestamp: Date.now(),
    };

    const key = resolveSessionKey({
      ctx,
      config: makeConfig(),
      agentIdOverride: "trader",
    });
    expect(key).toBe("agent:trader:discord:conv:main:main");
  });
});
