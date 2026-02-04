import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersonaLoader } from "../loader.js";
import { PersonaMerger } from "../merger.js";
import type { PersonaDocument } from "../types.js";

const BASE_CORE = `---
schema_version: "1.0"
name: "Base"
do:
  - "be clear"
tools:
  - "tool-a"
  - "tool-b"
---
Core content.`;

const BASE_STYLE = `---
schema_version: "1.0"
tone:
  - "calm"
---
Style content.`;

const BASE_BOUNDARY = `---
schema_version: "1.0"
boundaries:
  - "no secrets"
---
Boundary content.`;

const OVERLAY = `---
schema_version: "1.0"
name: "Overlay"
do:
  - "be clear"
  - "ask questions"
dont: ["be risky"]
tools:
  - "tool-b"
---
Overlay content.`;

const NOTES = `---
schema_version: "1.0"
notes:
  - "runtime note"
---
Note body.`;

describe("persona loader", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "owliabot-persona-"));
  });

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads base and overlay files in priority order", async () => {
    const baseDir = join(dir, "persona", "base");
    const agentDir = join(dir, "persona", "agents", "main");
    await mkdir(baseDir, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(baseDir, "core.md"), BASE_CORE, "utf-8");
    await writeFile(join(baseDir, "style.md"), BASE_STYLE, "utf-8");
    await writeFile(join(baseDir, "boundary.md"), BASE_BOUNDARY, "utf-8");
    await writeFile(join(agentDir, "overlay.md"), OVERLAY, "utf-8");
    await writeFile(join(agentDir, "notes.md"), NOTES, "utf-8");

    const loader = new PersonaLoader({ rootDir: dir });
    const docs = await loader.load({ agentId: "main" });

    expect(docs.map((doc) => doc.kind)).toEqual([
      "base-core",
      "base-style",
      "base-boundary",
      "overlay",
      "notes",
    ]);
    expect(docs[0]?.frontmatter.name).toBe("Base");
    expect(docs[3]?.frontmatter.name).toBe("Overlay");
  });
});

describe("persona merger", () => {
  it("merges lists, overrides fields, and intersects tools", () => {
    const documents: PersonaDocument[] = [
      {
        kind: "base-core",
        path: "/base/core.md",
        frontmatter: {
          name: "Base",
          do: ["be clear"],
          boundaries: ["no secrets"],
          tools: ["tool-a", "tool-b"],
          notes: ["base note"],
        },
        body: "Base content.",
      },
      {
        kind: "overlay",
        path: "/agents/main/overlay.md",
        frontmatter: {
          name: "Overlay",
          do: ["ask questions"],
          dont: ["be risky"],
          boundaries: ["no secrets", "no leaks"],
          tools: ["tool-b"],
        },
        body: "Overlay content.",
      },
      {
        kind: "notes",
        path: "/agents/main/notes.md",
        frontmatter: { notes: ["runtime note"] },
        body: "Note body.",
      },
    ];

    const merged = new PersonaMerger().merge(documents);

    expect(merged.name).toBe("Overlay");
    expect(merged.do).toEqual(["be clear", "ask questions"]);
    expect(merged.dont).toEqual(["be risky"]);
    expect(merged.boundaries).toEqual(["no secrets", "no leaks"]);
    expect(merged.tools).toEqual(["tool-b"]);
    expect(merged.content).toBe("Base content.\n\nOverlay content.");
    expect(merged.notes).toEqual(["base note", "runtime note", "Note body."]);
  });
});
