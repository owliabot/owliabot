import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureWorkspaceInitialized } from "../init.js";

const BASE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "MEMORY.md",
  "policy.yml",
];

describe("workspace init", () => {
  it("creates bootstrap files for a brand new workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "owliabot-workspace-"));

    try {
      const result = await ensureWorkspaceInitialized({ workspacePath: dir });

      expect(result.brandNew).toBe(true);
      expect(result.wroteBootstrap).toBe(true);

      for (const name of BASE_FILES) {
        expect(result.createdFiles).toContain(name);
      }
      expect(result.createdFiles).toContain("BOOTSTRAP.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not create bootstrap when workspace already has files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "owliabot-workspace-"));

    try {
      await writeFile(join(dir, "SOUL.md"), "# Soul\n", "utf-8");

      const result = await ensureWorkspaceInitialized({ workspacePath: dir });

      expect(result.brandNew).toBe(false);
      expect(result.wroteBootstrap).toBe(false);
      expect(result.createdFiles).not.toContain("BOOTSTRAP.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("copies config.example.yaml to workspace on first init", async () => {
    const dir = await mkdtemp(join(tmpdir(), "owliabot-workspace-"));

    try {
      const result = await ensureWorkspaceInitialized({ workspacePath: dir });

      expect(result.copiedConfig).toBe(true);
      const content = await readFile(join(dir, "config.example.yaml"), "utf-8");
      expect(content).toContain("OwliaBot");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not overwrite existing config.example.yaml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "owliabot-workspace-"));

    try {
      await writeFile(join(dir, "config.example.yaml"), "# my custom config\n", "utf-8");

      const result = await ensureWorkspaceInitialized({ workspacePath: dir });

      expect(result.copiedConfig).toBe(false);
      const content = await readFile(join(dir, "config.example.yaml"), "utf-8");
      expect(content).toBe("# my custom config\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
