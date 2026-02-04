import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryGetTool } from "../memory-get.js";

describe("memory-get tool", () => {
  async function makeTmpDir() {
    return mkdtemp(join(tmpdir(), "owliabot-memget-test-"));
  }

  async function setupWorkspace(content: string) {
    const dir = await makeTmpDir();
    await mkdir(join(dir, "memory"), { recursive: true });
    await writeFile(join(dir, "memory", "test.md"), content, "utf-8");
    return dir;
  }

  it("should read file lines with default parameters", async () => {
    const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
    const dir = await setupWorkspace(content);
    try {
      const tool = createMemoryGetTool(dir);
      const result = await tool.execute(
        { path: "memory/test.md" },
        {} as any
      );

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.from_line).toBe(1);
      expect(data.content).toBe("Line 1\nLine 2\nLine 3\nLine 4\nLine 5");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should read specific line range", async () => {
    const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
    const dir = await setupWorkspace(content);
    try {
      const tool = createMemoryGetTool(dir);
      const result = await tool.execute(
        {
          path: "memory/test.md",
          from_line: 2,
          num_lines: 2,
        },
        {} as any
      );

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.from_line).toBe(2);
      expect(data.to_line).toBe(3);
      expect(data.content).toBe("Line 2\nLine 3");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should handle reading beyond end of file", async () => {
    const content = "Line 1\nLine 2\nLine 3";
    const dir = await setupWorkspace(content);
    try {
      const tool = createMemoryGetTool(dir);
      const result = await tool.execute(
        {
          path: "memory/test.md",
          from_line: 2,
          num_lines: 100,
        },
        {} as any
      );

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.to_line).toBe(3);
      expect(data.content).toBe("Line 2\nLine 3");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should reject paths with ..", async () => {
    const dir = await makeTmpDir();
    try {
      const tool = createMemoryGetTool(dir);
      const result = await tool.execute(
        { path: "../etc/passwd" },
        {} as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("path required");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should reject absolute paths", async () => {
    const dir = await makeTmpDir();
    try {
      const tool = createMemoryGetTool(dir);
      const result = await tool.execute(
        { path: "/etc/passwd" },
        {} as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("path required");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should reject non-.md files", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "memory", "test.txt"), "content", "utf-8");

      const tool = createMemoryGetTool(dir);
      const result = await tool.execute(
        { path: "memory/test.txt" },
        {} as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("path required");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should reject paths outside allowed roots", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(join(dir, "NOTES.md"), "nope", "utf-8");

      const tool = createMemoryGetTool(dir);
      const result = await tool.execute(
        { path: "NOTES.md" },
        {} as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("path required");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should return error when file not found", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });

      const tool = createMemoryGetTool(dir);
      const result = await tool.execute(
        { path: "memory/missing.md" },
        {} as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("File not found");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should include total line count in response", async () => {
    const content = "Line 1\nLine 2\nLine 3";
    const dir = await setupWorkspace(content);
    try {
      const tool = createMemoryGetTool(dir);
      const result = await tool.execute(
        { path: "memory/test.md" },
        {} as any
      );

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.total_lines).toBe(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should handle empty files", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "memory", "empty.md"), "", "utf-8");

      const tool = createMemoryGetTool(dir);
      const result = await tool.execute(
        { path: "memory/empty.md" },
        {} as any
      );

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.total_lines).toBe(1); // Empty file still has 1 line (empty string)
      expect(data.content).toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should allow reading MEMORY.md", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(join(dir, "MEMORY.md"), "line1\nline2\nline3", "utf-8");

      const tool = createMemoryGetTool(dir);
      const result = await tool.execute(
        { path: "MEMORY.md", from_line: 1, num_lines: 2 },
        {} as any
      );

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.content).toContain("line1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should have correct metadata", () => {
    const tool = createMemoryGetTool("/tmp/fake");
    expect(tool.name).toBe("memory_get");
    expect(tool.description).toContain("Get specific lines");
    expect(tool.security.level).toBe("read");
    expect(tool.parameters.required).toContain("path");
  });
});
