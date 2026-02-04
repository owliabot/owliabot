import { describe, it, expect } from "vitest";
import type {
  ToolDefinition,
  ToolSecurity,
  ToolContext,
  ToolConfig,
  ToolResult,
  ConfirmationRequest,
  ToolCall,
  JsonSchema,
  JsonSchemaProperty,
} from "../interface.js";

describe("interface", () => {
  it("should allow importing ToolDefinition type", () => {
    const tool: ToolDefinition = {
      name: "test",
      description: "Test tool",
      parameters: {
        type: "object",
        properties: {},
      },
      security: {
        level: "read",
      },
      execute: async () => ({ success: true }),
    };

    expect(tool.name).toBe("test");
  });

  it("should allow importing ToolSecurity type", () => {
    const security: ToolSecurity = {
      level: "write",
      confirmRequired: true,
      maxValue: 1000n,
    };

    expect(security.level).toBe("write");
    expect(security.confirmRequired).toBe(true);
  });

  it("should allow importing ToolContext type", () => {
    const context: ToolContext = {
      sessionKey: "test:session",
      agentId: "agent-1",
      signer: null,
      config: {},
    };

    expect(context.sessionKey).toBe("test:session");
  });

  it("should allow importing ToolResult type", () => {
    const result: ToolResult = {
      success: true,
      data: { message: "Success" },
    };

    expect(result.success).toBe(true);
  });

  it("should allow importing ConfirmationRequest type", () => {
    const request: ConfirmationRequest = {
      type: "transaction",
      title: "Approve Transaction",
      description: "Send 1 ETH",
      transaction: {
        to: "0x1234",
        value: 1000000000000000000n,
        data: "0x",
        chainId: 1,
      },
    };

    expect(request.type).toBe("transaction");
  });

  it("should allow importing ToolCall type", () => {
    const call: ToolCall = {
      id: "call_123",
      name: "echo",
      arguments: { message: "hello" },
    };

    expect(call.id).toBe("call_123");
  });

  it("should allow importing JsonSchema type", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "User name",
        },
      },
      required: ["name"],
    };

    expect(schema.type).toBe("object");
  });

  it("should allow importing JsonSchemaProperty type", () => {
    const property: JsonSchemaProperty = {
      type: "string",
      description: "A string property",
      enum: ["option1", "option2"],
    };

    expect(property.type).toBe("string");
  });
});
