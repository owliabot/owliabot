/**
 * Skill Loader
 * @see docs/architecture/skills-system.md Section 4
 */

import { readdir, access, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { createLogger } from "../utils/logger.js";
import { skillManifestSchema, type SkillManifest, type SkillModule, type LoadedSkill } from "./types.js";

const log = createLogger("skills");

/**
 * Scan a directory for skill subdirectories (those containing package.json)
 */
export async function scanSkillsDirectory(skillsDir: string): Promise<string[]> {
  try {
    await access(skillsDir);
  } catch {
    log.warn(`Skills directory does not exist: ${skillsDir}`);
    return [];
  }

  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skillPaths: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillPath = join(skillsDir, entry.name);
    const packagePath = join(skillPath, "package.json");

    try {
      await access(packagePath);
      skillPaths.push(skillPath);
    } catch {
      // No package.json, skip
      log.debug(`Skipping ${entry.name}: no package.json`);
    }
  }

  return skillPaths;
}

/**
 * Parse and validate a skill's package.json
 */
export async function parseSkillManifest(skillPath: string): Promise<SkillManifest> {
  const packagePath = join(skillPath, "package.json");
  const content = await readFile(packagePath, "utf-8");
  const json = JSON.parse(content);

  const result = skillManifestSchema.safeParse(json);
  if (!result.success) {
    const errors = result.error.format();
    throw new Error(`Invalid skill manifest at ${packagePath}: ${JSON.stringify(errors)}`);
  }

  return result.data;
}

/**
 * Dynamically import a skill module
 * Uses cache buster to support hot reload
 */
export async function loadSkillModule(
  skillPath: string,
  mainFile: string
): Promise<SkillModule> {
  const modulePath = join(skillPath, mainFile);
  const moduleUrl = pathToFileURL(modulePath).href;

  // Add cache buster for hot reload support
  const cacheBuster = Date.now();
  const urlWithBuster = `${moduleUrl}?v=${cacheBuster}`;

  const module = await import(urlWithBuster);

  if (!module.tools || typeof module.tools !== "object") {
    throw new Error(`Skill module at ${modulePath} must export a 'tools' object`);
  }

  return { tools: module.tools };
}

export interface LoadSkillsResult {
  loaded: LoadedSkill[];
  failed: Array<{ name: string; error: string }>;
}

/**
 * Load all skills from a directory
 */
export async function loadSkills(skillsDir: string): Promise<LoadSkillsResult> {
  const result: LoadSkillsResult = {
    loaded: [],
    failed: [],
  };

  const skillPaths = await scanSkillsDirectory(skillsDir);

  for (const skillPath of skillPaths) {
    const skillName = basename(skillPath);

    try {
      const manifest = await parseSkillManifest(skillPath);
      const module = await loadSkillModule(skillPath, manifest.main);

      result.loaded.push({
        manifest,
        module,
        path: skillPath,
      });

      log.info(`Loaded skill: ${manifest.name}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      result.failed.push({ name: skillName, error });
      log.error(`Failed to load skill ${skillName}: ${error}`);
    }
  }

  return result;
}
