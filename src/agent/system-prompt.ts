import type { WorkspaceFiles } from "../workspace/types.js";
import type { SkillsInitResult } from "../skills/types.js";

export interface PromptContext {
  workspace: WorkspaceFiles;
  channel: string;
  timezone: string;
  model: string;
  /** Security boundary relies on this being provided by the caller. */
  chatType: "direct" | "group" | "channel";
  isHeartbeat?: boolean;
  /** Skills system result for prompt injection */
  skills?: SkillsInitResult;
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const sections: string[] = [];

  // 1. Base role
  sections.push("You are a crypto-focused AI assistant running locally.");

  // 2. AGENTS.md - Workspace guidance
  if (ctx.workspace.agents) {
    sections.push(`## Agent Guidelines\n${ctx.workspace.agents}`);
  }

  // 3. BOOTSTRAP.md - First-run setup
  if (ctx.workspace.bootstrap) {
    sections.push(`## Bootstrap\n${ctx.workspace.bootstrap}`);
  }

  // 4. SOUL.md - Persona
  if (ctx.workspace.soul) {
    sections.push(`## Persona & Boundaries\n${ctx.workspace.soul}`);
  }

  // 5. IDENTITY.md - Identity
  if (ctx.workspace.identity) {
    sections.push(`## Identity\n${ctx.workspace.identity}`);
  }

  // 6. USER.md - User profile
  if (ctx.workspace.user) {
    sections.push(`## User Profile\n${ctx.workspace.user}`);
  }

  // 7. TOOLS.md - Tool usage notes
  if (ctx.workspace.tools) {
    sections.push(`## Tool Notes\n${ctx.workspace.tools}`);
  }

  // 8. Config reference
  sections.push(
    "When updating configuration, refer to `config.example.yaml` in your workspace for field descriptions and defaults."
  );

  // 9. MEMORY.md - Long-term memory
  // Security boundary: NEVER inject long-term memory into non-direct contexts.
  // (OpenClaw-style: MEMORY.md is private-only)
  const isNonDirect = ctx.chatType !== "direct";
  if (!isNonDirect && ctx.workspace.memory) {
    sections.push(`## Memory\n${ctx.workspace.memory}`);
  }

  // 10. Skills
  if (ctx.skills && ctx.skills.skills.length > 0) {
    sections.push(ctx.skills.instruction);
    sections.push(ctx.skills.promptBlock);
  }

  // 11. Runtime info
  sections.push(`## Runtime
- Time: ${new Date().toISOString()}
- Timezone: ${ctx.timezone}
- Channel: ${ctx.channel}
- Model: ${ctx.model}
`);

  // 12. Heartbeat mode
  if (ctx.isHeartbeat && ctx.workspace.heartbeat) {
    sections.push(`## Heartbeat
Read the following checklist and execute it:

${ctx.workspace.heartbeat}

If nothing needs attention, reply: HEARTBEAT_OK
`);
  }

  return sections.join("\n\n");
}
