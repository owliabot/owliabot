/**
 * Skill Loader
 * @see docs/architecture/skills-system.md Section 4
 */

import { readdir, access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createLogger } from "../utils/logger.js";
import { skillManifestSchema, type SkillManifest, type SkillModule } from "./types.js";

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
