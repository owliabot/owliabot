import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runBootOnce, type BootRunResult } from "../boot.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("boot", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "boot-test-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, maxRetries: 3, retryDelay: 100 });
  });

  it("skips when BOOT.md is missing", async () => {
    const result = await runBootOnce({
      workspacePath: workDir,
      executePrompt: async () => "NO_REPLY",
    });
    expect(result).toEqual({ status: "skipped", reason: "missing" });
  });

  it("skips when BOOT.md is empty", async () => {
    await writeFile(join(workDir, "BOOT.md"), "");
    const result = await runBootOnce({
      workspacePath: workDir,
      executePrompt: async () => "NO_REPLY",
    });
    expect(result).toEqual({ status: "skipped", reason: "empty" });
  });

  it("skips when BOOT.md contains only comments", async () => {
    await writeFile(join(workDir, "BOOT.md"), "# BOOT.md\n# Just comments\n");
    const result = await runBootOnce({
      workspacePath: workDir,
      executePrompt: async () => "NO_REPLY",
    });
    expect(result).toEqual({ status: "skipped", reason: "empty" });
  });

  it("runs when BOOT.md has meaningful content", async () => {
    await writeFile(
      join(workDir, "BOOT.md"),
      "# BOOT.md\nSend a hello message\n",
    );
    let receivedPrompt = "";
    const result = await runBootOnce({
      workspacePath: workDir,
      executePrompt: async (prompt) => {
        receivedPrompt = prompt;
        return "NO_REPLY";
      },
    });
    expect(result).toEqual({ status: "ran" });
    expect(receivedPrompt).toContain("Send a hello message");
    expect(receivedPrompt).toContain("BOOT.md");
  });

  it("returns failed when executePrompt throws", async () => {
    await writeFile(join(workDir, "BOOT.md"), "Do something\n");
    const result = await runBootOnce({
      workspacePath: workDir,
      executePrompt: async () => {
        throw new Error("LLM unavailable");
      },
    });
    expect(result.status).toBe("failed");
    expect((result as { reason: string }).reason).toContain("LLM unavailable");
  });
});
