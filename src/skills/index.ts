// src/skills/index.ts
/**
 * Skills System Entry Point
 * @see docs/architecture/skills-system.md
 */

export { loadSkills, scanSkillsDirectory } from "./loader.js";
export { skillToToolDefinitions } from "./registry.js";
export { createSkillContext } from "./context.js";
export type {
  SkillManifest,
  SkillContext,
  SkillModule,
  LoadedSkill,
} from "./types.js";

import { createLogger } from "../utils/logger.js";
import type { ToolRegistry } from "../agent/tools/registry.js";
import { loadSkills, type LoadSkillsResult } from "./loader.js";
import { skillToToolDefinitions } from "./registry.js";

const log = createLogger("skills");

/**
 * Initialize skills system and register tools
 */
export async function initializeSkills(
  skillsDir: string,
  registry: ToolRegistry
): Promise<LoadSkillsResult> {
  log.info(`Loading skills from ${skillsDir}`);

  const result = await loadSkills(skillsDir);

  // Register tools from loaded skills
  for (const skill of result.loaded) {
    const tools = skillToToolDefinitions(skill);
    for (const tool of tools) {
      registry.register(tool);
    }
    log.info(`Registered ${tools.length} tools from skill: ${skill.manifest.name}`);
  }

  // Log summary
  log.info(
    `Skills loaded: ${result.loaded.length} success, ${result.failed.length} failed`
  );

  if (result.failed.length > 0) {
    for (const { name, error } of result.failed) {
      log.error(`  - ${name}: ${error}`);
    }
  }

  return result;
}
