import { access, mkdir, readFile, writeFile, cp, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  copiedConfig: boolean;
}

export async function ensureWorkspaceInitialized(
  options: WorkspaceInitOptions
): Promise<WorkspaceInitResult> {
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
  const result = await copyBundledSkills(workspacePath);
  const copiedSkills = result.copied;
  const skillsDir = result.skillsDir;

  // Copy config.example.yaml as config.yaml
  const copiedConfig = await copyConfigExample(workspacePath);

  return {
    workspacePath,
    templatesDir,
    brandNew,
    createdFiles,
    skippedFiles,
    wroteBootstrap,
    copiedSkills,
    skillsDir,
    copiedConfig,
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
 * Resolve a file from cwd first, then relative to module dir.
 */
function resolveFromCwdOrModule(relativePath: string): string | undefined {
  const cwdPath = resolve(process.cwd(), relativePath);
  if (existsSync(cwdPath)) {
    return cwdPath;
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const modulePath = resolve(moduleDir, "../..", relativePath);
  if (existsSync(modulePath)) {
    return modulePath;
  }

  return undefined;
}

/**
 * Resolve bundled skills directory
 */
function resolveBundledSkillsDir(): string | undefined {
  return resolveFromCwdOrModule("skills");
}

/**
 * Copy bundled skills to workspace directory
 */
async function copyBundledSkills(workspacePath: string): Promise<{
  copied: boolean;
  skillsDir?: string;
}> {
  const targetSkillsDir = join(workspacePath, "skills");

  if (await pathExists(targetSkillsDir)) {
    return { copied: false, skillsDir: targetSkillsDir };
  }

  const bundledSkillsDir = resolveBundledSkillsDir();
  if (!bundledSkillsDir) {
    return { copied: false };
  }

  try {
    await cp(bundledSkillsDir, targetSkillsDir, { recursive: true });
    return { copied: true, skillsDir: targetSkillsDir };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[workspace] Failed to copy bundled skills (${bundledSkillsDir}) to workspace (${targetSkillsDir}): ${message}`
    );
    return { copied: false };
  }
}

/**
 * Copy config.example.yaml to workspace as config.yaml if it doesn't already exist.
 */
async function copyConfigExample(workspacePath: string): Promise<boolean> {
  const targetPath = join(workspacePath, "config.example.yaml");

  if (await pathExists(targetPath)) {
    return false;
  }

  const sourcePath = resolveFromCwdOrModule("config.example.yaml");
  if (!sourcePath) {
    return false;
  }

  try {
    await copyFile(sourcePath, targetPath);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[workspace] Failed to copy config.example.yaml: ${message}`);
    return false;
  }
}
