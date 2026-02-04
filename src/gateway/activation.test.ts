import { describe, expect, it } from "vitest";
import { shouldHandleMessage } from "./activation.js";

function makeConfig(partial: any = {}) {
  return {
    providers: [{ id: "x", model: "m", apiKey: "k", priority: 1 }],
    workspace: "./workspace",
    session: { scope: "per-agent", mainKey: "main" },
    agents: { defaultId: "main" },
    group: { activation: "mention" },
    ...partial,
  } as any;
}

describe("shouldHandleMessage", () => {
  it("blocks non-allowList users in allowlisted discord channel", () => {
    const config = makeConfig({
      discord: {
        token: "x",
        allowList: ["u-allowed"],
        channelAllowList: ["c1"],
      },
    });

    const ctx: any = {
      channel: "discord",
      chatType: "group",
      from: "u-denied",
      groupId: "c1",
      mentioned: false,
    };

    expect(shouldHandleMessage(ctx, config)).toBe(false);
  });

  it("allows allowList user in discord guild when mentioned", () => {
    const config = makeConfig({
      discord: { token: "x", allowList: ["u1"] },
    });

    const ctx: any = {
      channel: "discord",
      chatType: "group",
      from: "u1",
      groupId: "c1",
      mentioned: true,
    };

    expect(shouldHandleMessage(ctx, config)).toBe(true);
  });

  it("allows telegram group when groupAllowList matches", () => {
    const config = makeConfig({
      telegram: {
        token: "x",
        allowList: ["u1"],
        groupAllowList: ["g1"],
      },
    });

    const ctx: any = {
      channel: "telegram",
      chatType: "group",
      from: "u1",
      groupId: "g1",
      mentioned: false,
    };

    expect(shouldHandleMessage(ctx, config)).toBe(true);
  });

  it("allows DMs after allowList pass", () => {
    const config = makeConfig({
      telegram: { token: "x", allowList: ["u1"] },
    });

    const ctx: any = {
      channel: "telegram",
      chatType: "direct",
      from: "u1",
      mentioned: true,
    };

    expect(shouldHandleMessage(ctx, config)).toBe(true);
  });

  it("blocks group message when not mentioned and not in channelAllowList", () => {
    const config = makeConfig({
      discord: { token: "x" },
    });

    const ctx: any = {
      channel: "discord",
      chatType: "group",
      from: "u1",
      groupId: "c-random",
      mentioned: false,
    };

    expect(shouldHandleMessage(ctx, config)).toBe(false);
  });

  it("blocks group message when mentioned is undefined", () => {
    const config = makeConfig({
      discord: { token: "x" },
    });

    const ctx: any = {
      channel: "discord",
      chatType: "group",
      from: "u1",
      groupId: "c-random",
      // mentioned is undefined (not set)
    };

    expect(shouldHandleMessage(ctx, config)).toBe(false);
  });

  it("allows group message when mentioned is true (mention-only mode)", () => {
    const config = makeConfig({
      discord: { token: "x" },
    });

    const ctx: any = {
      channel: "discord",
      chatType: "group",
      from: "u1",
      groupId: "c-random",
      mentioned: true,
    };

    expect(shouldHandleMessage(ctx, config)).toBe(true);
  });

  it("allows all group messages when activation is 'always'", () => {
    const config = makeConfig({
      discord: { token: "x" },
      group: { activation: "always" },
    });

    const ctx: any = {
      channel: "discord",
      chatType: "group",
      from: "u1",
      groupId: "c-random",
      mentioned: false,
    };

    expect(shouldHandleMessage(ctx, config)).toBe(true);
  });

  it("allows channelAllowList channel even without mention", () => {
    const config = makeConfig({
      discord: { token: "x", channelAllowList: ["c-allowed"] },
    });

    const ctx: any = {
      channel: "discord",
      chatType: "group",
      from: "u1",
      groupId: "c-allowed",
      mentioned: false,
    };

    expect(shouldHandleMessage(ctx, config)).toBe(true);
  });

  it("blocks channelAllowList channel when user not in allowList", () => {
    const config = makeConfig({
      discord: { token: "x", allowList: ["u-allowed"], channelAllowList: ["c-allowed"] },
    });

    const ctx: any = {
      channel: "discord",
      chatType: "group",
      from: "u-denied",
      groupId: "c-allowed",
      mentioned: true,
    };

    expect(shouldHandleMessage(ctx, config)).toBe(false);
  });

  it("allows DM even without mention flag (chatType=direct)", () => {
    const config = makeConfig({
      discord: { token: "x" },
    });

    const ctx: any = {
      channel: "discord",
      chatType: "direct",
      from: "u1",
      mentioned: false, // DMs should always pass regardless
    };

    expect(shouldHandleMessage(ctx, config)).toBe(true);
  });

  it("allows any user when no allowList is configured", () => {
    const config = makeConfig({
      discord: { token: "x" },
      // no allowList
    });

    const ctx: any = {
      channel: "discord",
      chatType: "group",
      from: "any-random-user",
      groupId: "c1",
      mentioned: true,
    };

    expect(shouldHandleMessage(ctx, config)).toBe(true);
  });

  it("blocks group message with empty channelAllowList and no mention", () => {
    const config = makeConfig({
      discord: { token: "x", channelAllowList: [] },
    });

    const ctx: any = {
      channel: "discord",
      chatType: "group",
      from: "u1",
      groupId: "c1",
      mentioned: false,
    };

    expect(shouldHandleMessage(ctx, config)).toBe(false);
  });

  it("blocks when groupId is undefined in group chat (edge case)", () => {
    const config = makeConfig({
      discord: { token: "x", channelAllowList: ["c1"] },
    });

    const ctx: any = {
      channel: "discord",
      chatType: "group",
      from: "u1",
      groupId: undefined,
      mentioned: false,
    };

    expect(shouldHandleMessage(ctx, config)).toBe(false);
  });

  it("blocks telegram group when not in groupAllowList and not mentioned", () => {
    const config = makeConfig({
      telegram: { token: "x" },
    });

    const ctx: any = {
      channel: "telegram",
      chatType: "group",
      from: "u1",
      groupId: "g-random",
      mentioned: false,
    };

    expect(shouldHandleMessage(ctx, config)).toBe(false);
  });
});
