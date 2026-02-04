import { describe, it, expect } from "vitest";
import { MemoryInjector } from "../injector.js";
import type { MemoryEntry } from "../types.js";

const baseDate = new Date("2026-01-15T00:00:00Z");

describe("memory injector", () => {
  it("formats structured memory sections", () => {
    const entries: MemoryEntry[] = [
      {
        tag: "preference",
        text: "Prefers concise responses",
        source: "memory/2026-01-15.md",
        confidence: 1,
        timestamp: baseDate,
      },
      {
        tag: "style",
        text: "Dislikes formal greetings",
        source: "memory/2026-01-20.md",
        confidence: 1,
        timestamp: new Date("2026-01-20T00:00:00Z"),
      },
    ];

    const injector = new MemoryInjector();
    const summary = injector.inject(entries);

    const expected = `## User Preferences (from memory)
- Prefers concise responses [memory/2026-01-15.md]

## Style Preferences (from memory)
- Dislikes formal greetings [memory/2026-01-20.md]`;

    expect(summary).toBe(expected);
  });
});
