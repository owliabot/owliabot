import { parse } from "yaml";
import type { PersonaFrontmatter } from "./types.js";

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

export interface ParsedPersonaFile {
  frontmatter: PersonaFrontmatter;
  body: string;
}

export function parsePersonaFile(content: string): ParsedPersonaFile {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }

  const rawYaml = match[1] ?? "";
  const parsed = parse(rawYaml) as Record<string, unknown> | null;
  const frontmatter = normalizeFrontmatter(parsed ?? {});
  const body = content.slice(match[0].length).trim();

  return { frontmatter, body };
}

function normalizeFrontmatter(raw: Record<string, unknown>): PersonaFrontmatter {
  return {
    schemaVersion: readString(raw.schema_version ?? raw.schemaVersion),
    id: readString(raw.id),
    name: readString(raw.name),
    role: readString(raw.role),
    mission: readString(raw.mission),
    tone: readStringArray(raw.tone),
    do: readStringArray(raw.do),
    dont: readStringArray(raw.dont),
    boundaries: readStringArray(raw.boundaries),
    tools: readStringArray(raw.tools),
    memoryPolicy: readString(raw.memory_policy ?? raw.memoryPolicy),
    notes: readStringArray(raw.notes),
  };
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : undefined;
  }

  return undefined;
}
