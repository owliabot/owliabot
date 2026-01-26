/**
 * Skill Context Factory
 * @see docs/architecture/skills-system.md Section 3.4
 *
 * MVP: Context uses native capabilities directly.
 * Future: Can be swapped to RPC proxy for containerized mode.
 */

import type { SkillContext } from "./types.js";

export interface CreateContextOptions {
  skillName: string;
  toolName: string;
  callId: string;
  userId: string;
  channel: string;
  requiredEnv: string[];
}

export function createSkillContext(options: CreateContextOptions): SkillContext {
  const { skillName, toolName, callId, userId, channel, requiredEnv } = options;

  // Filter env vars to only those declared in requires.env
  const env: Record<string, string> = {};
  for (const key of requiredEnv) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

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
  };
}
