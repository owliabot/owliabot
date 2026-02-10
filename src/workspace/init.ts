import { access, mkdir, readFile, writeFile, readdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "../utils/logger.js";

type LoggerLike = {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

const defaultLog = createLogger("workspace.init");
const silentLog: LoggerLike = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const BASE_TEMPLATE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "MEMORY.md",
  "BOOT.md",
  "policy.yml",
] as const;

const BOOTSTRAP_FILENAME = "BOOTSTRAP.md";

export interface WorkspaceInitOptions {
  workspacePath: string;
  templatesDir?: string;
  /**
   * Suppress logger output. Useful for interactive onboarding flows where
   * log-style output would feel like "computer noise".
   */
  quiet?: boolean;
}

export interface WorkspaceInitResult {
  workspacePath: string;
  templatesDir: string;
  brandNew: boolean;
  createdFiles: string[];
  skippedFiles: string[];
  wroteBootstrap: boolean;
  copiedSkills: boolean;
  skillsDir?: string;
}

export async function ensureWorkspaceInitialized(
  options: WorkspaceInitOptions
): Promise<WorkspaceInitResult> {
  const log = options.quiet ? silentLog : defaultLog;
  const workspacePath = resolve(options.workspacePath);
  const templatesDir = resolveTemplatesDir(options.templatesDir);

  await mkdir(workspacePath, { recursive: true });
  await mkdir(join(workspacePath, "memory"), { recursive: true });

  const existing = await Promise.all(
    BASE_TEMPLATE_FILES.map((name) => pathExists(join(workspacePath, name)))
  );
  const brandNew = existing.every((value) => !value);

  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const name of BASE_TEMPLATE_FILES) {
    await writeTemplateIfMissing({
      targetDir: workspacePath,
      templatesDir,
      filename: name,
      createdFiles,
      skippedFiles,
    });
  }

  let wroteBootstrap = false;
  if (brandNew) {
    const before = createdFiles.length;
    await writeTemplateIfMissing({
      targetDir: workspacePath,
      templatesDir,
      filename: BOOTSTRAP_FILENAME,
      createdFiles,
      skippedFiles,
    });
    wroteBootstrap = createdFiles.length > before;
  }

  // Copy bundled skills to workspace
  const result = await copyBundledSkills(workspacePath, log);
  const copiedSkills = result.copied;
  const skillsDir = result.skillsDir;

  log.info(
    `Workspace init: ${workspacePath} (brandNew=${brandNew}, created=${createdFiles.length}, copiedSkills=${copiedSkills})`
  );

  return {
    workspacePath,
    templatesDir,
    brandNew,
    createdFiles,
    skippedFiles,
    wroteBootstrap,
    copiedSkills,
    skillsDir,
  };
}

function resolveTemplatesDir(override?: string): string {
  if (override) {
    return resolve(override);
  }

  const cwdTemplates = resolve(process.cwd(), "persona/templates");
  if (existsSync(cwdTemplates)) {
    return cwdTemplates;
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, "../../persona/templates");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeTemplateIfMissing(params: {
  targetDir: string;
  templatesDir: string;
  filename: string;
  createdFiles: string[];
  skippedFiles: string[];
}): Promise<void> {
  const targetPath = join(params.targetDir, params.filename);
  if (await pathExists(targetPath)) {
    params.skippedFiles.push(params.filename);
    return;
  }

  const templatePath = join(params.templatesDir, params.filename);
  const template = await readFile(templatePath, "utf-8");
  await writeFile(targetPath, template, "utf-8");
  params.createdFiles.push(params.filename);
}

/**
 * Resolve bundled skills directory
 * Similar to resolveTemplatesDir, checks multiple locations
 */
function resolveBundledSkillsDir(): string | undefined {
  // Check cwd first (for dev mode)
  const cwdSkills = resolve(process.cwd(), "skills");
  if (existsSync(cwdSkills)) {
    return cwdSkills;
  }

  // Check relative to module (for installed package)
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const moduleSkills = resolve(moduleDir, "../../skills");
  if (existsSync(moduleSkills)) {
    return moduleSkills;
  }

  return undefined;
}

/**
 * Copy bundled skills to workspace directory
 * @param workspacePath - Workspace root directory
 * @returns Object with copied status and target skills directory
 */
async function copyBundledSkills(
  workspacePath: string,
  log: LoggerLike,
): Promise<{
  copied: boolean;
  skillsDir?: string;
}> {
  const targetSkillsDir = join(workspacePath, "skills");

  // Skip if skills directory already exists
  if (await pathExists(targetSkillsDir)) {
    log.debug(`Skills directory already exists: ${targetSkillsDir}`);
    return { copied: false, skillsDir: targetSkillsDir };
  }

  // Find bundled skills
  const bundledSkillsDir = resolveBundledSkillsDir();
  if (!bundledSkillsDir) {
    log.warn("Bundled skills directory not found, skipping skills copy");
    return { copied: false };
  }

  try {
    // Copy the entire skills directory
    await cp(bundledSkillsDir, targetSkillsDir, { recursive: true });
    log.info(`Copied bundled skills to: ${targetSkillsDir}`);
    return { copied: true, skillsDir: targetSkillsDir };
  } catch (err) {
    log.error(`Failed to copy skills: ${err instanceof Error ? err.message : String(err)}`);
    return { copied: false };
  }
}
