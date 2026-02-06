// src/gateway/skills-init.ts
/**
 * Skills initialization module.
 * Handles bundled skills directory resolution and multi-directory loading.
 */

import { createLogger } from "../utils/logger.js";
import { initializeSkills, type SkillsInitResult } from "../skills/index.js";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const log = createLogger("gateway:skills");

/**
 * Configuration for skills initialization.
 */
export interface SkillsInitConfig {
  /** Whether skills are enabled (default: true) */
  enabled?: boolean;
  /** Explicit skills directory from config */
  directory?: string;
  /** Workspace root path for workspace skills lookup */
  workspace: string;
}

/**
 * Resolve bundled skills directory.
 * Checks multiple candidate paths and returns the first that exists.
 * 
 * Search order:
 * 1. OWLIABOT_BUNDLED_SKILLS_DIR environment variable
 * 2. Relative to module location (handles src/, dist/, etc.)
 * 3. Relative to cwd (dev mode)
 * 4. Common install locations (~/.owliabot/bundled-skills)
 * 
 * @returns Path to bundled skills directory, or undefined if not found
 * 
 * @example
 * ```ts
 * const bundledDir = resolveBundledSkillsDir();
 * if (bundledDir) {
 *   console.log(`Bundled skills at: ${bundledDir}`);
 * }
 * ```
 */
export function resolveBundledSkillsDir(): string | undefined {
  const candidates: string[] = [];

  // 1. Environment variable override
  const override = process.env.OWLIABOT_BUNDLED_SKILLS_DIR?.trim();
  if (override) {
    candidates.push(override);
  }

  // 2. Resolve from module location: walk up to find package root with skills/
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    // Try multiple levels up (handles src/, dist/, dist/gateway/, etc.)
    for (const levels of [
      "../..",
      "../../..",
      "../../../..",
      "../../../../..",
    ]) {
      candidates.push(resolve(moduleDir, levels, "skills"));
    }
  } catch (err) {
    // Log but continue with other candidates
    log.debug(`import.meta.url resolution failed: ${err}`);
  }

  // 3. Try relative to cwd (for dev mode and some install scenarios)
  candidates.push(resolve(process.cwd(), "skills"));

  // 4. Try common install locations
  const homeDir = process.env.HOME ?? process.env.USERPROFILE;
  if (homeDir) {
    candidates.push(resolve(homeDir, ".owliabot", "bundled-skills"));
  }

  // Find first existing directory
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      log.debug(`Found bundled skills at: ${candidate}`);
      return candidate;
    }
  }

  log.debug(`No bundled skills directory found. Tried: ${candidates.join(", ")}`);
  return undefined;
}

/**
 * Collects all skills directories in priority order.
 * Later directories override earlier ones (workspace > user > bundled).
 * 
 * @param config - Skills configuration
 * @returns Array of existing skills directories
 */
export function collectSkillsDirs(config: SkillsInitConfig): string[] {
  const dirs: string[] = [];

  // 1. Bundled skills (lowest priority)
  const builtinSkillsDir = resolveBundledSkillsDir();
  if (builtinSkillsDir) {
    dirs.push(builtinSkillsDir);
    log.debug(`Skills: using bundled dir: ${builtinSkillsDir}`);
  } else {
    log.warn("Skills: bundled skills directory not found");
  }

  // 2. User home skills
  const userSkillsDir = join(homedir(), ".owliabot", "skills");
  if (existsSync(userSkillsDir)) {
    dirs.push(userSkillsDir);
    log.debug(`Skills: using user dir: ${userSkillsDir}`);
  }

  // 3. Workspace skills (highest priority)
  const workspaceSkillsDir = config.directory ?? join(config.workspace, "skills");
  if (existsSync(workspaceSkillsDir)) {
    dirs.push(workspaceSkillsDir);
    log.debug(`Skills: using workspace dir: ${workspaceSkillsDir}`);
  }

  return dirs;
}

/**
 * Loads skills from all configured directories.
 * Uses multi-directory loading where later directories override earlier.
 * 
 * @param config - Skills configuration
 * @returns Skills initialization result, or null if disabled/no directories
 * 
 * @example
 * ```ts
 * const skillsResult = await loadSkills({
 *   enabled: true,
 *   workspace: config.workspace,
 * });
 * ```
 */
export async function loadSkills(
  config: SkillsInitConfig
): Promise<SkillsInitResult | null> {
  if (config.enabled === false) {
    log.debug("Skills loading disabled");
    return null;
  }

  const skillsDirs = collectSkillsDirs(config);
  
  if (skillsDirs.length === 0) {
    log.warn("No skills directories found");
    return null;
  }

  log.info(`Skills: loading from ${skillsDirs.length} directories`);
  const result = await initializeSkills(skillsDirs);
  
  return result;
}
