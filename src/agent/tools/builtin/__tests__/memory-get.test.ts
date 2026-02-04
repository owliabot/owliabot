/**
 * memory-get tool tests (updated for feat/memory-openclaw API).
 *
 * Uses real temp directories instead of mocking fs — the new implementation
 * uses open(O_NOFOLLOW) + fh.stat() which can't be trivially mocked.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryGetTool } from "../memory-get.js";

let cleanups: string[] = [];

async function makeTmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "owliabot-memget-ci-"));
  cleanups.push(d);
  return d;
}

afterEach(async () => {
  for (const d of cleanups) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
  cleanups = [];
});

describe("memory-get tool", () => {
  it("should read file lines with default parameters", async () => {
    const dir = await makeTmp();
    await mkdir(join(dir, "memory"), { recursive: true });
    await writeFile(join(dir, "memory", "test.md"), "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

    const tool = createMemoryGetTool(dir);
    const result = await tool.execute({ path: "memory/test.md" }, {} as any);

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.from_line).toBe(1);
    expect(data.content).toContain("Line 1");
  });

  it("should read specific line range", async () => {
    const dir = await makeTmp();
    await mkdir(join(dir, "memory"), { recursive: true });
    await writeFile(join(dir, "memory", "test.md"), "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

    const tool = createMemoryGetTool(dir);
    const result = await tool.execute(
      { path: "memory/test.md", from_line: 2, num_lines: 2 },
      {} as any,
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.from_line).toBe(2);
    expect(data.to_line).toBe(3);
    expect(data.content).toBe("Line 2\nLine 3");
  });

  it("should handle reading beyond end of file", async () => {
    const dir = await makeTmp();
    await mkdir(join(dir, "memory"), { recursive: true });
    await writeFile(join(dir, "memory", "test.md"), "Line 1\nLine 2\nLine 3");

    const tool = createMemoryGetTool(dir);
    const result = await tool.execute(
      { path: "memory/test.md", from_line: 2, num_lines: 100 },
      {} as any,
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.to_line).toBe(3);
    expect(data.content).toBe("Line 2\nLine 3");
  });

  it("should reject paths with ..", async () => {
    const dir = await makeTmp();
    const tool = createMemoryGetTool(dir);
    const result = await tool.execute({ path: "../etc/passwd" }, {} as any);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("should reject absolute paths", async () => {
    const dir = await makeTmp();
    const tool = createMemoryGetTool(dir);
    const result = await tool.execute({ path: "/etc/passwd" }, {} as any);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("should return error when file not found", async () => {
    const dir = await makeTmp();
    await mkdir(join(dir, "memory"), { recursive: true });
    const tool = createMemoryGetTool(dir);
    const result = await tool.execute({ path: "memory/missing.md" }, {} as any);

    expect(result.success).toBe(false);
    expect(result.error).toContain("File not found");
  });

  it("should include total line count in response", async () => {
    const dir = await makeTmp();
    await mkdir(join(dir, "memory"), { recursive: true });
    await writeFile(join(dir, "memory", "test.md"), "Line 1\nLine 2\nLine 3");

    const tool = createMemoryGetTool(dir);
    const result = await tool.execute({ path: "memory/test.md" }, {} as any);

    const data = result.data as any;
    expect(data.total_lines).toBe(3);
  });

  it("should handle empty files", async () => {
    const dir = await makeTmp();
    await mkdir(join(dir, "memory"), { recursive: true });
    await writeFile(join(dir, "memory", "empty.md"), "");

    const tool = createMemoryGetTool(dir);
    const result = await tool.execute({ path: "memory/empty.md" }, {} as any);

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.total_lines).toBe(1);
    expect(data.content).toBe("");
  });

  it("should have correct metadata", () => {
    const tool = createMemoryGetTool("/tmp/fake");
    expect(tool.name).toBe("memory_get");
    expect(tool.description).toContain("specific lines");
    expect(tool.security.level).toBe("read");
    expect(tool.parameters.required).toContain("path");
  });

  it("should block symlink files in allowed paths", async () => {
    const dir = await makeTmp();
    await mkdir(join(dir, "memory"), { recursive: true });
    await writeFile(join(dir, "MEMORY.md"), "real content");
    await symlink(join(dir, "MEMORY.md"), join(dir, "memory", "link.md"));

    const tool = createMemoryGetTool(dir);
    const result = await tool.execute({ path: "memory/link.md" }, {} as any);

    expect(result.success).toBe(false);
  });

  it("should allow reading MEMORY.md", async () => {
    const dir = await makeTmp();
    await writeFile(join(dir, "MEMORY.md"), "long-term memory");

    const tool = createMemoryGetTool(dir);
    const result = await tool.execute({ path: "MEMORY.md" }, {} as any);

    expect(result.success).toBe(true);
    expect((result.data as any).content).toContain("long-term memory");
  });

  it("should reject non-.md files", async () => {
    const dir = await makeTmp();
    await mkdir(join(dir, "memory"), { recursive: true });
    await writeFile(join(dir, "memory", "test.txt"), "nope");

    const tool = createMemoryGetTool(dir);
    const result = await tool.execute({ path: "memory/test.txt" }, {} as any);

    expect(result.success).toBe(false);
  });

  it("should reject files outside allowed roots", async () => {
    const dir = await makeTmp();
    await writeFile(join(dir, "NOTES.md"), "private");

    const tool = createMemoryGetTool(dir);
    const result = await tool.execute({ path: "NOTES.md" }, {} as any);

    expect(result.success).toBe(false);
  });
});
