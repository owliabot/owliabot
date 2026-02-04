import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system-prompt.js";

describe("buildSystemPrompt memory injection boundary", () => {
  const workspace = {
    soul: "SOUL",
    identity: "IDENTITY",
    user: "USER",
    tools: "TOOLS",
    memory: "TOP_SECRET_MEMORY",
  };

  it("includes MEMORY.md in direct chats", () => {
    const prompt = buildSystemPrompt({
      workspace,
      channel: "discord",
      chatType: "direct",
      timezone: "UTC",
      model: "test",
    });

    expect(prompt).toContain("## Memory");
    expect(prompt).toContain("TOP_SECRET_MEMORY");
  });

  it("does not include MEMORY.md in group chats", () => {
    const prompt = buildSystemPrompt({
      workspace,
      channel: "discord",
      chatType: "group",
      timezone: "UTC",
      model: "test",
    });

    expect(prompt).not.toContain("## Memory");
    expect(prompt).not.toContain("TOP_SECRET_MEMORY");
  });

  it("does not include MEMORY.md in channel contexts", () => {
    const prompt = buildSystemPrompt({
      workspace,
      channel: "discord",
      chatType: "channel",
      timezone: "UTC",
      model: "test",
    });

    expect(prompt).not.toContain("## Memory");
    expect(prompt).not.toContain("TOP_SECRET_MEMORY");
  });
});
