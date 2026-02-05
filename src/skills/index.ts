/**
 * Skills System Entry Point (Markdown-based)
 * @see docs/architecture/skills-system.md
 */

export { loadSkills, loadSkillsFromDir, parseFrontmatter, SKILL_FILENAME } from "./loader.js";
export { formatSkillsForPrompt, escapeXml, SKILLS_INSTRUCTION } from "./prompt.js";
export type {
  Skill,
  SkillMeta,
  SkillsInitResult,
  LoadSkillsResult,
  ParsedFrontmatter,
} from "./types.js";

import { createLogger } from "../utils/logger.js";
import { loadSkills } from "./loader.js";
import { formatSkillsForPrompt, SKILLS_INSTRUCTION } from "./prompt.js";
import type { SkillsInitResult } from "./types.js";

const log = createLogger("skills");

/**
 * Initialize skills system from one or more directories
 * @param dirs - Directories to load skills from (later overrides earlier)
 * @returns Skills and prompt blocks for system prompt injection
 */
export async function initializeSkills(dirs: string[]): Promise<SkillsInitResult> {
  log.info(`Loading skills from ${dirs.length} director${dirs.length === 1 ? "y" : "ies"}`);

  const result = await loadSkills(dirs);

  // Log summary
  log.info(
    `Skills loaded: ${result.loaded.length} success, ${result.failed.length} failed`
  );

  if (result.failed.length > 0) {
    for (const { id, error } of result.failed) {
      log.warn(`  - ${id}: ${error}`);
    }
  }

  // Generate prompt blocks
  const promptBlock = formatSkillsForPrompt(result.loaded);

  return {
    skills: result.loaded,
    promptBlock,
    instruction: SKILLS_INSTRUCTION,
  };
}
