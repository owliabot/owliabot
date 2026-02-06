import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolRegistry } from "../registry.js";
import type { ToolDefinition } from "../interface.js";

vi.mock("../../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  const mockTool: ToolDefinition = {
    name: "test-tool",
    description: "A test tool",
    parameters: {
      type: "object",
      properties: {
        param1: { type: "string", description: "Test param" },
      },
      required: ["param1"],
    },
    security: {
      level: "read",
    },
    execute: vi.fn(async () => ({ success: true, data: { result: "test" } })),
  };

  const writeTool: ToolDefinition = {
    name: "write-tool",
    description: "A write tool",
    parameters: {
      type: "object",
      properties: {},
    },
    security: {
      level: "write",
    },
    execute: vi.fn(async () => ({ success: true })),
  };

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe("register", () => {
    it("should register a tool", () => {
      registry.register(mockTool);
      const tool = registry.get("test-tool");
      expect(tool).toBe(mockTool);
    });

    it("should overwrite existing tool with same name", () => {
      registry.register(mockTool);
      const newTool = { ...mockTool, description: "Updated description" };
      registry.register(newTool);
      
      const tool = registry.get("test-tool");
      expect(tool?.description).toBe("Updated description");
    });
  });

  describe("get", () => {
    it("should return tool by name", () => {
      registry.register(mockTool);
      const tool = registry.get("test-tool");
      expect(tool).toBe(mockTool);
    });

    it("should return undefined for non-existent tool", () => {
      const tool = registry.get("non-existent");
      expect(tool).toBeUndefined();
    });

    it("should resolve read_file alias to read_text_file", () => {
      const readTextFileTool: ToolDefinition = {
        name: "read_text_file",
        description: "Read text file",
        parameters: { type: "object", properties: {} },
        security: { level: "read" },
        execute: vi.fn(async () => ({ success: true })),
      };
      registry.register(readTextFileTool);

      expect(registry.get("read_file")).toBe(readTextFileTool);
    });
  });

  describe("getAll", () => {
    it("should return all registered tools", () => {
      registry.register(mockTool);
      registry.register(writeTool);
      
      const tools = registry.getAll();
      expect(tools).toHaveLength(2);
      expect(tools).toContain(mockTool);
      expect(tools).toContain(writeTool);
    });

    it("should return empty array when no tools registered", () => {
      const tools = registry.getAll();
      expect(tools).toEqual([]);
    });
  });

  describe("getReadOnly", () => {
    it("should return only read-level tools", () => {
      registry.register(mockTool);
      registry.register(writeTool);
      
      const readTools = registry.getReadOnly();
      expect(readTools).toHaveLength(1);
      expect(readTools[0]).toBe(mockTool);
    });

    it("should return empty array when no read tools", () => {
      registry.register(writeTool);
      
      const readTools = registry.getReadOnly();
      expect(readTools).toEqual([]);
    });
  });

  describe("toAnthropicFormat", () => {
    it("should convert tools to Anthropic format", () => {
      registry.register(mockTool);
      registry.register(writeTool);
      
      const anthropicTools = registry.toAnthropicFormat();
      
      expect(anthropicTools).toHaveLength(2);
      expect(anthropicTools[0]).toEqual({
        name: "test-tool",
        description: "A test tool",
        input_schema: mockTool.parameters,
      });
    });

    it("should return empty array when no tools", () => {
      const anthropicTools = registry.toAnthropicFormat();
      expect(anthropicTools).toEqual([]);
    });
  });
});
