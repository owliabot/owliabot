import { describe, expect, it, vi } from "vitest";
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

  it("indexes configured extraPaths and deduplicates overlap with core sources", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await mkdir(join(dir, "extra"), { recursive: true });

      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");
      await writeFile(join(dir, "memory", "a.md"), "beta\n", "utf-8");
      await writeFile(join(dir, "extra", "note.md"), "gamma\n", "utf-8");

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({
        workspaceDir: dir,
        dbPath,
        // include extra + also explicitly include core via extraPaths in multiple forms
        extraPaths: ["extra", "MEMORY.md", "./MEMORY.md", "memory", "./memory", "memory/"],
      });

      const db = new Database(dbPath, { readonly: true });
      try {
        const paths = db
          .prepare("SELECT path FROM files ORDER BY path ASC")
          .all()
          .map((r: any) => r.path);

        expect(paths).toEqual(["MEMORY.md", "extra/note.md", "memory/a.md"]);
      } finally {
        db.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("removes stale file and chunk rows after reindex", async () => {
    const dir = await makeTmpDir();
    const memoryDir = join(dir, "memory");
    await mkdir(memoryDir, { recursive: true });

    const memoryPath = join(dir, "MEMORY.md");
    const filePath = join(memoryDir, "stale.md");
    await writeFile(memoryPath, "# Memory\nHello world\n", "utf-8");
    await writeFile(filePath, "## Stale\nLine 1\n", "utf-8");

    const dbPath = join(dir, "memory.sqlite");
    await indexMemory({ workspaceDir: dir, dbPath });

    await rm(filePath, { force: true });
    await indexMemory({ workspaceDir: dir, dbPath });

    const db = new Database(dbPath, { readonly: true });
    try {
      const filesCount = db.prepare("SELECT COUNT(*) as c FROM files").get() as {
        c: number;
      };
      const staleChunks = db
        .prepare("SELECT COUNT(*) as c FROM chunks WHERE path = ?")
        .get("memory/stale.md") as { c: number };

      expect(filesCount.c).toBe(1);
      expect(staleChunks.c).toBe(0);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not update updatedAt when content hash is unchanged", async () => {
    vi.useFakeTimers();
    try {
      const dir = await makeTmpDir();
      const memoryDir = join(dir, "memory");
      await mkdir(memoryDir, { recursive: true });

      const filePath = join(dir, "MEMORY.md");
      await writeFile(filePath, "# Memory\nHello world\n", "utf-8");

      const dbPath = join(dir, "memory.sqlite");
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
      await indexMemory({ workspaceDir: dir, dbPath });

      const db = new Database(dbPath, { readonly: true });
      const firstRow = db
        .prepare("SELECT updatedAt FROM files WHERE path = ?")
        .get("MEMORY.md") as { updatedAt: number };
      db.close();

      vi.setSystemTime(new Date("2024-01-02T00:00:00Z"));
      await indexMemory({ workspaceDir: dir, dbPath });

      const dbAfter = new Database(dbPath, { readonly: true });
      const secondRow = dbAfter
        .prepare("SELECT updatedAt FROM files WHERE path = ?")
        .get("MEMORY.md") as { updatedAt: number };
      dbAfter.close();

      expect(secondRow.updatedAt).toBe(firstRow.updatedAt);
      await rm(dir, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
