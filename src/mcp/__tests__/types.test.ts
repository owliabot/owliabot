/**
 * MCP types and validation unit tests
 */

import { describe, it, expect } from "vitest";
import {
  mcpServerConfigSchema,
  mcpSecurityOverrideSchema,
  mcpDefaultsSchema,
  mcpConfigSchema,
  MCPError,
  MCPErrorCode,
  MCP_PROTOCOL_VERSION,
} from "../types.js";

describe("mcpServerConfigSchema", () => {
  describe("stdio transport validation", () => {
    it("accepts valid stdio config with command", () => {
      const result = mcpServerConfigSchema.safeParse({
        name: "test-server",
        transport: "stdio",
        command: "/usr/bin/mcp-server",
        args: ["--port", "3000"],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("test-server");
        expect(result.data.command).toBe("/usr/bin/mcp-server");
        expect(result.data.args).toEqual(["--port", "3000"]);
      }
    });

    it("defaults transport to stdio", () => {
      const result = mcpServerConfigSchema.safeParse({
        name: "test-server",
        command: "mcp-server",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.transport).toBe("stdio");
      }
    });

    it("defaults args to empty array", () => {
      const result = mcpServerConfigSchema.safeParse({
        name: "test-server",
        command: "mcp-server",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.args).toEqual([]);
      }
    });

    it("rejects stdio transport without command", () => {
      const result = mcpServerConfigSchema.safeParse({
        name: "test-server",
        transport: "stdio",
        // missing command
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("command");
      }
    });

    it("accepts optional env and cwd", () => {
      const result = mcpServerConfigSchema.safeParse({
        name: "test-server",
        command: "mcp-server",
        env: { API_KEY: "secret", DEBUG: "true" },
        cwd: "/home/user/project",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.env).toEqual({ API_KEY: "secret", DEBUG: "true" });
        expect(result.data.cwd).toBe("/home/user/project");
      }
    });
  });

  describe("sse transport validation", () => {
    it("accepts valid sse config with url", () => {
      const result = mcpServerConfigSchema.safeParse({
        name: "remote-server",
        transport: "sse",
        url: "https://mcp.example.com/events",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.transport).toBe("sse");
        expect(result.data.url).toBe("https://mcp.example.com/events");
      }
    });

    it("rejects sse transport without url", () => {
      const result = mcpServerConfigSchema.safeParse({
        name: "remote-server",
        transport: "sse",
        // missing url
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("url");
      }
    });

    it("rejects invalid url format", () => {
      const result = mcpServerConfigSchema.safeParse({
        name: "remote-server",
        transport: "sse",
        url: "not-a-valid-url",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("name validation", () => {
    it("rejects empty name", () => {
      const result = mcpServerConfigSchema.safeParse({
        name: "",
        command: "mcp-server",
      });

      expect(result.success).toBe(false);
    });

    it("accepts valid server names", () => {
      const validNames = [
        "test-server",
        "my_server",
        "server123",
        "a",
        "MixedCase",
      ];

      for (const name of validNames) {
        const result = mcpServerConfigSchema.safeParse({
          name,
          command: "mcp-server",
        });
        expect(result.success).toBe(true);
      }
    });
  });
});

describe("mcpSecurityOverrideSchema", () => {
  it("accepts valid read level", () => {
    const result = mcpSecurityOverrideSchema.safeParse({
      level: "read",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.level).toBe("read");
    }
  });

  it("accepts valid write level", () => {
    const result = mcpSecurityOverrideSchema.safeParse({
      level: "write",
    });

    expect(result.success).toBe(true);
  });

  it("accepts valid sign level", () => {
    const result = mcpSecurityOverrideSchema.safeParse({
      level: "sign",
      confirmRequired: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.level).toBe("sign");
      expect(result.data.confirmRequired).toBe(true);
    }
  });

  it("rejects invalid security levels", () => {
    const result = mcpSecurityOverrideSchema.safeParse({
      level: "admin",
    });

    expect(result.success).toBe(false);
  });

  it("confirmRequired is optional", () => {
    const result = mcpSecurityOverrideSchema.safeParse({
      level: "write",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confirmRequired).toBeUndefined();
    }
  });
});

describe("mcpDefaultsSchema", () => {
  it("provides default values", () => {
    const result = mcpDefaultsSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeout).toBe(30000);
      expect(result.data.connectTimeout).toBe(10000);
      expect(result.data.restartOnCrash).toBe(true);
      expect(result.data.maxRestarts).toBe(3);
      expect(result.data.restartDelay).toBe(1000);
    }
  });

  it("accepts custom values", () => {
    const result = mcpDefaultsSchema.safeParse({
      timeout: 60000,
      connectTimeout: 20000,
      restartOnCrash: false,
      maxRestarts: 5,
      restartDelay: 2000,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeout).toBe(60000);
      expect(result.data.connectTimeout).toBe(20000);
      expect(result.data.restartOnCrash).toBe(false);
      expect(result.data.maxRestarts).toBe(5);
      expect(result.data.restartDelay).toBe(2000);
    }
  });
});

describe("mcpConfigSchema", () => {
  it("accepts empty config", () => {
    const result = mcpConfigSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.servers).toEqual([]);
    }
  });

  it("accepts full config", () => {
    const result = mcpConfigSchema.safeParse({
      servers: [
        {
          name: "filesystem",
          command: "mcp-filesystem",
          args: ["--root", "/home"],
        },
        {
          name: "browser",
          transport: "sse",
          url: "https://browser.example.com/sse",
        },
      ],
      securityOverrides: {
        "filesystem__write_file": { level: "write", confirmRequired: true },
      },
      defaults: {
        timeout: 45000,
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.servers).toHaveLength(2);
      expect(result.data.securityOverrides).toHaveProperty(
        "filesystem__write_file"
      );
    }
  });

  it("validates nested server configs", () => {
    const result = mcpConfigSchema.safeParse({
      servers: [
        {
          name: "bad-server",
          transport: "stdio",
          // missing command
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe("MCPError", () => {
  it("constructs with message and code", () => {
    const error = new MCPError(
      "Connection failed",
      MCPErrorCode.CONNECTION_FAILED
    );

    expect(error.message).toBe("Connection failed");
    expect(error.code).toBe(MCPErrorCode.CONNECTION_FAILED);
    expect(error.name).toBe("MCPError");
  });

  it("constructs with optional details", () => {
    const details = { host: "localhost", port: 3000 };
    const error = new MCPError(
      "Connection refused",
      MCPErrorCode.CONNECTION_FAILED,
      details
    );

    expect(error.details).toEqual(details);
  });

  it("is instanceof Error", () => {
    const error = new MCPError("Test", MCPErrorCode.TIMEOUT);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(MCPError);
  });

  it("has correct prototype chain", () => {
    const error = new MCPError("Test", MCPErrorCode.PROTOCOL_ERROR);

    // Check prototype chain is set up correctly
    expect(Object.getPrototypeOf(error)).toBe(MCPError.prototype);
  });

  it("supports all error codes", () => {
    const codes = [
      MCPErrorCode.CONNECTION_FAILED,
      MCPErrorCode.CONNECTION_LOST,
      MCPErrorCode.INITIALIZATION_FAILED,
      MCPErrorCode.TIMEOUT,
      MCPErrorCode.INVALID_RESPONSE,
      MCPErrorCode.TOOL_NOT_FOUND,
      MCPErrorCode.TOOL_EXECUTION_FAILED,
      MCPErrorCode.PROTOCOL_ERROR,
      MCPErrorCode.SERVER_SPAWN_FAILED,
    ];

    for (const code of codes) {
      const error = new MCPError(`Error: ${code}`, code);
      expect(error.code).toBe(code);
    }
  });

  it("can be caught as Error", () => {
    try {
      throw new MCPError("Test error", MCPErrorCode.TIMEOUT);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as MCPError).code).toBe(MCPErrorCode.TIMEOUT);
    }
  });

  it("has stack trace", () => {
    const error = new MCPError("Test", MCPErrorCode.PROTOCOL_ERROR);
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("MCPError");
  });
});

describe("MCP Protocol Constants", () => {
  it("exports correct protocol version", () => {
    expect(MCP_PROTOCOL_VERSION).toBe("2024-11-05");
  });
});
