import { describe, it, expect } from "vitest";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorkspaceInitialized } from "../workspace/init.js";
import { loadWorkspace } from "../workspace/loader.js";
import { buildSystemPrompt } from "../agent/system-prompt.js";

const BASE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "MEMORY.md",
];

const TEMPLATES_DIR = join(process.cwd(), "persona/templates");

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe.sequential("E2E: persona/bootstrap", () => {
  it("creates workspace template files and BOOTSTRAP.md for a new workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "owliabot-bootstrap-e2e-"));

    try {
      const result = await ensureWorkspaceInitialized({
        workspacePath: dir,
        templatesDir: TEMPLATES_DIR,
      });

      expect(result.brandNew).toBe(true);
      expect(result.wroteBootstrap).toBe(true);

      for (const name of BASE_FILES) {
        expect(await pathExists(join(dir, name))).toBe(true);
      }
      expect(await pathExists(join(dir, "BOOTSTRAP.md"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not create BOOTSTRAP.md when workspace already has SOUL.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "owliabot-bootstrap-e2e-"));

    try {
      await writeFile(join(dir, "SOUL.md"), "# Soul\n", "utf-8");

      const result = await ensureWorkspaceInitialized({
        workspacePath: dir,
        templatesDir: TEMPLATES_DIR,
      });

      expect(result.brandNew).toBe(false);
      expect(result.wroteBootstrap).toBe(false);
      expect(await pathExists(join(dir, "BOOTSTRAP.md"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("includes bootstrap content in system prompt only when BOOTSTRAP.md exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "owliabot-bootstrap-e2e-"));

    try {
      await ensureWorkspaceInitialized({
        workspacePath: dir,
        templatesDir: TEMPLATES_DIR,
      });

      const bootstrapTemplate = await readFile(join(TEMPLATES_DIR, "BOOTSTRAP.md"), "utf-8");
      const expectedSnippet = "You just woke up in a new workspace.";

      const workspaceWithBootstrap = await loadWorkspace(dir);
      const promptWithBootstrap = buildSystemPrompt({
        workspace: workspaceWithBootstrap,
        channel: "e2e",
        timezone: "UTC",
        model: "test-model",
        chatType: "direct",
      });

      expect(promptWithBootstrap).toContain("## Bootstrap");
      expect(promptWithBootstrap).toContain(expectedSnippet);
      expect(promptWithBootstrap).toContain(bootstrapTemplate.trim());

      await rm(join(dir, "BOOTSTRAP.md"));

      const workspaceWithoutBootstrap = await loadWorkspace(dir);
      const promptWithoutBootstrap = buildSystemPrompt({
        workspace: workspaceWithoutBootstrap,
        channel: "e2e",
        timezone: "UTC",
        model: "test-model",
        chatType: "direct",
      });

      expect(promptWithoutBootstrap).not.toContain("## Bootstrap");
      expect(promptWithoutBootstrap).not.toContain(expectedSnippet);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
