import type { PersonaDocument, PersonaProfile } from "./types.js";

export type PersonaMergeStrategy = "append" | "replace" | "intersect";

export interface PersonaMergerOptions {
  defaultListStrategy?: PersonaMergeStrategy;
  listStrategies?: Partial<
    Record<"do" | "dont" | "boundaries" | "tools", PersonaMergeStrategy>
  >;
}

export class PersonaMerger {
  private readonly options: PersonaMergerOptions;

  constructor(options: PersonaMergerOptions = {}) {
    this.options = options;
  }

  merge(documents: PersonaDocument[]): PersonaProfile {
    const merged: PersonaProfile = { sources: documents };
    const contentSegments: string[] = [];
    const notesSegments: string[] = [];
    const listStrategies = this.options.listStrategies ?? {};
    const defaultListStrategy = this.options.defaultListStrategy ?? "append";
    const doStrategy = listStrategies.do ?? defaultListStrategy;
    const dontStrategy = listStrategies.dont ?? defaultListStrategy;
    const boundariesStrategy = listStrategies.boundaries ?? defaultListStrategy;
    const toolsStrategy = listStrategies.tools ?? "intersect";

    for (const doc of documents) {
      const { frontmatter, body } = doc;

      merged.schemaVersion = takeOverride(merged.schemaVersion, frontmatter.schemaVersion);
      merged.id = takeOverride(merged.id, frontmatter.id);
      merged.name = takeOverride(merged.name, frontmatter.name);
      merged.role = takeOverride(merged.role, frontmatter.role);
      merged.mission = takeOverride(merged.mission, frontmatter.mission);
      merged.tone = takeOverride(merged.tone, frontmatter.tone);
      merged.memoryPolicy = takeOverride(merged.memoryPolicy, frontmatter.memoryPolicy);

      merged.do = mergeList(merged.do, frontmatter.do, doStrategy);
      merged.dont = mergeList(merged.dont, frontmatter.dont, dontStrategy);
      merged.boundaries = mergeList(
        merged.boundaries,
        frontmatter.boundaries,
        boundariesStrategy
      );

      merged.tools = mergeList(merged.tools, frontmatter.tools, toolsStrategy);

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

function mergeList(
  current: string[] | undefined,
  next: string[] | undefined,
  strategy: PersonaMergeStrategy
): string[] | undefined {
  if (!current && !next) {
    return undefined;
  }

  switch (strategy) {
    case "replace": {
      if (next) {
        return dedupe(next);
      }
      return current ? dedupe(current) : undefined;
    }
    case "intersect": {
      if (!current) {
        return next ? dedupe(next) : undefined;
      }
      if (!next) {
        return dedupe(current);
      }
      const nextSet = new Set(next);
      const intersection = current.filter((item) => nextSet.has(item));
      return dedupe(intersection);
    }
    case "append":
    default: {
      const combined = [...(current ?? []), ...(next ?? [])];
      return dedupe(combined);
    }
  }
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
