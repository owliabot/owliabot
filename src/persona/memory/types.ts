import type { MemoryTag } from "./tags.js";

export interface MemoryEntry {
  tag: MemoryTag;
  text: string;
  source: string;
  confidence: number;
  timestamp: Date;
}
