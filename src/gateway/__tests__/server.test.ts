import { describe, it, expect, vi } from "vitest";
import type { GatewayOptions } from "../server.js";

// Mock all dependencies before importing
vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../channels/telegram/index.js", () => ({
  createTelegramPlugin: vi.fn(),
}));

vi.mock("../../channels/discord/index.js", () => ({
  createDiscordPlugin: vi.fn(),
}));

vi.mock("../../skills/index.js", () => ({
  initializeSkills: vi.fn(async () => {}),
}));

describe("gateway server", () => {
  it("should allow importing GatewayOptions type", () => {
    const options: GatewayOptions = {
      config: {
        workspace: "./workspace",
        channels: {},
        agent: {
          defaultModel: "claude-sonnet-4-5",
          maxTurns: 20,
        },
        security: {},
        gateway: {
          enabled: true,
        },
      },
      workspace: {
        soul: "Bot personality",
      },
      sessionsDir: "./sessions",
    };

    expect(options.sessionsDir).toBe("./sessions");
    expect(options.config.workspace).toBe("./workspace");
  });

  it("should accept config with channels", () => {
    const options: GatewayOptions = {
      config: {
        workspace: "./workspace",
        channels: {
          discord: { token: "test-token" },
          telegram: { token: "test-token" },
        },
        agent: {
          defaultModel: "claude-sonnet-4-5",
          maxTurns: 20,
        },
        security: {},
        gateway: {
          enabled: true,
        },
      },
      workspace: {},
      sessionsDir: "./sessions",
    };

    expect(options.config.channels?.discord).toBeDefined();
    expect(options.config.channels?.telegram).toBeDefined();
  });

  it("should accept workspace files", () => {
    const options: GatewayOptions = {
      config: {
        workspace: "./workspace",
        channels: {},
        agent: {
          defaultModel: "claude-sonnet-4-5",
          maxTurns: 20,
        },
        security: {},
        gateway: {
          enabled: false,
        },
      },
      workspace: {
        soul: "Personality",
        identity: "Name",
        user: "User info",
        heartbeat: "Tasks",
        memory: "Past context",
        tools: "Tool notes",
      },
      sessionsDir: "./sessions",
    };

    expect(options.workspace.soul).toBe("Personality");
    expect(options.workspace.tools).toBe("Tool notes");
  });
});
