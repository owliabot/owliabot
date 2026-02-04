import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { __resetAutoIndexStateForTests, searchMemory } from "./memory-search.js";
import * as indexer from "../memory/index/indexer.js";

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), "owliabot-mem-autoindex-"));
}

describe("memory search sqlite autoIndex", () => {
  it("autoIndex triggers indexing when enabled and DB is missing", async () => {
    __resetAutoIndexStateForTests();

    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");

      const dbPath = join(dir, "memory.sqlite");
      expect(existsSync(dbPath)).toBe(false);

      const results = await searchMemory(dir, "alpha", {
        provider: "sqlite",
        fallback: "none",
        dbPath,
        extraPaths: [],
        sources: ["files"],
        indexing: { autoIndex: true, minIntervalMs: 0 },
      });

      expect(existsSync(dbPath)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.snippet.toLowerCase()).toContain("alpha");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not run autoIndex more often than minIntervalMs", async () => {
    __resetAutoIndexStateForTests();

    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");

      const dbPath = join(dir, "memory.sqlite");

      const realIndexMemory = indexer.indexMemory;
      const spy = vi
        .spyOn(indexer, "indexMemory")
        .mockImplementation(async (params: any) => realIndexMemory(params));

      await searchMemory(dir, "alpha", {
        provider: "sqlite",
        fallback: "none",
        dbPath,
        extraPaths: [],
        sources: ["files"],
        indexing: { autoIndex: true, minIntervalMs: 60_000 },
      });

      expect(spy).toHaveBeenCalledTimes(1);

      // Make sources stale by updating the file, but keep within minIntervalMs.
      await new Promise((r) => setTimeout(r, 10));
      await writeFile(join(dir, "MEMORY.md"), "alpha\nbeta\n", "utf-8");

      const results = await searchMemory(dir, "beta", {
        provider: "sqlite",
        fallback: "none",
        dbPath,
        extraPaths: [],
        sources: ["files"],
        indexing: { autoIndex: true, minIntervalMs: 60_000 },
      });

      expect(spy).toHaveBeenCalledTimes(1);
      // Should not find beta because we did not re-index.
      expect(results).toEqual([]);

      spy.mockRestore();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("concurrent calls do not run multiple indexers", async () => {
    __resetAutoIndexStateForTests();

    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");

      const dbPath = join(dir, "memory.sqlite");

      const realIndexMemory = indexer.indexMemory;
      let calls = 0;
      const spy = vi.spyOn(indexer, "indexMemory").mockImplementation(async (params: any) => {
        calls++;
        // Ensure overlap so the second call observes inFlight.
        await new Promise((r) => setTimeout(r, 50));
        return realIndexMemory(params);
      });

      const opts = {
        provider: "sqlite" as const,
        fallback: "none" as const,
        dbPath,
        extraPaths: [],
        sources: ["files"] as Array<"files" | "transcripts">,
        indexing: { autoIndex: true, minIntervalMs: 0 },
      };

      const [a, b] = await Promise.all([
        searchMemory(dir, "alpha", opts),
        searchMemory(dir, "alpha", opts),
      ]);

      expect(a.length).toBeGreaterThan(0);
      expect(b.length).toBeGreaterThan(0);
      expect(calls).toBe(1);

      spy.mockRestore();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
