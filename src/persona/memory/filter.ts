import { readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { createLogger } from "../../utils/logger.js";
import {
  DEFAULT_MEMORY_TAG_ALLOWLIST,
  containsSensitiveContent,
  isMemoryTag,
  isSensitiveTag,
  normalizeTag,
  type MemoryTag,
} from "./tags.js";
import type { MemoryEntry } from "./types.js";

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
const TAG_COMMENT_RE = /<!--\s*tag(s)?\s*:\s*([^>]+?)\s*-->/i;
const CONF_COMMENT_RE = /<!--\s*(confidence|conf)\s*:\s*([^>]+?)\s*-->/i;
const MAX_MEMORY_TEXT_LENGTH = 500;

const log = createLogger("persona.memory.filter");

interface MemoryFileInfo {
  absPath: string;
  relPath: string;
  mtimeMs: number;
}

interface ParsedFrontmatter {
  tags: string[];
  confidence?: number;
  date?: Date;
}

interface EntryDraft {
  tags: string[];
  text: string;
  confidence?: number;
}

export interface MemoryFilterOptions {
  allowTags?: Iterable<MemoryTag>;
  recencyDays?: number;
  minConfidence?: number;
  now?: Date;
}

export interface MemoryFilterInput {
  memoryDir: string;
  sourceRoot?: string;
}

export class MemoryFilter {
  private readonly allowTags: Set<string>;
  private readonly recencyDays: number;
  private readonly minConfidence: number;
  private readonly now: Date;

  constructor(options: MemoryFilterOptions = {}) {
    const allow = options.allowTags
      ? new Set(Array.from(options.allowTags).map((tag) => normalizeTag(tag)))
      : DEFAULT_MEMORY_TAG_ALLOWLIST;
    this.allowTags = new Set(Array.from(allow).map((tag) => normalizeTag(tag)));
    this.recencyDays = options.recencyDays ?? 180;
    this.minConfidence = options.minConfidence ?? 0.5;
    this.now = options.now ?? new Date();
  }

  async filterFromDirectory(input: MemoryFilterInput): Promise<MemoryEntry[]> {
    const memoryDir = path.resolve(input.memoryDir);
    const sourceRoot = input.sourceRoot ? path.resolve(input.sourceRoot) : undefined;
    const files = await listMarkdownFiles(memoryDir);
    const entries: MemoryEntry[] = [];

    for (const file of files) {
      let content: string;
      try {
        content = await readFile(file.absPath, "utf-8");
      } catch {
        continue;
      }

      let parsed: { frontmatter: Record<string, unknown>; body: string };
      try {
        parsed = parseFrontmatter(content);
      } catch (err) {
        log.warn(`Skipping memory file with invalid YAML: ${file.absPath}`, err);
        continue;
      }

      const { frontmatter, body } = parsed;
      const parsedFrontmatter = parseMemoryFrontmatter(frontmatter);
      const fileDate =
        parsedFrontmatter.date ??
        parseDateFromFilename(file.relPath) ??
        new Date(file.mtimeMs);

      const drafts = extractEntries(body, parsedFrontmatter);
      const source = resolveSource(file, sourceRoot, memoryDir);

      for (const draft of drafts) {
        if (isSensitiveEntry(draft)) {
          continue;
        }
        const confidence = clampConfidence(draft.confidence ?? parsedFrontmatter.confidence ?? 1);
        if (confidence < this.minConfidence) {
          continue;
        }

        if (!isWithinRecency(fileDate, this.now, this.recencyDays)) {
          continue;
        }

        for (const tagRaw of draft.tags) {
          const normalized = normalizeTag(tagRaw);
          if (!normalized) continue;
          if (isSensitiveTag(normalized)) continue;
          if (!isMemoryTag(normalized)) continue;
          if (!this.allowTags.has(normalized)) continue;

          entries.push({
            tag: normalized,
            text: draft.text,
            source,
            confidence,
            timestamp: fileDate,
          });
        }
      }
    }

    return dedupeEntries(entries);
  }
}

function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }

  const rawYaml = match[1] ?? "";
  const parsed = (parse(rawYaml) as Record<string, unknown> | null) ?? {};
  const body = content.slice(match[0].length).trim();
  return { frontmatter: parsed, body };
}

function parseMemoryFrontmatter(raw: Record<string, unknown>): ParsedFrontmatter {
  const tags = readStringArray(raw.tag ?? raw.tags);
  const confidence = parseConfidence(raw.confidence);
  const date =
    parseDate(raw.date) ??
    parseDate(raw.created_at ?? raw.createdAt) ??
    parseDate(raw.updated_at ?? raw.updatedAt) ??
    parseDate(raw.timestamp);

  return { tags, confidence, date };
}

function extractEntries(body: string, frontmatter: ParsedFrontmatter): EntryDraft[] {
  if (!body) return [];

  const entries: EntryDraft[] = [];
  const lines = body.split(/\r?\n/);
  let pendingTags: string[] | undefined;
  let pendingConfidence: number | undefined;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith("<!--")) {
      const tagMatch = TAG_COMMENT_RE.exec(trimmed);
      if (tagMatch) {
        pendingTags = parseTagList(tagMatch[2]);
        i += 1;
        continue;
      }
      const confMatch = CONF_COMMENT_RE.exec(trimmed);
      if (confMatch) {
        pendingConfidence = parseConfidence(confMatch[2]);
        i += 1;
        continue;
      }
    }

    const blockLines: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim().length > 0) {
      const current = (lines[i] ?? "").trim();
      if (current.startsWith("<!--")) {
        const tagMatch = TAG_COMMENT_RE.exec(current);
        if (tagMatch) {
          pendingTags = parseTagList(tagMatch[2]);
          i += 1;
          continue;
        }
        const confMatch = CONF_COMMENT_RE.exec(current);
        if (confMatch) {
          pendingConfidence = parseConfidence(confMatch[2]);
          i += 1;
          continue;
        }
      }

      blockLines.push(lines[i] ?? "");
      i += 1;
    }

    const text = normalizeBlock(blockLines);
    if (!text) {
      pendingTags = undefined;
      pendingConfidence = undefined;
      continue;
    }

    const tags = pendingTags ?? frontmatter.tags;
    if (tags.length > 0) {
      entries.push({
        tags,
        text,
        confidence: pendingConfidence ?? frontmatter.confidence,
      });
    }

    pendingTags = undefined;
    pendingConfidence = undefined;
  }

  return entries;
}

function normalizeBlock(lines: string[]): string {
  const normalized: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    let current = line.trim();
    if (!current) continue;

    if (/^```/.test(current) || /^~~~/.test(current)) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) {
      continue;
    }

    current = current.replace(/^#{1,6}\s+/, "");

    current = current.replace(/^>\s+/, "");
    current = current.replace(/^[-*]\s+/, "");
    current = current.replace(/^\d+\.\s+/, "");

    if (current.length > 0) {
      normalized.push(current);
    }
  }

  if (normalized.length === 0) return "";

  let text = normalized.join(" ").replace(/\s+/g, " ").trim();
  if (text.length > MAX_MEMORY_TEXT_LENGTH) {
    text = text.slice(0, MAX_MEMORY_TEXT_LENGTH).trimEnd();
  }
  return text;
}

function parseTagList(input: string): string[] {
  if (!input) return [];
  return input
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? parseTagList(trimmed) : [];
  }

  return [];
}

function parseConfidence(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  let normalized = value;
  if (normalized > 1 && normalized <= 100) {
    normalized = normalized / 100;
  }
  if (normalized < 0) return 0;
  if (normalized > 1) return 1;
  return normalized;
}

function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const candidate = new Date(value);
    return Number.isNaN(candidate.getTime()) ? undefined : candidate;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const candidate = new Date(trimmed);
    return Number.isNaN(candidate.getTime()) ? undefined : candidate;
  }
  return undefined;
}

function parseDateFromFilename(relPath: string): Date | undefined {
  const base = path.basename(relPath);
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(base);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return undefined;
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function isWithinRecency(date: Date, now: Date, days: number): boolean {
  if (days <= 0) return true;
  const ageMs = now.getTime() - date.getTime();
  if (Number.isNaN(ageMs)) return false;
  if (ageMs <= 0) return true;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays <= days;
}

function resolveSource(
  file: MemoryFileInfo,
  sourceRoot: string | undefined,
  memoryDir: string
): string {
  if (sourceRoot) {
    const rel = path.relative(sourceRoot, file.absPath);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return normalizeRelPath(rel);
    }
  }
  return normalizeRelPath(path.posix.join(path.basename(memoryDir), file.relPath));
}

function normalizeRelPath(input: string): string {
  const posix = input.replace(/\\/g, "/").replace(/^\.\//, "");
  return path.posix.normalize(posix).replace(/^\.\//, "");
}

async function listMarkdownFiles(dirAbs: string): Promise<MemoryFileInfo[]> {
  try {
    const st = await lstat(dirAbs);
    if (!st.isDirectory() || st.isSymbolicLink()) return [];
  } catch {
    return [];
  }

  return listMarkdownFilesRecursive(dirAbs, "");
}

async function listMarkdownFilesRecursive(
  dirAbs: string,
  baseRel: string
): Promise<MemoryFileInfo[]> {
  let entries;
  try {
    entries = await readdir(dirAbs, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: MemoryFileInfo[] = [];

  for (const entry of entries) {
    const abs = path.join(dirAbs, entry.name);
    const rel = path.posix.join(baseRel, entry.name);

    let st;
    try {
      st = await lstat(abs);
    } catch {
      continue;
    }

    if (st.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      out.push(...(await listMarkdownFilesRecursive(abs, rel)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;

    out.push({ absPath: abs, relPath: rel, mtimeMs: st.mtimeMs });
  }

  return out;
}

function dedupeEntries(entries: MemoryEntry[]): MemoryEntry[] {
  const seen = new Set<string>();
  const result: MemoryEntry[] = [];

  for (const entry of entries) {
    const key = `${entry.tag}|${entry.text}|${entry.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }

  return result;
}

function isSensitiveEntry(draft: EntryDraft): boolean {
  if (!draft.text) return false;
  if (containsSensitiveContent(draft.text)) {
    return true;
  }
  for (const tag of draft.tags) {
    if (isSensitiveTag(tag)) {
      return true;
    }
  }
  return false;
}
