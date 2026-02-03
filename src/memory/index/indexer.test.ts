import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { indexMemory } from "./indexer.js";

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), "owliabot-mem-index-"));
}

describe("memory indexer", () => {
  it("indexes MEMORY.md and memory/*.md into sqlite", async () => {
    const dir = await makeTmpDir();
    const memoryDir = join(dir, "memory");
    await mkdir(memoryDir, { recursive: true });

    await writeFile(join(dir, "MEMORY.md"), "# Memory\nHello world\n", "utf-8");
    await writeFile(join(memoryDir, "a.md"), "## A\nLine 1\nLine 2\n", "utf-8");

    const dbPath = join(dir, "memory.sqlite");
    await indexMemory({ workspaceDir: dir, dbPath });

    const db = new Database(dbPath, { readonly: true });
    try {
      const filesCount = db.prepare("SELECT COUNT(*) as c FROM files").get() as {
        c: number;
      };
      const chunksCount = db.prepare("SELECT COUNT(*) as c FROM chunks").get() as {
        c: number;
      };

      expect(filesCount.c).toBe(2);
      expect(chunksCount.c).toBeGreaterThan(0);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
