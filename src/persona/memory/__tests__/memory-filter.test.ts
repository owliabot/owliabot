import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryFilter } from "../filter.js";

const NOW = new Date("2026-02-04T00:00:00Z");

describe("memory filter", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "owliabot-memory-"));
  });

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("filters entries by tag allowlist", async () => {
    const memoryDir = join(dir, "memory");
    await mkdir(memoryDir, { recursive: true });

    const content = `<!-- tag: preference -->
- Prefers concise replies

<!-- tag: boundary -->
- Avoids sharing secrets
`;
    await writeFile(join(memoryDir, "2026-02-01.md"), content, "utf-8");

    const filter = new MemoryFilter({ allowTags: ["preference"], now: NOW });
    const entries = await filter.filterFromDirectory({
      memoryDir,
      sourceRoot: dir,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.tag).toBe("preference");
    expect(entries[0]?.text).toBe("Prefers concise replies");
  });

  it("blocks sensitive tags", async () => {
    const memoryDir = join(dir, "memory");
    await mkdir(memoryDir, { recursive: true });

    const content = `<!-- tag: private -->
- Bank account details

<!-- tag: preference -->
- Likes short answers
`;
    await writeFile(join(memoryDir, "2026-02-02.md"), content, "utf-8");

    const filter = new MemoryFilter({ now: NOW });
    const entries = await filter.filterFromDirectory({
      memoryDir,
      sourceRoot: dir,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.tag).toBe("preference");
    expect(entries[0]?.text).toBe("Likes short answers");
  });
});
