import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listMemoryFiles } from "./scanner.js";

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), "owliabot-mem-scan-"));
}

describe("memory scanner (listMemoryFiles)", () => {
  it("includes configured extraPaths (inside workspace) and returns posix relPaths", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await mkdir(join(dir, "extra"), { recursive: true });

      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");
      await writeFile(join(dir, "extra", "note.md"), "beta\n", "utf-8");

      const files = await listMemoryFiles({ workspaceDir: dir, extraPaths: ["./extra/"] });
      const rels = files.map((f) => f.relPath);

      expect(rels).toContain("MEMORY.md");
      expect(rels).toContain("extra/note.md");
      // basic normalization invariant: never returns leading ./
      expect(rels.some((p) => p.startsWith("./"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("deduplicates overlap: core memory sources win over extraPaths", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");
      await writeFile(join(dir, "memory", "a.md"), "beta\n", "utf-8");

      const files = await listMemoryFiles({
        workspaceDir: dir,
        // explicitly include core sources via extraPaths in multiple forms
        extraPaths: ["MEMORY.md", "./MEMORY.md", "memory", "./memory", "memory/"],
      });

      const rels = files.map((f) => f.relPath);
      expect(rels.filter((p) => p === "MEMORY.md")).toHaveLength(1);
      expect(rels.filter((p) => p === "memory/a.md")).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores extraPaths outside the workspace (fail-closed)", async () => {
    const dir = await makeTmpDir();
    const outside = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");

      const outsideFile = join(outside, "outside.md");
      await writeFile(outsideFile, "beta\n", "utf-8");

      const files = await listMemoryFiles({
        workspaceDir: dir,
        extraPaths: [outsideFile, "../outside.md"],
      });

      const rels = files.map((f) => f.relPath);
      expect(rels).toContain("MEMORY.md");
      expect(rels).not.toContain("outside.md");
      expect(rels.some((p) => p.includes(".."))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects extraPaths that traverse a symlink directory within the workspace (no escape)", async () => {
    const dir = await makeTmpDir();
    const outside = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");

      await writeFile(join(outside, "secret.md"), "beta\n", "utf-8");

      // Create a symlink inside the workspace pointing outside.
      await symlink(outside, join(dir, "link"));

      const files = await listMemoryFiles({
        workspaceDir: dir,
        extraPaths: ["link", "link/secret.md"],
      });

      const rels = files.map((f) => f.relPath);
      expect(rels).toContain("MEMORY.md");
      expect(rels).not.toContain("link/secret.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
