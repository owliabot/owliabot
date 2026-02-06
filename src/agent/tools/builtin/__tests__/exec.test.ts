import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExecTool } from "../exec.js";
import type { ToolContext } from "../../interface.js";

describe("builtin/exec tool", () => {
  const mockContext: ToolContext = {
    sessionKey: "test-session",
    agentId: "test-agent",
    config: {},
  };

  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await mkdtemp(join(tmpdir(), "exec-tool-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const getDeps = () => ({
    workspacePath: tempDir,
    config: {
      commandAllowList: ["echo", "ls", "cat"],
      envAllowList: [],
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    },
  });

  it("has correct metadata", () => {
    const tool = createExecTool(getDeps());
    expect(tool.name).toBe("exec");
    expect(tool.security.level).toBe("write");
    expect(tool.security.confirmRequired).toBe(true);
    expect(tool.parameters.required).toContain("command");
  });

  it("rejects commands not in allowlist", async () => {
    const tool = createExecTool(getDeps());
    const result = await tool.execute({ command: "rm", params: ["-rf", "/"] }, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not allowed/i);
  });

  it("executes allowed command successfully", async () => {
    const tool = createExecTool(getDeps());
    const result = await tool.execute({ command: "echo", params: ["hello"] }, mockContext);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining("hello"),
    });
  });

  it("times out long-running commands", async () => {
    const deps = getDeps();
    deps.config.commandAllowList.push("sleep");
    deps.config.timeoutMs = 100; // 100ms timeout

    const tool = createExecTool(deps);
    const result = await tool.execute({ command: "sleep", params: ["10"] }, mockContext);

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({
      timedOut: true,
    });
  }, 5000);
});
