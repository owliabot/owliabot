// src/gateway/__tests__/skills-init.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveBundledSkillsDir,
  collectSkillsDirs,
  loadSkills,
} from "../skills-init.js";

// Mock logger
vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock skills initializer
const mockSkillsResult = {
  systemPromptSection: "Skills available",
  tools: [],
};

vi.mock("../../skills/index.js", () => ({
  initializeSkills: vi.fn(async () => mockSkillsResult),
}));

// Track which paths exist
let existingPaths: Set<string>;

vi.mock("node:fs", () => ({
  existsSync: vi.fn((path: string) => existingPaths.has(path)),
}));

// Store original HOME value for cleanup
let originalHome: string | undefined;

describe("skills-init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existingPaths = new Set();
    // Store and set HOME for testing
    originalHome = process.env.HOME;
    process.env.HOME = "/home/test";
    // Reset environment
    delete process.env.OWLIABOT_BUNDLED_SKILLS_DIR;
  });

  afterEach(() => {
    // Restore original HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
  });

  describe("resolveBundledSkillsDir", () => {
    it("uses environment variable when set", () => {
      process.env.OWLIABOT_BUNDLED_SKILLS_DIR = "/custom/skills";
      existingPaths.add("/custom/skills");

      const result = resolveBundledSkillsDir();

      expect(result).toBe("/custom/skills");
    });

    it("returns undefined when no paths exist", () => {
      // No paths added to existingPaths
      
      const result = resolveBundledSkillsDir();

      expect(result).toBeUndefined();
    });

    it("tries cwd-relative path", () => {
      const cwdPath = `${process.cwd()}/skills`;
      existingPaths.add(cwdPath);

      const result = resolveBundledSkillsDir();

      expect(result).toBe(cwdPath);
    });

    it("tries home directory bundled-skills", () => {
      existingPaths.add("/home/test/.owliabot/bundled-skills");

      const result = resolveBundledSkillsDir();

      expect(result).toBe("/home/test/.owliabot/bundled-skills");
    });

    it("prefers environment variable over other paths", () => {
      process.env.OWLIABOT_BUNDLED_SKILLS_DIR = "/env/skills";
      existingPaths.add("/env/skills");
      existingPaths.add("/home/test/.owliabot/bundled-skills");

      const result = resolveBundledSkillsDir();

      expect(result).toBe("/env/skills");
    });
  });

  describe("collectSkillsDirs", () => {
    it("returns empty array when no directories exist", () => {
      const result = collectSkillsDirs({ workspace: "/workspace" });

      expect(result).toEqual([]);
    });

    it("includes bundled skills directory", () => {
      const cwdPath = `${process.cwd()}/skills`;
      existingPaths.add(cwdPath);

      const result = collectSkillsDirs({ workspace: "/workspace" });

      expect(result).toContain(cwdPath);
    });

    it("includes user skills directory when it exists", () => {
      existingPaths.add("/home/test/.owliabot/skills");

      const result = collectSkillsDirs({ workspace: "/workspace" });

      expect(result).toContain("/home/test/.owliabot/skills");
    });

    it("includes workspace skills directory when it exists", () => {
      existingPaths.add("/workspace/skills");

      const result = collectSkillsDirs({ workspace: "/workspace" });

      expect(result).toContain("/workspace/skills");
    });

    it("uses explicit directory from config", () => {
      existingPaths.add("/custom/skills");

      const result = collectSkillsDirs({
        workspace: "/workspace",
        directory: "/custom/skills",
      });

      expect(result).toContain("/custom/skills");
    });

    it("maintains priority order (bundled → user → workspace)", () => {
      const cwdPath = `${process.cwd()}/skills`;
      existingPaths.add(cwdPath);
      existingPaths.add("/home/test/.owliabot/skills");
      existingPaths.add("/workspace/skills");

      const result = collectSkillsDirs({ workspace: "/workspace" });

      // Bundled first, user second, workspace last
      expect(result.indexOf(cwdPath)).toBeLessThan(
        result.indexOf("/home/test/.owliabot/skills")
      );
      expect(result.indexOf("/home/test/.owliabot/skills")).toBeLessThan(
        result.indexOf("/workspace/skills")
      );
    });
  });

  describe("loadSkills", () => {
    it("returns null when disabled", async () => {
      const result = await loadSkills({
        enabled: false,
        workspace: "/workspace",
      });

      expect(result).toBeNull();
    });

    it("returns null when no directories found", async () => {
      const result = await loadSkills({
        enabled: true,
        workspace: "/workspace",
      });

      expect(result).toBeNull();
    });

    it("calls initializeSkills with collected directories", async () => {
      const { initializeSkills } = await import("../../skills/index.js");
      
      existingPaths.add("/workspace/skills");

      await loadSkills({
        enabled: true,
        workspace: "/workspace",
      });

      expect(initializeSkills).toHaveBeenCalledWith(["/workspace/skills"]);
    });

    it("returns skills result on success", async () => {
      existingPaths.add("/workspace/skills");

      const result = await loadSkills({
        enabled: true,
        workspace: "/workspace",
      });

      expect(result).toBe(mockSkillsResult);
    });

    it("passes multiple directories to initializeSkills", async () => {
      const { initializeSkills } = await import("../../skills/index.js");
      
      const cwdPath = `${process.cwd()}/skills`;
      existingPaths.add(cwdPath);
      existingPaths.add("/home/test/.owliabot/skills");
      existingPaths.add("/workspace/skills");

      await loadSkills({
        enabled: true,
        workspace: "/workspace",
      });

      expect(initializeSkills).toHaveBeenCalledWith([
        cwdPath,
        "/home/test/.owliabot/skills",
        "/workspace/skills",
      ]);
    });

    it("treats undefined enabled as true", async () => {
      existingPaths.add("/workspace/skills");

      const result = await loadSkills({ workspace: "/workspace" });

      expect(result).not.toBeNull();
    });
  });
});
