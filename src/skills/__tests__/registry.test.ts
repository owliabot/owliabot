// src/skills/__tests__/registry.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { skillToToolDefinitions } from "../registry.js";
import type { LoadedSkill } from "../types.js";

describe("skillToToolDefinitions", () => {
  it("should convert skill to tool definitions with namespace", () => {
    const skill: LoadedSkill = {
      manifest: {
        name: "crypto-price",
        version: "0.1.0",
        main: "index.js",
        owliabot: {
          tools: [
            {
              name: "get_price",
              description: "Get crypto price",
              parameters: {
                type: "object",
                properties: {
                  coin: { type: "string", description: "Coin ID" },
                },
                required: ["coin"],
              },
              security: { level: "read" },
            },
          ],
        },
      },
      module: {
        tools: {
          get_price: async (params) => ({
            success: true,
            data: { price: 100 },
          }),
        },
      },
      path: "/skills/crypto-price",
    };

    const tools = skillToToolDefinitions(skill);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("crypto-price:get_price");
    expect(tools[0].description).toBe("Get crypto price");
    expect(tools[0].security.level).toBe("read");
  });

  it("should filter tools not defined in manifest", () => {
    const skill: LoadedSkill = {
      manifest: {
        name: "test-skill",
        version: "0.1.0",
        main: "index.js",
        owliabot: {
          tools: [
            {
              name: "declared_tool",
              description: "Declared in manifest",
              parameters: { type: "object", properties: {} },
              security: { level: "read" },
            },
          ],
        },
      },
      module: {
        tools: {
          declared_tool: async () => ({ success: true }),
          undeclared_tool: async () => ({ success: true }), // Not in manifest
        },
      },
      path: "/skills/test-skill",
    };

    const tools = skillToToolDefinitions(skill);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("test-skill:declared_tool");
  });

  it("should warn when tool declared in manifest but not exported", () => {
    const skill: LoadedSkill = {
      manifest: {
        name: "missing-tool-skill",
        version: "0.1.0",
        main: "index.js",
        owliabot: {
          tools: [
            {
              name: "missing_tool",
              description: "Not exported",
              parameters: { type: "object", properties: {} },
              security: { level: "read" },
            },
          ],
        },
      },
      module: {
        tools: {}, // No tools exported
      },
      path: "/skills/missing-tool-skill",
    };

    const tools = skillToToolDefinitions(skill);

    expect(tools).toHaveLength(0);
  });

  it("should execute tool with correct context", async () => {
    const mockToolFn = vi.fn().mockResolvedValue({ success: true, data: "result" });

    const skill: LoadedSkill = {
      manifest: {
        name: "context-test",
        version: "0.1.0",
        main: "index.js",
        owliabot: {
          requires: {
            env: ["API_KEY"],
          },
          tools: [
            {
              name: "test_tool",
              description: "Test tool",
              parameters: { type: "object", properties: {} },
              security: { level: "read" },
            },
          ],
        },
      },
      module: {
        tools: {
          test_tool: mockToolFn,
        },
      },
      path: "/skills/context-test",
    };

    const tools = skillToToolDefinitions(skill);
    const result = await tools[0].execute(
      { param: "value" },
      {
        sessionKey: "telegram:user123",
        agentId: "agent-1",
        signer: null,
        config: {},
      }
    );

    expect(mockToolFn).toHaveBeenCalledTimes(1);
    expect(mockToolFn.mock.calls[0][0]).toEqual({ param: "value" });
    // Check that context was passed with correct meta
    const passedContext = mockToolFn.mock.calls[0][1];
    expect(passedContext.meta.skillName).toBe("context-test");
    expect(passedContext.meta.toolName).toBe("test_tool");
    expect(passedContext.meta.channel).toBe("telegram");
    expect(result).toEqual({ success: true, data: "result" });
  });

  it("should auto-wrap simple returns in ToolResult format", async () => {
    const skill: LoadedSkill = {
      manifest: {
        name: "auto-wrap",
        version: "0.1.0",
        main: "index.js",
        owliabot: {
          tools: [
            {
              name: "simple_return",
              description: "Returns plain object",
              parameters: { type: "object", properties: {} },
              security: { level: "read" },
            },
          ],
        },
      },
      module: {
        tools: {
          // Returns plain object without 'success' field
          simple_return: async () => ({ price: 100, symbol: "ETH" }),
        },
      },
      path: "/skills/auto-wrap",
    };

    const tools = skillToToolDefinitions(skill);
    const result = await tools[0].execute(
      {},
      {
        sessionKey: "discord:user456",
        agentId: "agent-1",
        signer: null,
        config: {},
      }
    );

    expect(result).toEqual({
      success: true,
      data: { price: 100, symbol: "ETH" },
    });
  });

  it("should handle tool execution errors", async () => {
    const skill: LoadedSkill = {
      manifest: {
        name: "error-skill",
        version: "0.1.0",
        main: "index.js",
        owliabot: {
          tools: [
            {
              name: "failing_tool",
              description: "Always fails",
              parameters: { type: "object", properties: {} },
              security: { level: "read" },
            },
          ],
        },
      },
      module: {
        tools: {
          failing_tool: async () => {
            throw new Error("Network error");
          },
        },
      },
      path: "/skills/error-skill",
    };

    const tools = skillToToolDefinitions(skill);
    const result = await tools[0].execute(
      {},
      {
        sessionKey: "telegram:user789",
        agentId: "agent-1",
        signer: null,
        config: {},
      }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network error");
  });

  it("should timeout long-running tools", async () => {
    const skill: LoadedSkill = {
      manifest: {
        name: "timeout-skill",
        version: "0.1.0",
        main: "index.js",
        owliabot: {
          tools: [
            {
              name: "slow_tool",
              description: "Takes too long",
              parameters: { type: "object", properties: {} },
              security: { level: "read" },
              timeout: 100, // 100ms timeout for test
            },
          ],
        },
      },
      module: {
        tools: {
          slow_tool: async () => {
            await new Promise((resolve) => setTimeout(resolve, 500)); // 500ms delay
            return { success: true };
          },
        },
      },
      path: "/skills/timeout-skill",
    };

    const tools = skillToToolDefinitions(skill);
    const result = await tools[0].execute(
      {},
      {
        sessionKey: "telegram:user000",
        agentId: "agent-1",
        signer: null,
        config: {},
      }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("timeout");
  });

  it("should include parameters in tool definition", () => {
    const skill: LoadedSkill = {
      manifest: {
        name: "params-skill",
        version: "0.1.0",
        main: "index.js",
        owliabot: {
          tools: [
            {
              name: "param_tool",
              description: "Has parameters",
              parameters: {
                type: "object",
                properties: {
                  amount: { type: "number", description: "Amount" },
                  token: { type: "string", description: "Token symbol" },
                },
                required: ["amount"],
              },
              security: { level: "write" },
            },
          ],
        },
      },
      module: {
        tools: {
          param_tool: async () => ({ success: true }),
        },
      },
      path: "/skills/params-skill",
    };

    const tools = skillToToolDefinitions(skill);

    expect(tools[0].parameters).toEqual({
      type: "object",
      properties: {
        amount: { type: "number", description: "Amount" },
        token: { type: "string", description: "Token symbol" },
      },
      required: ["amount"],
    });
    expect(tools[0].security.level).toBe("write");
  });
});
