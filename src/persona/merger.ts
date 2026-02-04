import type { PersonaDocument, PersonaProfile } from "./types.js";

export class PersonaMerger {
  merge(documents: PersonaDocument[]): PersonaProfile {
    const merged: PersonaProfile = { sources: documents };
    const contentSegments: string[] = [];
    const notesSegments: string[] = [];

    for (const doc of documents) {
      const { frontmatter, body } = doc;

      merged.schemaVersion = takeOverride(merged.schemaVersion, frontmatter.schemaVersion);
      merged.id = takeOverride(merged.id, frontmatter.id);
      merged.name = takeOverride(merged.name, frontmatter.name);
      merged.role = takeOverride(merged.role, frontmatter.role);
      merged.mission = takeOverride(merged.mission, frontmatter.mission);
      merged.tone = takeOverride(merged.tone, frontmatter.tone);
      merged.memoryPolicy = takeOverride(merged.memoryPolicy, frontmatter.memoryPolicy);

      merged.do = mergeList(merged.do, frontmatter.do);
      merged.dont = mergeList(merged.dont, frontmatter.dont);
      merged.boundaries = mergeList(merged.boundaries, frontmatter.boundaries);

      merged.tools = mergeTools(merged.tools, frontmatter.tools);

      if (frontmatter.notes && frontmatter.notes.length > 0) {
        notesSegments.push(...frontmatter.notes);
      }

      if (doc.kind === "notes" && body.length > 0) {
        notesSegments.push(body);
      }

      if (body.length > 0 && doc.kind !== "notes") {
        contentSegments.push(body);
      }
    }

    if (contentSegments.length > 0) {
      merged.content = contentSegments.join("\n\n");
    }

    if (notesSegments.length > 0) {
      merged.notes = dedupe(notesSegments);
    }

    return merged;
  }
}

function takeOverride<T>(current: T | undefined, next: T | undefined): T | undefined {
  return next !== undefined ? next : current;
}

function mergeList(current: string[] | undefined, next: string[] | undefined): string[] | undefined {
  if (!current && !next) {
    return undefined;
  }
  const combined = [...(current ?? []), ...(next ?? [])];
  return dedupe(combined);
}

function mergeTools(
  current: string[] | undefined,
  next: string[] | undefined
): string[] | undefined {
  if (!current && !next) {
    return undefined;
  }
  if (!current) {
    return next ? dedupe(next) : undefined;
  }
  if (!next) {
    return dedupe(current);
  }
  const nextSet = new Set(next);
  const intersection = current.filter((tool) => nextSet.has(tool));
  return dedupe(intersection);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}
