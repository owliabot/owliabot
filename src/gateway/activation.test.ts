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
});
