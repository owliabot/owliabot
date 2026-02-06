import { describe, it, expect, vi, beforeEach } from "vitest";
import { configSchema } from "../../config/schema.js";
import { startGateway, type GatewayOptions } from "../server.js";
import { startGatewayHttp } from "../http/server.js";

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

vi.mock("../http/server.js", () => ({
  startGatewayHttp: vi.fn(),
}));

vi.mock("../../agent/tools/builtin/index.js", () => ({
  createBuiltinTools: vi.fn(() => []),
  createHelpTool: vi.fn(() => ({
    name: "help",
    description: "help",
    parameters: { type: "object", properties: {} },
    security: { level: "read" },
    execute: vi.fn(),
  })),
  createExecTool: vi.fn(),
  createWebFetchTool: vi.fn(),
  createWebSearchTool: vi.fn(),
}));

describe("gateway server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("starts gateway HTTP when enabled", async () => {
    const stopHttp = vi.fn(async () => {});
    vi.mocked(startGatewayHttp).mockResolvedValue({
      baseUrl: "http://127.0.0.1:9999",
      stop: stopHttp,
      store: {} as any,
    });

    const config = configSchema.parse({
      providers: [{ id: "test", model: "m", apiKey: "k", priority: 1 }],
      workspace: "/tmp/workspace",
      gateway: { http: { enabled: true } },
      infra: { enabled: false },
      skills: { enabled: false },
      heartbeat: { enabled: false },
      cron: { enabled: false },
    });

    const stopGateway = await startGateway({
      config,
      workspace: {},
      sessionsDir: "/tmp/sessions",
    });

    expect(startGatewayHttp).toHaveBeenCalledTimes(1);
    expect(startGatewayHttp).toHaveBeenCalledWith({
      config: config.gateway!.http!,
      workspacePath: config.workspace,
      system: config.system,
    });

    await stopGateway();
    expect(stopHttp).toHaveBeenCalledTimes(1);
  });

  it("does not start gateway HTTP when disabled", async () => {
    const config = configSchema.parse({
      providers: [{ id: "test", model: "m", apiKey: "k", priority: 1 }],
      workspace: "/tmp/workspace",
      gateway: { http: { enabled: false } },
      infra: { enabled: false },
      skills: { enabled: false },
      heartbeat: { enabled: false },
      cron: { enabled: false },
    });

    const stopGateway = await startGateway({
      config,
      workspace: {},
      sessionsDir: "/tmp/sessions",
    });

    expect(startGatewayHttp).not.toHaveBeenCalled();
    await stopGateway();
  });
});
