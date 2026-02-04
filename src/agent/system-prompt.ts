import type { WorkspaceFiles } from "../workspace/types.js";

export interface PromptContext {
  workspace: WorkspaceFiles;
  channel: string;
  timezone: string;
  model: string;
  /** Security boundary relies on this being provided by the caller. */
  chatType: "direct" | "group" | "channel";
  isHeartbeat?: boolean;
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const sections: string[] = [];

  // 1. Base role
  sections.push("You are a crypto-focused AI assistant running locally.");

  // 2. SOUL.md - Persona
  if (ctx.workspace.soul) {
    sections.push(`## Persona & Boundaries\n${ctx.workspace.soul}`);
  }

  // 3. IDENTITY.md - Identity
  if (ctx.workspace.identity) {
    sections.push(`## Identity\n${ctx.workspace.identity}`);
  }

  // 4. USER.md - User profile
  if (ctx.workspace.user) {
    sections.push(`## User Profile\n${ctx.workspace.user}`);
  }

  // 5. TOOLS.md - Tool usage notes
  if (ctx.workspace.tools) {
    sections.push(`## Tool Notes\n${ctx.workspace.tools}`);
  }

  // 6. MEMORY.md - Long-term memory
  // Security boundary: NEVER inject long-term memory into non-direct contexts.
  // (OpenClaw-style: MEMORY.md is private-only)
  const isNonDirect = ctx.chatType !== "direct";
  if (!isNonDirect && ctx.workspace.memory) {
    sections.push(`## Memory\n${ctx.workspace.memory}`);
  }

  // 7. Runtime info
  sections.push(`## Runtime
- Time: ${new Date().toISOString()}
- Timezone: ${ctx.timezone}
- Channel: ${ctx.channel}
- Model: ${ctx.model}
`);

  // 8. Heartbeat mode
  if (ctx.isHeartbeat && ctx.workspace.heartbeat) {
    sections.push(`## Heartbeat
Read the following checklist and execute it:

${ctx.workspace.heartbeat}

If nothing needs attention, reply: HEARTBEAT_OK
`);
  }

  return sections.join("\n\n");
}
