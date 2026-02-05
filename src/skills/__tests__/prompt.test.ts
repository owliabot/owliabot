// src/skills/__tests__/prompt.test.ts
import { describe, it, expect } from "vitest";
import { escapeXml, formatSkillsForPrompt, SKILLS_INSTRUCTION } from "../prompt.js";
import type { Skill } from "../types.js";

describe("escapeXml", () => {
  it("should escape ampersand", () => {
    expect(escapeXml("foo & bar")).toBe("foo &amp; bar");
  });

  it("should escape less than", () => {
    expect(escapeXml("a < b")).toBe("a &lt; b");
  });

  it("should escape greater than", () => {
    expect(escapeXml("a > b")).toBe("a &gt; b");
  });

  it("should escape double quotes", () => {
    expect(escapeXml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("should escape single quotes", () => {
    expect(escapeXml("it's")).toBe("it&apos;s");
  });

  it("should escape multiple special characters", () => {
    expect(escapeXml('<tag attr="value" & more>')).toBe(
      "&lt;tag attr=&quot;value&quot; &amp; more&gt;"
    );
  });

  it("should leave normal text unchanged", () => {
    expect(escapeXml("Hello World 123")).toBe("Hello World 123");
  });
});

describe("formatSkillsForPrompt", () => {
  it("should format empty skills array", () => {
    const result = formatSkillsForPrompt([]);
    expect(result).toBe("<available_skills />");
  });

  it("should format single skill", () => {
    const skills: Skill[] = [
      {
        id: "test-skill",
        meta: {
          name: "Test Skill",
          description: "A test skill",
        },
        location: "/path/to/test-skill/SKILL.md",
      },
    ];

    const result = formatSkillsForPrompt(skills);

    expect(result).toContain("<available_skills>");
    expect(result).toContain("</available_skills>");
    expect(result).toContain('<skill id="test-skill">');
    expect(result).toContain("<name>Test Skill</name>");
    expect(result).toContain("<description>A test skill</description>");
    expect(result).toContain("<location>/path/to/test-skill/SKILL.md</location>");
    expect(result).toContain("</skill>");
  });

  it("should format multiple skills", () => {
    const skills: Skill[] = [
      {
        id: "skill-a",
        meta: { name: "Skill A", description: "First skill" },
        location: "/path/a/SKILL.md",
      },
      {
        id: "skill-b",
        meta: { name: "Skill B", description: "Second skill", version: "2.0.0" },
        location: "/path/b/SKILL.md",
      },
    ];

    const result = formatSkillsForPrompt(skills);

    expect(result).toContain('<skill id="skill-a">');
    expect(result).toContain('<skill id="skill-b">');
    expect(result).toContain("<version>2.0.0</version>");
  });

  it("should escape special characters in skill data", () => {
    const skills: Skill[] = [
      {
        id: "special-skill",
        meta: {
          name: "Skill <with> & \"special\" 'chars'",
          description: "Description with <html> & stuff",
        },
        location: "/path/to/skill/SKILL.md",
      },
    ];

    const result = formatSkillsForPrompt(skills);

    expect(result).toContain("&lt;with&gt;");
    expect(result).toContain("&amp;");
    expect(result).toContain("&quot;special&quot;");
    expect(result).toContain("&apos;chars&apos;");
    expect(result).toContain("&lt;html&gt;");
  });

  it("should include version when present", () => {
    const skills: Skill[] = [
      {
        id: "versioned",
        meta: {
          name: "Versioned Skill",
          description: "Has a version",
          version: "1.2.3",
        },
        location: "/path/SKILL.md",
      },
    ];

    const result = formatSkillsForPrompt(skills);

    expect(result).toContain("<version>1.2.3</version>");
  });

  it("should omit version when not present", () => {
    const skills: Skill[] = [
      {
        id: "no-version",
        meta: {
          name: "No Version Skill",
          description: "No version field",
        },
        location: "/path/SKILL.md",
      },
    ];

    const result = formatSkillsForPrompt(skills);

    expect(result).not.toContain("<version>");
  });
});

describe("SKILLS_INSTRUCTION", () => {
  it("should contain key guidance", () => {
    expect(SKILLS_INSTRUCTION).toContain("Skills (mandatory)");
    expect(SKILLS_INSTRUCTION).toContain("<available_skills>");
    expect(SKILLS_INSTRUCTION).toContain("SKILL.md");
    expect(SKILLS_INSTRUCTION).toContain("read");
  });
});
