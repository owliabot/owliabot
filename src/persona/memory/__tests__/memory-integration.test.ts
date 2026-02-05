import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersonaLoader } from "../../loader.js";
import { PersonaMerger } from "../../merger.js";

const BASE_CORE = `---
schema_version: "1.0"
name: "Base"
---
Base content.`;

const BASE_STYLE = `---
schema_version: "1.0"
---
Style content.`;

const BASE_BOUNDARY = `---
schema_version: "1.0"
---
Boundary content.`;

const OVERLAY = `---
schema_version: "1.0"
name: "Overlay"
---
Overlay content.`;

describe("persona loader memory integration", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "owliabot-persona-"));
  });

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("injects memory summaries into persona content", async () => {
    const baseDir = join(dir, "persona", "base");
    const agentDir = join(dir, "persona", "agents", "main");
    const memoryDir = join(dir, "memory");
    await mkdir(baseDir, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await mkdir(memoryDir, { recursive: true });

    await writeFile(join(baseDir, "core.md"), BASE_CORE, "utf-8");
    await writeFile(join(baseDir, "style.md"), BASE_STYLE, "utf-8");
    await writeFile(join(baseDir, "boundary.md"), BASE_BOUNDARY, "utf-8");
    await writeFile(join(agentDir, "overlay.md"), OVERLAY, "utf-8");

    const memoryContent = `<!-- tag: preference -->
- Prefers concise responses
`;
    await writeFile(join(memoryDir, "2026-02-03.md"), memoryContent, "utf-8");

    const loader = new PersonaLoader({ rootDir: dir });
    const documents = await loader.loadWithMemory("main", "memory");

    expect(documents.map((doc) => doc.kind)).toEqual([
      "base-core",
      "base-style",
      "base-boundary",
      "overlay",
      "memory",
    ]);

    const merged = new PersonaMerger().merge(documents);
    expect(merged.content).toContain("## User Preferences (from memory)");
    expect(merged.content).toContain("Prefers concise responses");
  });
});
