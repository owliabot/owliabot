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

    const baseDocs = docs.filter((doc) => doc.source === "base");
    const overlayDocs = docs.filter((doc) => doc.source === "overlay");
    expect(baseDocs).toHaveLength(3);
    expect(overlayDocs).toHaveLength(2);
    expect(baseDocs.every((doc) => doc.readonly)).toBe(true);
    expect(overlayDocs.every((doc) => !doc.readonly)).toBe(true);
    expect(baseDocs.every((doc) => loader.isFromBase(doc))).toBe(true);
    expect(overlayDocs.every((doc) => !loader.isFromBase(doc))).toBe(true);
  });

  it("rejects invalid agentId and sessionId paths", async () => {
    const loader = new PersonaLoader({ rootDir: dir });

    await expect(loader.load({ agentId: "../escape" })).rejects.toThrow(
      /Invalid agent id/i
    );

    await expect(
      loader.loadOverlay({ agentId: "main", sessionId: "../escape" })
    ).rejects.toThrow(/Invalid session id/i);
  });

  it("rejects overlayDir that escapes the agent root", async () => {
    const loader = new PersonaLoader({ rootDir: dir });
    const personaRoot = join(dir, "persona");
    const otherAgentDir = join(personaRoot, "agents", "other");

    await expect(
      loader.loadOverlay({
        agentId: "main",
        overlayDir: otherAgentDir,
      })
    ).rejects.toThrow(/overlay path escapes agent root/i);
  });
});

describe("persona merger", () => {
  it("merges lists, overrides fields, and intersects tools", () => {
    const documents: PersonaDocument[] = [
      {
        kind: "base-core",
        path: "/base/core.md",
        source: "base",
        readonly: true,
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
        source: "overlay",
        readonly: false,
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
        source: "overlay",
        readonly: false,
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

  it("supports merge strategy configuration", () => {
    const documents: PersonaDocument[] = [
      {
        kind: "base-core",
        path: "/base/core.md",
        source: "base",
        readonly: true,
        frontmatter: {
          do: ["a", "b"],
          boundaries: ["x", "y"],
          tools: ["tool-a", "tool-b"],
        },
        body: "Base content.",
      },
      {
        kind: "overlay",
        path: "/agents/main/overlay.md",
        source: "overlay",
        readonly: false,
        frontmatter: {
          do: ["b", "c"],
          boundaries: ["y", "z"],
          tools: ["tool-b", "tool-c"],
        },
        body: "Overlay content.",
      },
    ];

    const merged = new PersonaMerger({
      listStrategies: {
        do: "replace",
        boundaries: "intersect",
        tools: "append",
      },
    }).merge(documents);

    expect(merged.do).toEqual(["b", "c"]);
    expect(merged.boundaries).toEqual(["y"]);
    expect(merged.tools).toEqual(["tool-a", "tool-b", "tool-c"]);
  });
});
