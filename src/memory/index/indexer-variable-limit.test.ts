import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), "owliabot-mem-index-varlimit-"));
}

describe("memory indexer - variable limit safety", () => {
  it("does not throw when indexing >999 paths (stale cleanup avoids NOT IN (...))", async () => {
    const dir = await makeTmpDir();

    try {
      const dbPath = join(dir, "memory.sqlite");

      vi.resetModules();

      const count = 1200;

      vi.doMock("./scanner.js", () => {
        return {
          listMemoryFiles: async () => {
            const files: Array<{ relPath: string; absPath: string }> = [];
            for (let i = 0; i < count; i++) {
              files.push({
                relPath: `memory/f-${i}.md`,
                absPath: join(dir, "memory", `f-${i}.md`),
              });
            }
            return files;
          },
        };
      });

      vi.doMock("node:fs/promises", async () => {
        const actual = await vi.importActual<any>("node:fs/promises");
        return {
          ...actual,
          readFile: async () => "alpha\n",
        };
      });

      vi.doMock("./chunker.js", () => {
        return {
          chunkMarkdown: ({ relPath }: { relPath: string; content: string }) => [
            { path: relPath, startLine: 1, endLine: 1, text: "alpha\n" },
          ],
        };
      });

      const { indexMemory } = await import("./indexer.js");

      await expect(indexMemory({ workspaceDir: dir, dbPath })).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
      vi.resetModules();
      vi.unmock("./scanner.js");
      vi.unmock("./chunker.js");
      vi.unmock("node:fs/promises");
    }
  });
});
