import type { MemoryEntry } from "./types.js";
import type { MemoryTag } from "./tags.js";

const TAG_ORDER: MemoryTag[] = [
  "preference",
  "style",
  "boundary",
  "tooling",
  "context",
];

const TAG_TITLES: Record<MemoryTag, string> = {
  preference: "User Preferences",
  style: "Style Preferences",
  boundary: "Boundaries",
  tooling: "Tooling Preferences",
  context: "Relevant Context",
};

export class MemoryInjector {
  inject(entries: MemoryEntry[]): string {
    if (!entries || entries.length === 0) return "";

    const grouped = groupByTag(entries);
    const lines: string[] = [];

    for (const tag of TAG_ORDER) {
      const bucket = grouped.get(tag);
      if (!bucket || bucket.length === 0) continue;

      lines.push(`## ${TAG_TITLES[tag]} (from memory)`);
      for (const entry of sortByRecency(bucket)) {
        lines.push(`> 仅供参考：${entry.text} [${entry.source}]`);
      }
      lines.push("");
    }

    if (lines[lines.length - 1] === "") {
      lines.pop();
    }

    return lines.join("\n").trim();
  }
}

function groupByTag(entries: MemoryEntry[]): Map<MemoryTag, MemoryEntry[]> {
  const map = new Map<MemoryTag, MemoryEntry[]>();
  for (const entry of entries) {
    const existing = map.get(entry.tag);
    if (existing) {
      existing.push(entry);
    } else {
      map.set(entry.tag, [entry]);
    }
  }
  return map;
}

function sortByRecency(entries: MemoryEntry[]): MemoryEntry[] {
  return [...entries].sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
  );
}
