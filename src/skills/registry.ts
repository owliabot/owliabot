/**
 * Skill Registry - Convert loaded skills to ToolDefinitions
 * @see docs/architecture/skills-system.md Section 4.4
 */

import { createLogger } from "../utils/logger.js";
import { createSkillContext } from "./context.js";
import type { LoadedSkill, SkillToolDef, SkillContext } from "./types.js";
import type { ToolDefinition, ToolContext, ToolResult } from "../agent/tools/interface.js";

const log = createLogger("skills");

/**
 * Convert a loaded skill to ToolDefinitions for the ToolRegistry
 * Tool names are namespaced: `skill-name:tool-name`
 */
export function skillToToolDefinitions(skill: LoadedSkill): ToolDefinition[] {
  const { manifest, module } = skill;
  const tools: ToolDefinition[] = [];

  for (const toolDef of manifest.owliabot.tools) {
    const toolFn = module.tools[toolDef.name];

    if (!toolFn) {
      log.warn(
        `Tool ${toolDef.name} declared in manifest but not exported by ${manifest.name}`
      );
      continue;
    }

    const fullName = `${manifest.name}:${toolDef.name}`;

    tools.push({
      name: fullName,
      description: toolDef.description,
      parameters: toolDef.parameters,
      security: toolDef.security,
      execute: createToolExecutor(skill, toolDef, toolFn),
    });
  }

  return tools;
}

function createToolExecutor(
  skill: LoadedSkill,
  toolDef: SkillToolDef,
  toolFn: (params: unknown, context: SkillContext) => Promise<unknown>
): ToolDefinition["execute"] {
  const { manifest } = skill;
  const requiredEnv = manifest.owliabot.requires?.env || [];
  const timeout = toolDef.timeout ?? 30_000;

  return async (params: unknown, ctx: ToolContext): Promise<ToolResult> => {
    const skillContext = createSkillContext({
      skillName: manifest.name,
      toolName: toolDef.name,
      callId: crypto.randomUUID(),
      userId: ctx.sessionKey,
      channel: ctx.sessionKey.split(":")[0] || "unknown",
      requiredEnv,
    });

    try {
      // Execute with timeout
      const result = await Promise.race([
        toolFn(params, skillContext),
        rejectAfter(timeout, `Skill execution timeout (${timeout}ms)`),
      ]);

      // Auto-wrap simple returns
      if (result && typeof result === "object" && !("success" in result)) {
        return { success: true, data: result };
      }

      return result as ToolResult;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}
