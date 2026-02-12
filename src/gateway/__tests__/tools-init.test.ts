// src/gateway/__tests__/tools-init.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { initializeTools, registerAdditionalTools } from "../tools-init.js";
import { ToolRegistry } from "../../agent/tools/registry.js";

// Mock logger
vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock tool factories
const mockReadTool = {
  name: "read",
  description: "Read file",
  parameters: { type: "object", properties: {} },
  security: { level: "read" },
  execute: vi.fn(),
};

const mockWriteTool = {
  name: "write",
  description: "Write file",
  parameters: { type: "object", properties: {} },
  security: { level: "write" },
  execute: vi.fn(),
};

const mockHelpTool = {
  name: "help",
  description: "Get help",
  parameters: { type: "object", properties: {} },
  security: { level: "read" },
  execute: vi.fn(),
};

const mockExecTool = {
  name: "exec",
  description: "Execute command",
  parameters: { type: "object", properties: {} },
  security: { level: "write" },
  execute: vi.fn(),
};

const mockWebFetchTool = {
  name: "web_fetch",
  description: "Fetch URL",
  parameters: { type: "object", properties: {} },
  security: { level: "read" },
  execute: vi.fn(),
};

const mockWebSearchTool = {
  name: "web_search",
  description: "Search web",
  parameters: { type: "object", properties: {} },
  security: { level: "read" },
  execute: vi.fn(),
};

vi.mock("../../agent/tools/builtin/index.js", () => ({
  createBuiltinTools: vi.fn(async () => [mockReadTool, mockWriteTool]),
  createHelpTool: vi.fn(() => mockHelpTool),
  createExecTool: vi.fn(() => mockExecTool),
  createWebFetchTool: vi.fn(() => mockWebFetchTool),
  createWebSearchTool: vi.fn(() => mockWebSearchTool),
}));

// Mock session/transcript stores
const mockSessionStore = {} as any;
const mockTranscripts = {} as any;

describe("tools-init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initializeTools", () => {
    it("registers builtin tools", async () => {
      const tools = await initializeTools({
        workspace: "/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
      });

      expect(tools.get("read")).toBe(mockReadTool);
      expect(tools.get("write")).toBe(mockWriteTool);
    });

    it("registers help tool last", async () => {
      const tools = await initializeTools({
        workspace: "/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
      });

      expect(tools.get("help")).toBe(mockHelpTool);
    });

    it("registers exec tool when system.exec is configured", async () => {
      const { createExecTool } = await import("../../agent/tools/builtin/index.js");
      
      const tools = await initializeTools({
        workspace: "/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        systemConfig: {
          exec: { enabled: true },
        },
      });

      expect(createExecTool).toHaveBeenCalledWith({
        workspacePath: "/workspace",
        config: { enabled: true },
      });
      expect(tools.get("exec")).toBe(mockExecTool);
    });

    it("does not register exec tool when system.exec is missing", async () => {
      const { createExecTool } = await import("../../agent/tools/builtin/index.js");
      
      await initializeTools({
        workspace: "/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        systemConfig: undefined,
      });

      expect(createExecTool).not.toHaveBeenCalled();
    });

    it("registers web_fetch tool when system.web is configured", async () => {
      const { createWebFetchTool } = await import("../../agent/tools/builtin/index.js");
      
      const tools = await initializeTools({
        workspace: "/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        systemConfig: {
          web: { enabled: true },
        },
      });

      expect(createWebFetchTool).toHaveBeenCalledWith({
        config: { enabled: true },
      });
      expect(tools.get("web_fetch")).toBe(mockWebFetchTool);
    });

    it("registers web_search tool only when system.webSearch is configured", async () => {
      const { createWebSearchTool } = await import("../../agent/tools/builtin/index.js");
      
      // Only web config - should NOT register web_search
      await initializeTools({
        workspace: "/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        systemConfig: {
          web: { enabled: true },
        },
      });
      expect(createWebSearchTool).not.toHaveBeenCalled();

      vi.clearAllMocks();

      // Both web and webSearch config - should register
      const tools = await initializeTools({
        workspace: "/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        systemConfig: {
          web: { enabled: true },
          webSearch: { apiKey: "test-key" },
        },
      });

      expect(createWebSearchTool).toHaveBeenCalledWith({
        config: {
          web: { enabled: true },
          webSearch: { apiKey: "test-key" },
        },
      });
      expect(tools.get("web_search")).toBe(mockWebSearchTool);
    });

    it("passes toolsConfig to createBuiltinTools", async () => {
      const { createBuiltinTools } = await import("../../agent/tools/builtin/index.js");
      
      await initializeTools({
        workspace: "/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        toolsConfig: { someOption: true } as any,
      });

      expect(createBuiltinTools).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: { someOption: true },
        })
      );
    });

    it("passes walletConfig to createBuiltinTools", async () => {
      const { createBuiltinTools } = await import("../../agent/tools/builtin/index.js");
      
      await initializeTools({
        workspace: "/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        walletConfig: { address: "0x123" } as any,
      });

      expect(createBuiltinTools).toHaveBeenCalledWith(
        expect.objectContaining({
          wallet: { address: "0x123" },
        })
      );
    });

    it("returns registry with correct tool count", async () => {
      const tools = await initializeTools({
        workspace: "/workspace",
        sessionStore: mockSessionStore,
        transcripts: mockTranscripts,
        systemConfig: {
          exec: { enabled: true },
          web: { enabled: true },
          webSearch: { apiKey: "key" },
        },
      });

      // 2 builtin + 1 help + 3 system tools = 6
      expect(tools.getAll().length).toBe(6);
    });
  });

  describe("registerAdditionalTools", () => {
    it("adds tools to existing registry", () => {
      const registry = new ToolRegistry();
      
      const customTool = {
        name: "custom",
        description: "Custom tool",
        parameters: { type: "object", properties: {} },
        security: { level: "read" },
        execute: vi.fn(),
      };

      registerAdditionalTools(registry, [customTool as any]);

      expect(registry.get("custom")).toBe(customTool);
    });

    it("handles empty tool array", () => {
      const registry = new ToolRegistry();
      
      expect(() => registerAdditionalTools(registry, [])).not.toThrow();
    });

    it("registers multiple tools", () => {
      const registry = new ToolRegistry();
      
      const tool1 = { name: "tool1", description: "T1", parameters: {}, security: { level: "read" }, execute: vi.fn() };
      const tool2 = { name: "tool2", description: "T2", parameters: {}, security: { level: "read" }, execute: vi.fn() };

      registerAdditionalTools(registry, [tool1 as any, tool2 as any]);

      expect(registry.get("tool1")).toBe(tool1);
      expect(registry.get("tool2")).toBe(tool2);
    });
  });
});
