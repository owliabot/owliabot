/**
 * Skill Prompt Generation
 * Generates XML blocks and instructions for LLM system prompts
 */

import type { Skill } from "./types.js";

/**
 * Instruction for the LLM on how to use skills
 */
export const SKILLS_INSTRUCTION = `## Skills (mandatory)
Before replying: scan <available_skills> <description> entries.
- If exactly one skill clearly applies: read its SKILL.md at <location> with \`read\`, then follow it.
- If multiple could apply: choose the most specific one, then read/follow it.
- If none clearly apply: do not read any SKILL.md.
Constraints: never read more than one skill up front; only read after selecting.`;

/**
 * Escape special XML characters
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Format a single skill as XML
 */
function formatSkillXml(skill: Skill): string {
  const lines: string[] = [];
  lines.push(`  <skill id="${escapeXml(skill.id)}">`);
  lines.push(`    <name>${escapeXml(skill.meta.name)}</name>`);
  lines.push(`    <description>${escapeXml(skill.meta.description)}</description>`);
  lines.push(`    <location>${escapeXml(skill.location)}</location>`);
  if (skill.meta.version) {
    lines.push(`    <version>${escapeXml(skill.meta.version)}</version>`);
  }
  lines.push(`  </skill>`);
  return lines.join("\n");
}

/**
 * Format skills as XML block for system prompt
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) {
    return "<available_skills />";
  }

  const skillXmls = skills.map(formatSkillXml);
  return `<available_skills>\n${skillXmls.join("\n")}\n</available_skills>`;
}
