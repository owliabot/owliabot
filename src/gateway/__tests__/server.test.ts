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

vi.mock("../../mcp/manager.js", () => ({
  createMCPManager: vi.fn(),
  MCPManager: class {},
}));

vi.mock("../../mcp/index.js", () => ({
  createMCPTools: vi.fn(),
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
      channel: { id: "http", capabilities: {}, start: vi.fn(), stop: vi.fn(), onMessage: vi.fn(), send: vi.fn() } as any,
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
    // Phase 1 Unification: now injects shared toolRegistry/sessionStore/transcripts
    expect(startGatewayHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        config: config.gateway!.http!,
        workspacePath: config.workspace,
        system: config.system,
        // These are now injected from main gateway (Phase 1 unification)
        toolRegistry: expect.anything(),
        sessionStore: expect.anything(),
        transcripts: expect.anything(),
      })
    );

    await stopGateway();
    expect(stopHttp).toHaveBeenCalledTimes(1);
  });

  it("starts normally when providers have no valid API keys (graceful degradation)", async () => {
    const stopHttp = vi.fn(async () => {});
    vi.mocked(startGatewayHttp).mockResolvedValue({
      baseUrl: "http://127.0.0.1:9999",
      stop: stopHttp,
      store: {} as any,
      channel: { id: "http", capabilities: {}, start: vi.fn(), stop: vi.fn(), onMessage: vi.fn(), send: vi.fn() } as any,
    });

    // Provider with apiKey "oauth" (unresolved) — should NOT crash
    const config = configSchema.parse({
      providers: [{ id: "anthropic", model: "claude-sonnet-4-5", apiKey: "oauth", priority: 1 }],
      workspace: "/tmp/workspace",
      gateway: { http: { enabled: true } },
      infra: { enabled: false },
      skills: { enabled: false },
      heartbeat: { enabled: false },
      cron: { enabled: false },
    });

    // Should not throw — gateway starts in degraded mode
    const stopGateway = await startGateway({
      config,
      workspace: {},
      sessionsDir: "/tmp/sessions",
    });

    expect(startGatewayHttp).toHaveBeenCalledTimes(1);
    await stopGateway();
  });

  it("starts normally when provider apiKey is undefined (graceful degradation)", async () => {
    // Provider with no apiKey at all — should NOT crash
    const config = configSchema.parse({
      providers: [{ id: "anthropic", model: "claude-sonnet-4-5", priority: 1 }],
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

    // Gateway started without crashing
    await stopGateway();
  });

  it("does not initialize MCP twice when servers are configured", async () => {
    const { createMCPManager } = await import("../../mcp/manager.js");
    const { createMCPTools } = await import("../../mcp/index.js");

    const addServer = vi.fn(async () => ["playwright__browser_navigate"]);
    const getToolsAsync = vi.fn(async () => []);
    const onToolsChanged = vi.fn();
    const close = vi.fn(async () => {});
    vi.mocked(createMCPManager).mockReturnValue({
      addServer,
      getToolsAsync,
      onToolsChanged,
      close,
      serverCount: 1,
    } as any);

    vi.mocked(createMCPTools).mockResolvedValue({
      tools: [],
      clients: new Map(),
      adapters: new Map(),
      failed: [],
      refreshTools: async () => [],
      close: async () => {},
    });

    const config = configSchema.parse({
      providers: [{ id: "test", model: "m", apiKey: "k", priority: 1 }],
      workspace: "/tmp/workspace",
      gateway: { http: { enabled: false } },
      infra: { enabled: false },
      skills: { enabled: false },
      heartbeat: { enabled: false },
      cron: { enabled: false },
      mcp: {
        servers: [
          { name: "playwright", command: "npx", args: ["@playwright/mcp@latest"], transport: "stdio" },
        ],
        presets: [],
        autoStart: true,
      },
    });

    const stopGateway = await startGateway({
      config,
      workspace: {},
      sessionsDir: "/tmp/sessions",
    });

    expect(createMCPManager).toHaveBeenCalledTimes(1);
    expect(addServer).toHaveBeenCalledTimes(1);
    expect(createMCPTools).not.toHaveBeenCalled();

    await stopGateway();
  });

  it("injects system chromium env for explicit playwright server when OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH is set", async () => {
    const previous = process.env.OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH;
    const previousNoSandbox = process.env.PLAYWRIGHT_MCP_NO_SANDBOX;
    process.env.OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH = "/usr/bin/chromium";
    process.env.PLAYWRIGHT_MCP_NO_SANDBOX = "1";

    try {
      const { createMCPManager } = await import("../../mcp/manager.js");

      const addServer = vi.fn(async () => ["playwright__browser_navigate"]);
      const getToolsAsync = vi.fn(async () => []);
      const onToolsChanged = vi.fn();
      const close = vi.fn(async () => {});
      vi.mocked(createMCPManager).mockReturnValue({
        addServer,
        getToolsAsync,
        onToolsChanged,
        close,
        serverCount: 1,
      } as any);

      const config = configSchema.parse({
        providers: [{ id: "test", model: "m", apiKey: "k", priority: 1 }],
        workspace: "/tmp/workspace",
        gateway: { http: { enabled: false } },
        infra: { enabled: false },
        skills: { enabled: false },
        heartbeat: { enabled: false },
        cron: { enabled: false },
        mcp: {
          servers: [
            {
              name: "playwright",
              command: "npx",
              args: ["--yes", "@playwright/mcp@latest"],
              transport: "stdio",
              env: {},
            },
          ],
          presets: [],
          autoStart: true,
        },
      });

      const stopGateway = await startGateway({
        config,
        workspace: {},
        sessionsDir: "/tmp/sessions",
      });

      expect(addServer).toHaveBeenCalledTimes(1);
      expect(addServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "playwright",
          args: expect.arrayContaining([
            "--browser",
            "chrome",
            "--executable-path",
            "/usr/bin/chromium",
            "--no-sandbox",
          ]),
          env: expect.objectContaining({
            PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "/usr/bin/chromium",
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
          }),
        })
      );

      await stopGateway();
    } finally {
      if (previous === undefined) {
        delete process.env.OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH;
      } else {
        process.env.OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH = previous;
      }
      if (previousNoSandbox === undefined) {
        delete process.env.PLAYWRIGHT_MCP_NO_SANDBOX;
      } else {
        process.env.PLAYWRIGHT_MCP_NO_SANDBOX = previousNoSandbox;
      }
    }
  });

  it("adds --no-sandbox for explicit playwright server even without chromium path", async () => {
    const previous = process.env.OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH;
    const previousNoSandbox = process.env.PLAYWRIGHT_MCP_NO_SANDBOX;
    delete process.env.OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH;
    process.env.PLAYWRIGHT_MCP_NO_SANDBOX = "1";

    try {
      const { createMCPManager } = await import("../../mcp/manager.js");

      const addServer = vi.fn(async () => ["playwright__browser_navigate"]);
      const getToolsAsync = vi.fn(async () => []);
      const onToolsChanged = vi.fn();
      const close = vi.fn(async () => {});
      vi.mocked(createMCPManager).mockReturnValue({
        addServer,
        getToolsAsync,
        onToolsChanged,
        close,
        serverCount: 1,
      } as any);

      const config = configSchema.parse({
        providers: [{ id: "test", model: "m", apiKey: "k", priority: 1 }],
        workspace: "/tmp/workspace",
        gateway: { http: { enabled: false } },
        infra: { enabled: false },
        skills: { enabled: false },
        heartbeat: { enabled: false },
        cron: { enabled: false },
        mcp: {
          servers: [
            {
              name: "playwright",
              command: "npx",
              args: ["--yes", "@playwright/mcp@latest"],
              transport: "stdio",
              env: {},
            },
          ],
          presets: [],
          autoStart: true,
        },
      });

      const stopGateway = await startGateway({
        config,
        workspace: {},
        sessionsDir: "/tmp/sessions",
      });

      expect(addServer).toHaveBeenCalledTimes(1);
      expect(addServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "playwright",
          args: expect.arrayContaining(["--no-sandbox"]),
          env: expect.objectContaining({
            PLAYWRIGHT_MCP_NO_SANDBOX: "1",
          }),
        })
      );

      await stopGateway();
    } finally {
      if (previous === undefined) {
        delete process.env.OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH;
      } else {
        process.env.OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH = previous;
      }
      if (previousNoSandbox === undefined) {
        delete process.env.PLAYWRIGHT_MCP_NO_SANDBOX;
      } else {
        process.env.PLAYWRIGHT_MCP_NO_SANDBOX = previousNoSandbox;
      }
    }
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
