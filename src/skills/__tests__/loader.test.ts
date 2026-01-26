// src/skills/__tests__/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  scanSkillsDirectory,
  parseSkillManifest,
  loadSkillModule,
  loadSkills,
} from "../loader.js";
import { initializeSkills } from "../index.js";
import { ToolRegistry } from "../../agent/tools/registry.js";

const TEST_SKILLS_DIR = join(process.cwd(), "test-skills-tmp");

describe("scanSkillsDirectory", () => {
  beforeEach(async () => {
    await mkdir(TEST_SKILLS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_SKILLS_DIR, { recursive: true, force: true });
  });

  it("should find skill directories with package.json", async () => {
    // Create test skill directory
    const skillDir = join(TEST_SKILLS_DIR, "test-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "test-skill",
        version: "0.1.0",
        owliabot: { tools: [] },
      })
    );

    const skills = await scanSkillsDirectory(TEST_SKILLS_DIR);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toBe(skillDir);
  });

  it("should skip directories without package.json", async () => {
    const skillDir = join(TEST_SKILLS_DIR, "invalid-skill");
    await mkdir(skillDir);
    // No package.json

    const skills = await scanSkillsDirectory(TEST_SKILLS_DIR);

    expect(skills).toHaveLength(0);
  });

  it("should return empty array if directory does not exist", async () => {
    const skills = await scanSkillsDirectory("/nonexistent/path");

    expect(skills).toEqual([]);
  });
});

describe("parseSkillManifest", () => {
  beforeEach(async () => {
    await mkdir(TEST_SKILLS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_SKILLS_DIR, { recursive: true, force: true });
  });

  it("should parse valid package.json with owliabot field", async () => {
    const skillDir = join(TEST_SKILLS_DIR, "valid-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "valid-skill",
        version: "1.0.0",
        description: "A test skill",
        main: "index.js",
        owliabot: {
          requires: { env: ["API_KEY"] },
          tools: [
            {
              name: "test_tool",
              description: "Test tool",
              parameters: {
                type: "object",
                properties: { input: { type: "string" } },
                required: ["input"],
              },
              security: { level: "read" },
            },
          ],
        },
      })
    );

    const manifest = await parseSkillManifest(skillDir);

    expect(manifest.name).toBe("valid-skill");
    expect(manifest.owliabot.tools).toHaveLength(1);
    expect(manifest.owliabot.requires?.env).toEqual(["API_KEY"]);
  });

  it("should throw on invalid manifest", async () => {
    const skillDir = join(TEST_SKILLS_DIR, "invalid-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "invalid-skill",
        // Missing owliabot field
      })
    );

    await expect(parseSkillManifest(skillDir)).rejects.toThrow();
  });
});

describe("loadSkillModule", () => {
  beforeEach(async () => {
    await mkdir(TEST_SKILLS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_SKILLS_DIR, { recursive: true, force: true });
  });

  it("should load skill module with tools export", async () => {
    const skillDir = join(TEST_SKILLS_DIR, "loadable-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "loadable-skill",
        version: "0.1.0",
        main: "index.js",
        owliabot: { tools: [] },
      })
    );
    await writeFile(
      join(skillDir, "index.js"),
      `export const tools = {
        test_tool: async (params, context) => {
          return { success: true, data: { input: params.input } };
        }
      };`
    );

    const module = await loadSkillModule(skillDir, "index.js");

    expect(module.tools).toBeDefined();
    expect(typeof module.tools.test_tool).toBe("function");
  });

  it("should throw if module has no tools export", async () => {
    const skillDir = join(TEST_SKILLS_DIR, "no-tools-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "no-tools-skill",
        version: "0.1.0",
        owliabot: { tools: [] },
      })
    );
    await writeFile(join(skillDir, "index.js"), `export const foo = "bar";`);

    await expect(loadSkillModule(skillDir, "index.js")).rejects.toThrow(
      "must export a 'tools' object"
    );
  });
});

describe("loadSkills", () => {
  beforeEach(async () => {
    await mkdir(TEST_SKILLS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_SKILLS_DIR, { recursive: true, force: true });
  });

  it("should load all valid skills from directory", async () => {
    // Create skill 1
    const skill1Dir = join(TEST_SKILLS_DIR, "skill-one");
    await mkdir(skill1Dir);
    await writeFile(
      join(skill1Dir, "package.json"),
      JSON.stringify({
        name: "skill-one",
        version: "0.1.0",
        owliabot: {
          tools: [
            {
              name: "tool_a",
              description: "Tool A",
              parameters: { type: "object", properties: {} },
              security: { level: "read" },
            },
          ],
        },
      })
    );
    await writeFile(
      join(skill1Dir, "index.js"),
      `export const tools = { tool_a: async () => ({ success: true }) };`
    );

    // Create skill 2
    const skill2Dir = join(TEST_SKILLS_DIR, "skill-two");
    await mkdir(skill2Dir);
    await writeFile(
      join(skill2Dir, "package.json"),
      JSON.stringify({
        name: "skill-two",
        version: "0.1.0",
        owliabot: {
          tools: [
            {
              name: "tool_b",
              description: "Tool B",
              parameters: { type: "object", properties: {} },
              security: { level: "read" },
            },
          ],
        },
      })
    );
    await writeFile(
      join(skill2Dir, "index.js"),
      `export const tools = { tool_b: async () => ({ success: true }) };`
    );

    const result = await loadSkills(TEST_SKILLS_DIR);

    expect(result.loaded).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    expect(result.loaded.map((s) => s.manifest.name).sort()).toEqual([
      "skill-one",
      "skill-two",
    ]);
  });

  it("should report failed skills without crashing", async () => {
    // Create valid skill
    const validDir = join(TEST_SKILLS_DIR, "valid");
    await mkdir(validDir);
    await writeFile(
      join(validDir, "package.json"),
      JSON.stringify({
        name: "valid",
        version: "0.1.0",
        owliabot: { tools: [] },
      })
    );
    await writeFile(join(validDir, "index.js"), `export const tools = {};`);

    // Create invalid skill (bad manifest)
    const invalidDir = join(TEST_SKILLS_DIR, "invalid");
    await mkdir(invalidDir);
    await writeFile(
      join(invalidDir, "package.json"),
      JSON.stringify({ name: "invalid" }) // Missing owliabot
    );

    const result = await loadSkills(TEST_SKILLS_DIR);

    expect(result.loaded).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].name).toBe("invalid");
    expect(result.failed[0].error).toBeDefined();
  });
});

describe("initializeSkills", () => {
  beforeEach(async () => {
    await mkdir(TEST_SKILLS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_SKILLS_DIR, { recursive: true, force: true });
  });

  it("should register skill tools with the tool registry", async () => {
    const skillDir = join(TEST_SKILLS_DIR, "my-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "my-skill",
        version: "0.1.0",
        owliabot: {
          tools: [
            {
              name: "greet",
              description: "Greet someone",
              parameters: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
              security: { level: "read" },
            },
          ],
        },
      })
    );
    await writeFile(
      join(skillDir, "index.js"),
      `export const tools = {
        greet: async ({ name }) => ({ success: true, data: { message: "Hello " + name } })
      };`
    );

    const registry = new ToolRegistry();
    const result = await initializeSkills(TEST_SKILLS_DIR, registry);

    expect(result.loaded).toHaveLength(1);
    expect(registry.get("my-skill:greet")).toBeDefined();
  });
});
