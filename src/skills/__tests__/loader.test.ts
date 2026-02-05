// src/skills/__tests__/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  parseFrontmatter,
  loadSkillsFromDir,
  loadSkills,
  SKILL_FILENAME,
} from "../loader.js";
import { initializeSkills } from "../index.js";

const TEST_BASE_DIR = join(process.cwd(), "test-skills-tmp");

describe("parseFrontmatter", () => {
  it("should parse valid frontmatter", () => {
    const content = `---
name: test-skill
description: A test skill
version: 1.0.0
---

# Test Skill

Content here.`;

    const result = parseFrontmatter(content);

    expect(result).not.toBeNull();
    expect(result!.data.name).toBe("test-skill");
    expect(result!.data.description).toBe("A test skill");
    expect(result!.data.version).toBe("1.0.0");
    expect(result!.content).toContain("# Test Skill");
  });

  it("should return null for content without frontmatter", () => {
    const content = `# No Frontmatter

Just regular markdown.`;

    const result = parseFrontmatter(content);

    expect(result).toBeNull();
  });

  it("should handle empty frontmatter", () => {
    const content = `---
---

Content`;

    const result = parseFrontmatter(content);

    expect(result).not.toBeNull();
    expect(result!.data).toEqual({});
  });

  it("should handle complex metadata", () => {
    const content = `---
name: complex-skill
description: A complex skill
metadata:
  openclaw:
    emoji: "🚀"
    requires:
      config:
        - channels.discord
---

Content`;

    const result = parseFrontmatter(content);

    expect(result).not.toBeNull();
    expect(result!.data.metadata).toBeDefined();
    const metadata = result!.data.metadata as Record<string, unknown>;
    expect(metadata.openclaw).toBeDefined();
  });
});

describe("loadSkillsFromDir", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(TEST_BASE_DIR, `load-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should load skill with valid SKILL.md", async () => {
    const skillDir = join(testDir, "my-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, SKILL_FILENAME),
      `---
name: My Skill
description: Does something useful
version: 1.0.0
---

# My Skill

Instructions here.`
    );

    const result = await loadSkillsFromDir(testDir);

    expect(result.loaded).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.loaded[0].id).toBe("my-skill");
    expect(result.loaded[0].meta.name).toBe("My Skill");
    expect(result.loaded[0].meta.description).toBe("Does something useful");
    expect(result.loaded[0].meta.version).toBe("1.0.0");
    expect(result.loaded[0].location).toContain("my-skill/SKILL.md");
  });

  it("should use directory name as fallback for name", async () => {
    const skillDir = join(testDir, "fallback-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, SKILL_FILENAME),
      `---
description: A skill without explicit name
---

Content`
    );

    const result = await loadSkillsFromDir(testDir);

    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0].meta.name).toBe("fallback-skill");
  });

  it("should fail on missing description", async () => {
    const skillDir = join(testDir, "no-desc-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, SKILL_FILENAME),
      `---
name: No Description
---

Content`
    );

    const result = await loadSkillsFromDir(testDir);

    expect(result.loaded).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe("no-desc-skill");
    expect(result.failed[0].error).toContain("description");
  });

  it("should skip directories without SKILL.md", async () => {
    const skillDir = join(testDir, "no-skill-file");
    await mkdir(skillDir);
    await writeFile(join(skillDir, "README.md"), "# Not a skill");

    const result = await loadSkillsFromDir(testDir);

    expect(result.loaded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it("should return empty result for non-existent directory", async () => {
    const result = await loadSkillsFromDir("/nonexistent/path");

    expect(result.loaded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it("should fail on invalid frontmatter", async () => {
    const skillDir = join(testDir, "invalid-yaml");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, SKILL_FILENAME),
      `---
name: [unclosed bracket
description: invalid
---

Content`
    );

    const result = await loadSkillsFromDir(testDir);

    expect(result.loaded).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe("invalid-yaml");
  });
});

describe("loadSkills (multi-directory)", () => {
  let dir1: string;
  let dir2: string;

  beforeEach(async () => {
    const base = join(TEST_BASE_DIR, `multi-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    dir1 = join(base, "dir1");
    dir2 = join(base, "dir2");
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });
  });

  afterEach(async () => {
    const base = join(dir1, "..");
    await rm(base, { recursive: true, force: true });
  });

  it("should load skills from multiple directories", async () => {
    // Create skill in dir1
    const skill1Dir = join(dir1, "skill-a");
    await mkdir(skill1Dir);
    await writeFile(
      join(skill1Dir, SKILL_FILENAME),
      `---
name: Skill A
description: First skill
---
Content`
    );

    // Create skill in dir2
    const skill2Dir = join(dir2, "skill-b");
    await mkdir(skill2Dir);
    await writeFile(
      join(skill2Dir, SKILL_FILENAME),
      `---
name: Skill B
description: Second skill
---
Content`
    );

    const result = await loadSkills([dir1, dir2]);

    expect(result.loaded).toHaveLength(2);
    expect(result.loaded.map(s => s.id).sort()).toEqual(["skill-a", "skill-b"]);
  });

  it("should override skills from later directories", async () => {
    // Create skill in dir1
    const skill1Dir = join(dir1, "same-skill");
    await mkdir(skill1Dir);
    await writeFile(
      join(skill1Dir, SKILL_FILENAME),
      `---
name: Same Skill
description: Version from dir1
---
Content`
    );

    // Create same skill in dir2 (should override)
    const skill2Dir = join(dir2, "same-skill");
    await mkdir(skill2Dir);
    await writeFile(
      join(skill2Dir, SKILL_FILENAME),
      `---
name: Same Skill
description: Version from dir2
---
Content`
    );

    const result = await loadSkills([dir1, dir2]);

    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0].meta.description).toBe("Version from dir2");
    expect(result.loaded[0].location).toContain("dir2");
  });
});

describe("initializeSkills", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(TEST_BASE_DIR, `init-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should return skills and prompt blocks", async () => {
    const skillDir = join(testDir, "test-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, SKILL_FILENAME),
      `---
name: Test Skill
description: A test skill for testing
---

# Test Skill

Do things.`
    );

    const result = await initializeSkills([testDir]);

    expect(result.skills).toHaveLength(1);
    expect(result.promptBlock).toContain("<available_skills>");
    expect(result.promptBlock).toContain("test-skill");
    expect(result.promptBlock).toContain("A test skill for testing");
    expect(result.instruction).toContain("Skills (mandatory)");
  });

  it("should return empty prompt block for no skills", async () => {
    const result = await initializeSkills([testDir]);

    expect(result.skills).toHaveLength(0);
    expect(result.promptBlock).toBe("<available_skills />");
  });
});
