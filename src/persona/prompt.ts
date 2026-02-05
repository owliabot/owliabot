import type { PersonaProfile, PersonaPromptSection } from "./types.js";

export interface PersonaPromptOptions {
  title?: string;
}

export function buildPersonaPromptSection(
  persona: PersonaProfile,
  options: PersonaPromptOptions = {}
): PersonaPromptSection {
  const title = options.title ?? "Persona";
  const lines: string[] = [];

  if (persona.name) {
    lines.push(`Name: ${persona.name}`);
  }
  if (persona.role) {
    lines.push(`Role: ${persona.role}`);
  }
  if (persona.mission) {
    lines.push(`Mission: ${persona.mission}`);
  }
  if (persona.tone && persona.tone.length > 0) {
    lines.push(`Tone: ${persona.tone.join(", ")}`);
  }

  if (persona.do && persona.do.length > 0) {
    lines.push("Do:");
    lines.push(formatList(persona.do));
  }

  if (persona.dont && persona.dont.length > 0) {
    lines.push("Dont:");
    lines.push(formatList(persona.dont));
  }

  if (persona.boundaries && persona.boundaries.length > 0) {
    lines.push("Boundaries:");
    lines.push(formatList(persona.boundaries));
  }

  if (persona.tools && persona.tools.length > 0) {
    lines.push("Tools:");
    lines.push(formatList(persona.tools));
  }

  if (persona.memoryPolicy) {
    lines.push(`Memory Policy: ${persona.memoryPolicy}`);
  }

  if (persona.content) {
    lines.push(persona.content);
  }

  if (persona.notes && persona.notes.length > 0) {
    lines.push("Notes:");
    lines.push(formatList(persona.notes));
  }

  return {
    title,
    content: lines.join("\n"),
  };
}

export function renderPersonaPromptSection(section: PersonaPromptSection): string {
  return `## ${section.title}\n${section.content}`;
}

function formatList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}
