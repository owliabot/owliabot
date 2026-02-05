/**
 * Skill Loader (Markdown-based)
 * @see docs/architecture/skills-system.md
 */

import { readdir, readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import yaml from "yaml";
import { createLogger } from "../utils/logger.js";
import type { Skill, SkillMeta, LoadSkillsResult, ParsedFrontmatter } from "./types.js";

const log = createLogger("skills");

/** Filename for skill definitions */
export const SKILL_FILENAME = "SKILL.md";

/** Regex to parse YAML frontmatter (handles empty frontmatter too) */
const FRONTMATTER_REGEX = /^---[ \t]*\n([\s\S]*?)^---[ \t]*(?:\n)?([\s\S]*)$/m;

/**
 * Parse YAML frontmatter from markdown content
 */
export function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return null;
  }

  const [, yamlPart, contentPart] = match;
  try {
    const data = yaml.parse(yamlPart) as Record<string, unknown>;
    return {
      data: data ?? {},
      content: contentPart,
    };
  } catch (err) {
    log.warn(`Failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Validate and extract SkillMeta from parsed frontmatter
 */
function extractMeta(data: Record<string, unknown>, id: string): SkillMeta {
  const name = typeof data.name === "string" ? data.name : id;
  const description = typeof data.description === "string" ? data.description : "";
  const version = typeof data.version === "string" ? data.version : undefined;
  const metadata = typeof data.metadata === "object" && data.metadata !== null
    ? data.metadata as Record<string, unknown>
    : undefined;

  return { name, description, version, metadata };
}

/**
 * Load skills from a single directory
 * Each subdirectory containing SKILL.md is treated as a skill
 */
export async function loadSkillsFromDir(dir: string): Promise<LoadSkillsResult> {
  const result: LoadSkillsResult = {
    loaded: [],
    failed: [],
  };

  // Check if directory exists
  try {
    await access(dir);
  } catch {
    log.debug(`Skills directory does not exist: ${dir}`);
    return result;
  }

  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillId = entry.name;
    const skillDir = join(dir, skillId);
    const skillPath = join(skillDir, SKILL_FILENAME);

    try {
      await access(skillPath);
    } catch {
      // No SKILL.md, skip silently
      continue;
    }

    try {
      const content = await readFile(skillPath, "utf-8");
      const parsed = parseFrontmatter(content);

      if (!parsed) {
        result.failed.push({
          id: skillId,
          error: "Missing or invalid YAML frontmatter",
        });
        continue;
      }

      const meta = extractMeta(parsed.data, skillId);

      // Require at least a description
      if (!meta.description) {
        result.failed.push({
          id: skillId,
          error: "Missing 'description' in frontmatter",
        });
        continue;
      }

      result.loaded.push({
        id: skillId,
        meta,
        location: resolve(skillPath),
      });

      log.debug(`Loaded skill: ${meta.name} (${skillId})`);
    } catch (err) {
      result.failed.push({
        id: skillId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * Load skills from multiple directories
 * Later directories override earlier ones (by skill id)
 */
export async function loadSkills(dirs: string[]): Promise<LoadSkillsResult> {
  const skillsById = new Map<string, Skill>();
  const allFailed: Array<{ id: string; error: string }> = [];

  for (const dir of dirs) {
    const result = await loadSkillsFromDir(dir);

    // Merge loaded skills (later overrides earlier)
    for (const skill of result.loaded) {
      skillsById.set(skill.id, skill);
    }

    // Collect failures
    allFailed.push(...result.failed);
  }

  return {
    loaded: Array.from(skillsById.values()),
    failed: allFailed,
  };
}
