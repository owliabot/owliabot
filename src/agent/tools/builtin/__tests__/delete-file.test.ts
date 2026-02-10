import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, lstat, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function loadCreateDeleteFileTool(): Promise<undefined | ((workspace: string) => any)> {
  try {
    const mod = await import("../delete-file.js");
    return (mod as any).createDeleteFileTool;
  } catch {
    return undefined;
  }
}

describe("delete_file tool", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "owliabot-delete-file-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("deletes an existing file", async () => {
    const createDeleteFileTool = await loadCreateDeleteFileTool();
    expect(createDeleteFileTool).toBeTypeOf("function");

    const filePath = join(testDir, "delete-me.txt");
    await writeFile(filePath, "bye", "utf-8");

    const tool = (createDeleteFileTool as any)(testDir);
    const result = await tool.execute({ path: "delete-me.txt" }, {} as any);

    expect(result.success).toBe(true);
    expect((result as any).data.path).toBe("delete-me.txt");
    expect((result as any).data.deleted).toBe(true);

    await expect(lstat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("is idempotent when file does not exist", async () => {
    const createDeleteFileTool = await loadCreateDeleteFileTool();
    expect(createDeleteFileTool).toBeTypeOf("function");

    const tool = (createDeleteFileTool as any)(testDir);
    const result = await tool.execute({ path: "missing.txt" }, {} as any);

    expect(result.success).toBe(true);
    expect((result as any).data.path).toBe("missing.txt");
    expect((result as any).data.deleted).toBe(false);
  });

  describe("error handling", () => {
    it("rejects missing path", async () => {
      const createDeleteFileTool = await loadCreateDeleteFileTool();
      expect(createDeleteFileTool).toBeTypeOf("function");

      const tool = (createDeleteFileTool as any)(testDir);
      const result = await tool.execute({} as any, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("rejects deleting a directory path", async () => {
      const createDeleteFileTool = await loadCreateDeleteFileTool();
      expect(createDeleteFileTool).toBeTypeOf("function");

      await mkdir(join(testDir, "subdir"));
      const tool = (createDeleteFileTool as any)(testDir);

      const result = await tool.execute({ path: "subdir" }, {} as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });
  });

  describe("security: path traversal protection", () => {
    it("blocks absolute paths", async () => {
      const createDeleteFileTool = await loadCreateDeleteFileTool();
      expect(createDeleteFileTool).toBeTypeOf("function");

      const tool = (createDeleteFileTool as any)(testDir);
      const result = await tool.execute({ path: "/tmp/evil.txt" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("blocks .. traversal", async () => {
      const createDeleteFileTool = await loadCreateDeleteFileTool();
      expect(createDeleteFileTool).toBeTypeOf("function");

      const tool = (createDeleteFileTool as any)(testDir);
      const result = await tool.execute({ path: "../escape.txt" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("blocks nested .. traversal", async () => {
      const createDeleteFileTool = await loadCreateDeleteFileTool();
      expect(createDeleteFileTool).toBeTypeOf("function");

      await mkdir(join(testDir, "subdir"));
      const tool = (createDeleteFileTool as any)(testDir);
      const result = await tool.execute({ path: "subdir/../../escape.txt" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("blocks null byte injection", async () => {
      const createDeleteFileTool = await loadCreateDeleteFileTool();
      expect(createDeleteFileTool).toBeTypeOf("function");

      const tool = (createDeleteFileTool as any)(testDir);
      const result = await tool.execute({ path: "file.txt\x00.jpg" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });
  });

  describe("security: protected file protection", () => {
    it("blocks deleting .env files", async () => {
      const createDeleteFileTool = await loadCreateDeleteFileTool();
      expect(createDeleteFileTool).toBeTypeOf("function");

      const tool = (createDeleteFileTool as any)(testDir);
      const result = await tool.execute({ path: ".env" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Protected file");
    });

    it("blocks deleting .git/config", async () => {
      const createDeleteFileTool = await loadCreateDeleteFileTool();
      expect(createDeleteFileTool).toBeTypeOf("function");

      const tool = (createDeleteFileTool as any)(testDir);
      const result = await tool.execute({ path: ".git/config" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Protected file");
    });
  });

  describe("security: symlink protection", () => {
    it("blocks deleting a symlink file", async () => {
      const createDeleteFileTool = await loadCreateDeleteFileTool();
      expect(createDeleteFileTool).toBeTypeOf("function");

      const outsideDir = await mkdtemp(join(tmpdir(), "owliabot-outside-"));
      try {
        await symlink(join(outsideDir, "target.txt"), join(testDir, "link.txt"));
        const tool = (createDeleteFileTool as any)(testDir);
        const result = await tool.execute({ path: "link.txt" }, {} as any);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid path");
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it("blocks deleting through symlinked directories", async () => {
      const createDeleteFileTool = await loadCreateDeleteFileTool();
      expect(createDeleteFileTool).toBeTypeOf("function");

      const outsideDir = await mkdtemp(join(tmpdir(), "owliabot-outside-"));
      try {
        await writeFile(join(outsideDir, "outside.txt"), "nope", "utf-8");
        await symlink(outsideDir, join(testDir, "linked-dir"));

        const tool = (createDeleteFileTool as any)(testDir);
        const result = await tool.execute({ path: "linked-dir/outside.txt" }, {} as any);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid path");
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe("tool metadata", () => {
    it("has correct security level", async () => {
      const createDeleteFileTool = await loadCreateDeleteFileTool();
      expect(createDeleteFileTool).toBeTypeOf("function");

      const tool = (createDeleteFileTool as any)(testDir);
      expect(tool.security.level).toBe("write");
    });

    it("has required parameters", async () => {
      const createDeleteFileTool = await loadCreateDeleteFileTool();
      expect(createDeleteFileTool).toBeTypeOf("function");

      const tool = (createDeleteFileTool as any)(testDir);
      expect(tool.parameters.required).toContain("path");
    });
  });
});
