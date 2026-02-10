import { describe, it, expect } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorkspace } from "../loader.js";

describe("loadWorkspace", () => {
  it("initializes missing template files before loading", async () => {
    const dir = await mkdtemp(join(tmpdir(), "owliabot-loader-"));

    try {
      // Call loadWorkspace on an empty directory — it should auto-initialize templates
      const files = await loadWorkspace(dir);

      // policy.yml is a template file that should have been created
      const policyContent = await readFile(join(dir, "policy.yml"), "utf-8");
      expect(policyContent.length).toBeGreaterThan(0);

      // AGENTS.md should be loaded into the workspace files
      expect(files.agents).toBeDefined();
      expect(typeof files.agents).toBe("string");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
