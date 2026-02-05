/**
 * Skill Context Factory
 * @see docs/architecture/skills-system.md Section 3.4
 *
 * MVP: Context uses native capabilities directly.
 * Future: Can be swapped to RPC proxy for containerized mode.
 */

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
    workspace: workspace ?? process.cwd(),
    callTool: callTool ?? notImplemented("callTool"),
    callSigner: callSigner ?? notImplemented("callSigner"),
    sendMessage: sendMessage ?? (async () => {}),
    askConfirmation: askConfirmation ?? (async () => false),
  };
}
