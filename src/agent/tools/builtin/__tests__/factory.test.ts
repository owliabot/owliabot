// src/agent/tools/builtin/__tests__/factory.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBuiltinTools } from "../factory.js";
import type { SessionStore } from "../../../session-store.js";
import type { SessionTranscriptStore } from "../../../session-transcript.js";
import * as walletModule from "../../../../wallet/index.js";

// Mock the wallet module for chains() calls
vi.mock("../../../../wallet/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof walletModule>();
  return {
    ...actual,
    getClawletClient: vi.fn(),
  };
});

describe("createBuiltinTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: mock chains() to return empty (no daemon running)
    vi.mocked(walletModule.getClawletClient).mockReturnValue({
      chains: vi.fn().mockResolvedValue([
        { chain_id: 8453, name: "Base" },
        { chain_id: 1, name: "Ethereum Mainnet" },
      ]),
    } as any);
  });
  const mockSessionStore = {
    get: vi.fn(),
    getOrCreate: vi.fn(),
    rotate: vi.fn(),
  } as unknown as SessionStore;

  const mockTranscripts = {
    append: vi.fn(),
    clear: vi.fn(),
    getHistory: vi.fn(),
  } as unknown as SessionTranscriptStore;

  it("returns core tools by default", async () => {
    const tools = await createBuiltinTools({
      workspace: "/tmp/workspace",
      sessionStore: mockSessionStore,
      transcripts: mockTranscripts,
    });

    const names = tools.map((t) => t.name);
    expect(names).toContain("echo");
    expect(names).toContain("clear_session");
    expect(names).toContain("memory_search");
    expect(names).toContain("memory_get");
    expect(names).toContain("list_files");
    expect(names).toContain("read_text_file");
    expect(names).not.toContain("read_file");
    // Write tools should be excluded by default
    expect(names).not.toContain("edit_file");
  });

  it("excludes write tools when allowWrite is false", async () => {
    const tools = await createBuiltinTools({
      workspace: "/tmp/workspace",
      sessionStore: mockSessionStore,
      transcripts: mockTranscripts,
      tools: { allowWrite: false },
    });

    const names = tools.map((t) => t.name);
    expect(names).not.toContain("edit_file");
  });

  it("includes write tools when allowWrite is true", async () => {
    const tools = await createBuiltinTools({
      workspace: "/tmp/workspace",
      sessionStore: mockSessionStore,
      transcripts: mockTranscripts,
      tools: { allowWrite: true },
    });

    const names = tools.map((t) => t.name);
    expect(names).toContain("edit_file");
    expect(names).toContain("write_file");
    expect(names).toContain("apply_patch");
    expect(names).toContain("delete_file");
  });

  it("does not include help or cron tools (registered separately)", async () => {
    const tools = await createBuiltinTools({
      workspace: "/tmp/workspace",
      sessionStore: mockSessionStore,
      transcripts: mockTranscripts,
      tools: { allowWrite: true },
    });

    const names = tools.map((t) => t.name);
    expect(names).not.toContain("help");
    expect(names).not.toContain("cron");
  });

  it("returns valid tool definitions", async () => {
    const tools = await createBuiltinTools({
      workspace: "/tmp/workspace",
      sessionStore: mockSessionStore,
      transcripts: mockTranscripts,
    });

    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  describe("policy filtering", () => {
    it("filters tools with allowList policy", async () => {
      const tools = await createBuiltinTools({
        workspace: "/tmp/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        tools: {
          allowWrite: true,
          policy: { allowList: ["echo", "memory_search"] },
        },
      });

      const names = tools.map((t) => t.name);
      expect(names).toEqual(["echo", "memory_search"]);
    });

    it("filters tools with denyList policy", async () => {
      const tools = await createBuiltinTools({
        workspace: "/tmp/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        tools: {
          allowWrite: true,
          policy: { denyList: ["edit_file", "clear_session"] },
        },
      });

      const names = tools.map((t) => t.name);
      expect(names).not.toContain("edit_file");
      expect(names).not.toContain("clear_session");
      expect(names).toContain("echo");
      expect(names).toContain("memory_search");
    });

    it("allowList takes precedence over denyList", async () => {
      const tools = await createBuiltinTools({
        workspace: "/tmp/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        tools: {
          allowWrite: true,
          policy: {
            allowList: ["echo", "edit_file"],
            denyList: ["edit_file"], // Should be ignored
          },
        },
      });

      const names = tools.map((t) => t.name);
      expect(names).toEqual(["echo", "edit_file"]);
    });

    it("returns all tools when policy is undefined", async () => {
      const toolsWithPolicy = await createBuiltinTools({
        workspace: "/tmp/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        tools: { allowWrite: true, policy: undefined },
      });

      const toolsWithoutPolicy = await createBuiltinTools({
        workspace: "/tmp/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        tools: { allowWrite: true },
      });

      expect(toolsWithPolicy.map((t) => t.name)).toEqual(
        toolsWithoutPolicy.map((t) => t.name),
      );
    });

    it("policy filtering applies after allowWrite filtering", async () => {
      // With allowWrite: false, edit_file is never created
      // So even if policy allows it, it won't be in the result
      const tools = await createBuiltinTools({
        workspace: "/tmp/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        tools: {
          allowWrite: false, // edit_file not created
          policy: { allowList: ["echo", "edit_file"] }, // edit_file allowed but doesn't exist
        },
      });

      const names = tools.map((t) => t.name);
      expect(names).toEqual(["echo"]);
      expect(names).not.toContain("edit_file");
    });
  });

  describe("wallet tools", () => {
    it("excludes wallet tools when wallet is not configured", async () => {
      const tools = await createBuiltinTools({
        workspace: "/tmp/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
      });

      const names = tools.map((t) => t.name);
      expect(names).not.toContain("wallet_balance");
      expect(names).not.toContain("wallet_transfer");
    });

    it("excludes wallet tools when wallet.clawlet.enabled is false", async () => {
      const tools = await createBuiltinTools({
        workspace: "/tmp/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        wallet: {
          clawlet: {
            enabled: false,
          },
        },
      });

      const names = tools.map((t) => t.name);
      expect(names).not.toContain("wallet_balance");
      expect(names).not.toContain("wallet_transfer");
    });

    it("excludes wallet tools when clawlet config is missing", async () => {
      const tools = await createBuiltinTools({
        workspace: "/tmp/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        wallet: {},
      });

      const names = tools.map((t) => t.name);
      expect(names).not.toContain("wallet_balance");
      expect(names).not.toContain("wallet_transfer");
    });

    it("includes wallet tools when wallet.clawlet.enabled is true", async () => {
      const tools = await createBuiltinTools({
        workspace: "/tmp/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        wallet: {
          clawlet: {
            enabled: true,
          },
        },
      });

      const names = tools.map((t) => t.name);
      expect(names).toContain("wallet_balance");
      expect(names).toContain("wallet_transfer");
    });

    it("includes wallet tools with custom clawlet config", async () => {
      const tools = await createBuiltinTools({
        workspace: "/tmp/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        wallet: {
          clawlet: {
            enabled: true,
            baseUrl: "http://192.168.1.100:9100",
            token: "test-token",
            connectTimeout: 10000,
            requestTimeout: 60000,
            defaultChainId: 1, // Ethereum mainnet
          },
        },
      });

      const names = tools.map((t) => t.name);
      expect(names).toContain("wallet_balance");
      expect(names).toContain("wallet_transfer");
    });

    it("wallet tools are valid tool definitions", async () => {
      const tools = await createBuiltinTools({
        workspace: "/tmp/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        wallet: {
          clawlet: {
            enabled: true,
          },
        },
      });

      const walletTools = tools.filter((t) =>
        ["wallet_balance", "wallet_transfer"].includes(t.name)
      );

      expect(walletTools).toHaveLength(2);
      for (const tool of walletTools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.execute).toBe("function");
      }
    });

    it("wallet tools can be filtered by policy", async () => {
      const tools = await createBuiltinTools({
        workspace: "/tmp/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        wallet: {
          clawlet: {
            enabled: true,
          },
        },
        tools: {
          policy: { allowList: ["echo", "wallet_balance"] },
        },
      });

      const names = tools.map((t) => t.name);
      expect(names).toContain("echo");
      expect(names).toContain("wallet_balance");
      expect(names).not.toContain("wallet_transfer");
    });

    it("wallet tools can be denied by policy", async () => {
      const tools = await createBuiltinTools({
        workspace: "/tmp/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        wallet: {
          clawlet: {
            enabled: true,
          },
        },
        tools: {
          policy: { denyList: ["wallet_transfer"] },
        },
      });

      const names = tools.map((t) => t.name);
      expect(names).toContain("wallet_balance");
      expect(names).not.toContain("wallet_transfer");
    });
  });
});
