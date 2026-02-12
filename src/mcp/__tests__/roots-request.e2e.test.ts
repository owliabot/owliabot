/**
 * MCP client should respond to server-initiated requests (roots/list).
 */

import { describe, it, expect, afterEach } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createMCPClient, MCPClient } from "../client.js";
import type { MCPServerConfig } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_SERVER_PATH = join(__dirname, "mock-mcp-roots.mjs");

const mockServerConfig: MCPServerConfig = {
  name: "mock-roots",
  command: "node",
  args: [MOCK_SERVER_PATH],
  transport: "stdio",
};

describe.sequential("MCP Client: server-initiated requests", () => {
  let client: MCPClient;

  afterEach(async () => {
    if (client?.isConnected()) {
      await client.close();
    }
  });

  it("responds to roots/list so tools/call can complete", async () => {
    client = await createMCPClient(mockServerConfig, {
      timeout: 1000,
      connectTimeout: 1000,
    });

    const result = await client.callTool("echo", { message: "hi" });

    expect(result.isError).toBe(false);
    expect((result.content[0] as { type: "text"; text: string }).text).toBe("ok");
  });
});
