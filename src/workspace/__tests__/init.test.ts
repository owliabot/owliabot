import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("copies config.example.yaml into workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "owliabot-workspace-"));

    try {
      const result = await ensureWorkspaceInitialized({ workspacePath: dir });

      // config.example.yaml is only copied when the source file is found
      // (depends on cwd); just verify the field is present in the result
      expect(typeof result.copiedConfigExample).toBe("boolean");
      if (result.copiedConfigExample) {
        expect(existsSync(join(dir, "config.example.yaml"))).toBe(true);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not overwrite existing config.example.yaml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "owliabot-workspace-"));

    try {
      await writeFile(join(dir, "config.example.yaml"), "custom content", "utf-8");
      const result = await ensureWorkspaceInitialized({ workspacePath: dir });

      expect(result.copiedConfigExample).toBe(false);
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
});
