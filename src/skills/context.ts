/**
 * Skill Context Factory
 * @see docs/architecture/skills-system.md Section 3.4
 *
 * MVP: Context uses native capabilities directly.
 * Future: Can be swapped to RPC proxy for containerized mode.
 */

import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import type { SkillContext, SignerResult, ToolResult } from "./types.js";

export interface CreateContextOptions {
  skillName: string;
  toolName: string;
  callId: string;
  userId: string;
  channel: string;
  requiredEnv: string[];
  workspace?: string;
  // Optional: injected by ToolRouter/SignerRouter when available
  callTool?: (name: string, args: unknown) => Promise<ToolResult>;
  callSigner?: (operation: string, params: unknown) => Promise<SignerResult>;
  sendMessage?: (text: string) => Promise<void>;
  askConfirmation?: (prompt: string) => Promise<boolean>;
}

export function createSkillContext(options: CreateContextOptions): SkillContext {
  const {
    skillName,
    toolName,
    callId,
    userId,
    channel,
    requiredEnv,
    workspace,
    callTool,
    callSigner,
    sendMessage,
    askConfirmation,
  } = options;

  // Filter env vars to only those declared in requires.env
  const env: Record<string, string> = {};
  for (const key of requiredEnv) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  // Default stubs for callbacks not yet wired
  const notImplemented = (name: string) => () => {
    throw new Error(`${name} not available in this context`);
  };

  const workspacePath = workspace ?? process.cwd();

  // Sandboxed file I/O: ensure path is within workspace
  const resolveSafePath = (path: string): string => {
    const resolved = resolve(workspacePath, path);
    const rel = relative(workspacePath, resolved);
    // Block path traversal (paths starting with .. or absolute paths outside workspace)
    if (rel.startsWith("..") || resolve(resolved) !== resolved) {
      throw new Error(`Path escapes workspace: ${path}`);
    }
    return resolved;
  };

  return {
    env,
    fetch: globalThis.fetch,
    meta: {
      skillName,
      toolName,
      callId,
      userId,
      channel,
    },
    workspace: workspacePath,
    readFile: async (path: string) => {
      const safePath = resolveSafePath(path);
      return fsReadFile(safePath, "utf-8");
    },
    writeFile: async (path: string, content: string) => {
      const safePath = resolveSafePath(path);
      // Ensure parent directory exists
      await mkdir(dirname(safePath), { recursive: true });
      return fsWriteFile(safePath, content, "utf-8");
    },
    callTool: callTool ?? notImplemented("callTool"),
    callSigner: callSigner ?? notImplemented("callSigner"),
    sendMessage: sendMessage ?? (async () => {}),
    askConfirmation: askConfirmation ?? (async () => false),
  };
}
