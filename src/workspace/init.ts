import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "../utils/logger.js";

const log = createLogger("workspace.init");

const BASE_TEMPLATE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "MEMORY.md",
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

  log.info(
    `Workspace init: ${workspacePath} (brandNew=${brandNew}, created=${createdFiles.length})`
  );

  return {
    workspacePath,
    templatesDir,
    brandNew,
    createdFiles,
    skippedFiles,
    wroteBootstrap,
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
