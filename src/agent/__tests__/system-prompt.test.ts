import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../system-prompt.js";
import type { PromptContext } from "../system-prompt.js";

describe("system-prompt", () => {
  describe("buildSystemPrompt", () => {
    it("should build basic system prompt with minimal context", () => {
      const ctx: PromptContext = {
        workspace: {},
        channel: "discord",
        timezone: "UTC",
        model: "claude-sonnet-4-5",
        chatType: "direct",
      };

      const prompt = buildSystemPrompt(ctx);

      expect(prompt).toContain("## Runtime");
      expect(prompt).toContain("Channel: discord");
      expect(prompt).toContain("Model: claude-sonnet-4-5");
      expect(prompt).toContain("Timezone: UTC");
      expect(prompt).not.toContain("## Persona & Boundaries");
    });

    it("should include soul section when present", () => {
      const ctx: PromptContext = {
        workspace: {
          soul: "I am a helpful assistant with a focus on privacy.",
        },
        channel: "telegram",
        timezone: "America/New_York",
        model: "gpt-4o",
        chatType: "direct",
      };

      const prompt = buildSystemPrompt(ctx);

      expect(prompt).toContain("## Persona & Boundaries");
      expect(prompt).toContain("helpful assistant with a focus on privacy");
    });

    it("should include agent guidelines when present", () => {
      const ctx: PromptContext = {
        workspace: {
          agents: "Follow the workspace rules.",
        },
        channel: "discord",
        timezone: "UTC",
        model: "sonnet",
        chatType: "direct",
      };

      const prompt = buildSystemPrompt(ctx);

      expect(prompt).toContain("## Agent Guidelines");
      expect(prompt).toContain("Follow the workspace rules.");
    });

    it("should include bootstrap instructions when present", () => {
      const ctx: PromptContext = {
        workspace: {
          bootstrap: "Complete setup and delete BOOTSTRAP.md.",
        },
        channel: "discord",
        timezone: "UTC",
        model: "sonnet",
        chatType: "direct",
      };

      const prompt = buildSystemPrompt(ctx);

      expect(prompt).toContain("## Bootstrap");
      expect(prompt).toContain("Complete setup and delete BOOTSTRAP.md.");
    });

    it("should include identity section when present", () => {
      const ctx: PromptContext = {
        workspace: {
          identity: "My name is OwliaBot",
        },
        channel: "discord",
        timezone: "UTC",
        model: "sonnet",
        chatType: "direct",
      };

      const prompt = buildSystemPrompt(ctx);

      expect(prompt).toContain("## Identity");
      expect(prompt).toContain("My name is OwliaBot");
    });

    it("should include user profile when present", () => {
      const ctx: PromptContext = {
        workspace: {
          user: "User prefers concise answers",
        },
        channel: "discord",
        timezone: "UTC",
        model: "sonnet",
        chatType: "direct",
      };

      const prompt = buildSystemPrompt(ctx);

      expect(prompt).toContain("## User Profile");
      expect(prompt).toContain("User prefers concise answers");
    });

    it("should include tools section when present", () => {
      const ctx: PromptContext = {
        workspace: {
          tools: "Use memory-search for past conversations",
        },
        channel: "discord",
        timezone: "UTC",
        model: "sonnet",
        chatType: "direct",
      };

      const prompt = buildSystemPrompt(ctx);

      expect(prompt).toContain("## Tool Notes");
      expect(prompt).toContain("Use memory-search for past conversations");
    });

    it("should include memory section when present", () => {
      const ctx: PromptContext = {
        workspace: {
          memory: "User likes DeFi projects",
        },
        channel: "discord",
        timezone: "UTC",
        model: "sonnet",
        chatType: "direct",
      };

      const prompt = buildSystemPrompt(ctx);

      expect(prompt).toContain("## Memory");
      expect(prompt).toContain("User likes DeFi projects");
    });

    it("should NOT include memory section in non-direct chat types", () => {
      const ctx: PromptContext = {
        workspace: {
          memory: "User likes DeFi projects",
        },
        channel: "discord",
        timezone: "UTC",
        model: "sonnet",
        chatType: "group",
      };

      const prompt = buildSystemPrompt(ctx);

      expect(prompt).not.toContain("## Memory");
      expect(prompt).not.toContain("User likes DeFi projects");
    });

    it("should include heartbeat instructions when in heartbeat mode", () => {
      const ctx: PromptContext = {
        workspace: {
          heartbeat: "Check for new emails\nReview calendar",
        },
        channel: "discord",
        timezone: "UTC",
        model: "sonnet",
        chatType: "direct",
        isHeartbeat: true,
      };

      const prompt = buildSystemPrompt(ctx);

      expect(prompt).toContain("## Heartbeat");
      expect(prompt).toContain("Check for new emails");
      expect(prompt).toContain("HEARTBEAT_OK");
    });

    it("should not include heartbeat section when not in heartbeat mode", () => {
      const ctx: PromptContext = {
        workspace: {
          heartbeat: "Check for new emails",
        },
        channel: "discord",
        timezone: "UTC",
        model: "sonnet",
        chatType: "direct",
        isHeartbeat: false,
      };

      const prompt = buildSystemPrompt(ctx);

      expect(prompt).not.toContain("## Heartbeat");
      expect(prompt).not.toContain("HEARTBEAT_OK");
    });

    it("should include all sections when all are present", () => {
      const ctx: PromptContext = {
        workspace: {
          agents: "Rules",
          bootstrap: "Setup",
          soul: "Privacy focused",
          identity: "OwliaBot",
          user: "John Doe",
          tools: "Use memory-search",
          memory: "User likes crypto",
        },
        channel: "discord",
        timezone: "Europe/London",
        model: "claude-opus-4-5",
        chatType: "direct",
      };

      const prompt = buildSystemPrompt(ctx);

      expect(prompt).toContain("## Agent Guidelines");
      expect(prompt).toContain("## Bootstrap");
      expect(prompt).toContain("## Persona & Boundaries");
      expect(prompt).toContain("## Identity");
      expect(prompt).toContain("## User Profile");
      expect(prompt).toContain("## Tool Notes");
      expect(prompt).toContain("## Memory");
      expect(prompt).toContain("Channel: discord");
      expect(prompt).toContain("Model: claude-opus-4-5");
    });

    it("should include ISO timestamp in runtime section", () => {
      const ctx: PromptContext = {
        workspace: {},
        channel: "telegram",
        timezone: "Asia/Tokyo",
        model: "gpt-4o",
        chatType: "direct",
      };

      const prompt = buildSystemPrompt(ctx);

      // Check for ISO format timestamp pattern
      expect(prompt).toMatch(/Time: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
