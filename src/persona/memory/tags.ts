export const MEMORY_TAG_TYPES = [
  "preference",
  "style",
  "boundary",
  "tooling",
  "context",
] as const;

export type MemoryTag = (typeof MEMORY_TAG_TYPES)[number];

export const DEFAULT_MEMORY_TAG_ALLOWLIST = new Set<MemoryTag>(MEMORY_TAG_TYPES);

export const SENSITIVE_MEMORY_TAGS = new Set(["private", "secret", "credential"]);

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function isMemoryTag(tag: string): tag is MemoryTag {
  return (MEMORY_TAG_TYPES as readonly string[]).includes(tag);
}

export function isSensitiveTag(tag: string): boolean {
  return SENSITIVE_MEMORY_TAGS.has(normalizeTag(tag));
}
