import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentPersonaManager } from "../multi-agent.js";

const BASE_CORE = `---
schema_version: "1.0"
name: "Base"
do:
  - "base rule"
tools:
  - "tool-a"
---
Base content.`;

const OVERLAY_ALPHA = `---
schema_version: "1.0"
name: "Alpha"
do:
  - "alpha rule"
tools:
  - "tool-a"
---
Alpha content.`;

const OVERLAY_BRAVO = `---
schema_version: "1.0"
name: "Bravo"
do:
  - "bravo rule"
tools:
  - "tool-a"
---
Bravo content.`;

describe("agent persona manager", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "owliabot-persona-"));
  });

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads shared base with isolated overlays per agent", async () => {
    const baseDir = join(dir, "persona", "base");
    const alphaDir = join(dir, "persona", "agents", "alpha");
    const bravoDir = join(dir, "persona", "agents", "bravo");
    await mkdir(baseDir, { recursive: true });
    await mkdir(alphaDir, { recursive: true });
    await mkdir(bravoDir, { recursive: true });

    await writeFile(join(baseDir, "core.md"), BASE_CORE, "utf-8");
    await writeFile(join(alphaDir, "overlay.md"), OVERLAY_ALPHA, "utf-8");
    await writeFile(join(bravoDir, "overlay.md"), OVERLAY_BRAVO, "utf-8");

    const manager = new AgentPersonaManager({ rootDir: dir });
    const alphaPersona = await manager.loadPersona("alpha");
    const bravoPersona = await manager.loadPersona("bravo");

    expect(alphaPersona.name).toBe("Alpha");
    expect(bravoPersona.name).toBe("Bravo");
    expect(alphaPersona.content).toBe("Base content.\n\nAlpha content.");
    expect(bravoPersona.content).toBe("Base content.\n\nBravo content.");
  });

  it("blocks cross-agent overlay paths", () => {
    const manager = new AgentPersonaManager({ rootDir: dir });
    expect(() => manager.setOverlayDir("alpha", "../bravo")).toThrow(
      /cross-agent/i
    );
  });
});
