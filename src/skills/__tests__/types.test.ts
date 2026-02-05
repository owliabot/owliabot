// src/skills/__tests__/types.test.ts
import { describe, it, expect } from "vitest";
import type { Skill, SkillMeta, SkillsInitResult, LoadSkillsResult, ParsedFrontmatter } from "../types.js";

describe("Skill types", () => {
  it("should allow valid Skill structure", () => {
    const skill: Skill = {
      id: "test-skill",
      meta: {
        name: "Test Skill",
        description: "A test skill",
        version: "1.0.0",
      },
      location: "/path/to/SKILL.md",
    };

    expect(skill.id).toBe("test-skill");
    expect(skill.meta.name).toBe("Test Skill");
    expect(skill.location).toContain("SKILL.md");
  });

  it("should allow SkillMeta without optional fields", () => {
    const meta: SkillMeta = {
      name: "Minimal Skill",
      description: "Just required fields",
    };

    expect(meta.version).toBeUndefined();
    expect(meta.metadata).toBeUndefined();
  });

  it("should allow SkillMeta with metadata", () => {
    const meta: SkillMeta = {
      name: "Rich Skill",
      description: "Has metadata",
      version: "1.0.0",
      metadata: {
        openclaw: {
          emoji: "🚀",
          requires: { config: ["channels.discord"] },
        },
      },
    };

    expect(meta.metadata).toBeDefined();
    expect((meta.metadata as any).openclaw.emoji).toBe("🚀");
  });

  it("should allow valid SkillsInitResult structure", () => {
    const result: SkillsInitResult = {
      skills: [],
      promptBlock: "<available_skills />",
      instruction: "## Skills\nInstructions here.",
    };

    expect(result.skills).toHaveLength(0);
    expect(result.promptBlock).toContain("available_skills");
    expect(result.instruction).toContain("Skills");
  });

  it("should allow valid LoadSkillsResult structure", () => {
    const result: LoadSkillsResult = {
      loaded: [
        {
          id: "skill-1",
          meta: { name: "Skill 1", description: "First" },
          location: "/path/1/SKILL.md",
        },
      ],
      failed: [
        { id: "skill-2", error: "Missing description" },
      ],
    };

    expect(result.loaded).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("description");
  });

  it("should allow valid ParsedFrontmatter structure", () => {
    const parsed: ParsedFrontmatter = {
      data: {
        name: "Test",
        description: "A test",
        custom: { nested: true },
      },
      content: "# Content\n\nBody here.",
    };

    expect(parsed.data.name).toBe("Test");
    expect(parsed.content).toContain("# Content");
  });
});
