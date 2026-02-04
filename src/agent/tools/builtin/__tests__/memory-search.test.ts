import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemorySearchTool } from "../memory-search.js";
import { indexMemory } from "../../../../memory/index/indexer.js";

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), "owliabot-memsearch-test-"));
}

describe("memory-search tool (__tests__)", () => {
  it("should search memory and return results", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(
        join(dir, "memory", "2026-01-01.md"),
        "Found something interesting\nMore content here\nThird line",
        "utf-8"
      );
      await writeFile(
        join(dir, "memory", "2026-01-02.md"),
        "Normal stuff\nAnother match here\nEnd",
        "utf-8"
      );

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({ workspaceDir: dir, dbPath });

      const tool = createMemorySearchTool(dir);
      const result = await tool.execute(
        { query: "interesting", max_results: 5 },
        {
          sessionKey: "test",
          agentId: "main",
          signer: null,
          config: {
            memorySearch: {
              enabled: true,
              store: { path: dbPath },
              extraPaths: [],
            },
          },
        } as any
      );

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.results.length).toBeGreaterThan(0);
      expect(data.message).toContain("Found");
      // Results should contain the matching snippet
      expect(data.results[0].snippet).toContain("interesting");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should use default max_results of 5", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({ workspaceDir: dir, dbPath });

      const tool = createMemorySearchTool(dir);
      const result = await tool.execute(
        { query: "alpha" },
        {
          sessionKey: "test",
          agentId: "main",
          signer: null,
          config: {
            memorySearch: {
              enabled: true,
              store: { path: dbPath },
              extraPaths: [],
            },
          },
        } as any
      );

      expect(result.success).toBe(true);
      const data = result.data as any;
      // Should return results (limited to default 5)
      expect(data.results.length).toBeLessThanOrEqual(5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should respect custom max_results", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({ workspaceDir: dir, dbPath });

      const tool = createMemorySearchTool(dir);
      const result = await tool.execute(
        { query: "alpha", max_results: 1 },
        {
          sessionKey: "test",
          agentId: "main",
          signer: null,
          config: {
            memorySearch: {
              enabled: true,
              store: { path: dbPath },
              extraPaths: [],
            },
          },
        } as any
      );

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.results.length).toBeLessThanOrEqual(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should return appropriate message when no results found", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "hello world\n", "utf-8");

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({ workspaceDir: dir, dbPath });

      const tool = createMemorySearchTool(dir);
      const result = await tool.execute(
        { query: "zzzznonexistentzzzz" },
        {
          sessionKey: "test",
          agentId: "main",
          signer: null,
          config: {
            memorySearch: {
              enabled: true,
              store: { path: dbPath },
              extraPaths: [],
            },
          },
        } as any
      );

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.message).toBe("No results found");
      expect(data.results).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should convert 0-indexed lines to 1-indexed in output", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "First line\n", "utf-8");

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({ workspaceDir: dir, dbPath });

      const tool = createMemorySearchTool(dir);
      const result = await tool.execute(
        { query: "First line", max_results: 1 },
        {
          sessionKey: "test",
          agentId: "main",
          signer: null,
          config: {
            memorySearch: {
              enabled: true,
              store: { path: dbPath },
              extraPaths: [],
            },
          },
        } as any
      );

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.results.length).toBeGreaterThan(0);
      // Lines should be 1-indexed strings like "1-1"
      const lines = data.results[0].lines;
      expect(lines).toMatch(/^\d+-\d+$/);
      // First number should be >= 1 (1-indexed)
      const firstLine = parseInt(lines.split("-")[0], 10);
      expect(firstLine).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should return empty results when memory search is disabled", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");

      const tool = createMemorySearchTool(dir);
      const result = await tool.execute(
        { query: "alpha" },
        {
          sessionKey: "test",
          agentId: "main",
          signer: null,
          config: {
            memorySearch: {
              enabled: false,
            },
          },
        } as any
      );

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.message).toBe("No results found");
      expect(data.results).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should have correct metadata", () => {
    const tool = createMemorySearchTool("/tmp/fake");
    expect(tool.name).toBe("memory_search");
    expect(tool.description).toContain("Search through memory");
    expect(tool.security.level).toBe("read");
    expect(tool.parameters.required).toContain("query");
  });
});
