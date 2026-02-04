/**
 * memory-search tool tests (updated for feat/memory-openclaw API).
 *
 * Uses real temp directories + sqlite indexing to match the new implementation
 * which reads config from ctx and supports provider/fallback/extraPaths.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemorySearchTool } from "../memory-search.js";
import { indexMemory } from "../../../../memory/index/indexer.js";

let cleanups: string[] = [];

async function makeTmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "owliabot-memsearch-ci-"));
  cleanups.push(d);
  return d;
}

function makeCtx(dbPath: string, overrides: Record<string, any> = {}): any {
  return {
    sessionKey: "test",
    agentId: "main",
    signer: null,
    config: {
      memorySearch: {
        enabled: true,
        store: { path: dbPath },
        extraPaths: [],
        ...overrides,
      },
    },
  };
}

afterEach(async () => {
  for (const d of cleanups) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
  cleanups = [];
});

describe("memory-search tool", () => {
  it("should search memory and return results", async () => {
    const dir = await makeTmp();
    await mkdir(join(dir, "memory"), { recursive: true });
    await writeFile(join(dir, "MEMORY.md"), "Found something interesting\nAnother line\n");

    const dbPath = join(dir, "memory.sqlite");
    await indexMemory({ workspaceDir: dir, dbPath });

    const tool = createMemorySearchTool(dir);
    const result = await tool.execute(
      { query: "interesting" },
      makeCtx(dbPath),
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.message).toContain("Found");
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].snippet).toContain("interesting");
  });

  it("should respect custom max_results", async () => {
    const dir = await makeTmp();
    await mkdir(join(dir, "memory"), { recursive: true });
    await writeFile(join(dir, "MEMORY.md"), "alpha\nbeta\ngamma\n");
    await writeFile(join(dir, "memory", "a.md"), "alpha again\n");
    await writeFile(join(dir, "memory", "b.md"), "alpha third\n");

    const dbPath = join(dir, "memory.sqlite");
    await indexMemory({ workspaceDir: dir, dbPath });

    const tool = createMemorySearchTool(dir);
    const result = await tool.execute(
      { query: "alpha", max_results: 1 },
      makeCtx(dbPath),
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.results).toHaveLength(1);
  });

  it("should return appropriate message when no results found", async () => {
    const dir = await makeTmp();
    await mkdir(join(dir, "memory"), { recursive: true });
    await writeFile(join(dir, "MEMORY.md"), "nothing relevant\n");

    const dbPath = join(dir, "memory.sqlite");
    await indexMemory({ workspaceDir: dir, dbPath });

    const tool = createMemorySearchTool(dir);
    const result = await tool.execute(
      { query: "xyznonexistent" },
      makeCtx(dbPath),
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.message).toBe("No results found");
    expect(data.results).toEqual([]);
  });

  it("should return empty results when disabled (fail-closed default)", async () => {
    const dir = await makeTmp();
    const tool = createMemorySearchTool(dir);

    // No memorySearch config at all → enabled defaults to false
    const result = await tool.execute({ query: "test" }, {} as any);

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.message).toBe("No results found");
    expect(data.results).toEqual([]);
  });

  it("should have correct metadata", () => {
    const tool = createMemorySearchTool("/tmp/fake");
    expect(tool.name).toBe("memory_search");
    expect(tool.description).toContain("Search through memory");
    expect(tool.security.level).toBe("read");
    expect(tool.parameters.required).toContain("query");
  });

  it("should convert 0-indexed lines to 1-indexed in output", async () => {
    const dir = await makeTmp();
    await mkdir(join(dir, "memory"), { recursive: true });
    await writeFile(join(dir, "MEMORY.md"), "First line\nSecond line\n");

    const dbPath = join(dir, "memory.sqlite");
    await indexMemory({ workspaceDir: dir, dbPath });

    const tool = createMemorySearchTool(dir);
    const result = await tool.execute(
      { query: "First line" },
      makeCtx(dbPath),
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.results.length).toBeGreaterThan(0);
    // Lines should be 1-indexed strings like "1-2"
    expect(data.results[0].lines).toMatch(/^\d+-\d+$/);
  });
});
