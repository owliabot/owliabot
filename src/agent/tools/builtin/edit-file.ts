/**
 * Edit file tool - precise text replacement
 * Inspired by pi-coding-agent's edit tool
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolDefinition } from "../interface.js";

/**
 * Options for creating the edit_file tool
 */
export interface EditFileToolOptions {
  /** Workspace directory path */
  workspace: string;
}

// Strip UTF-8 BOM if present
function stripBom(text: string): { bom: string; text: string } {
  if (text.charCodeAt(0) === 0xfeff) {
    return { bom: "\uFEFF", text: text.slice(1) };
  }
  return { bom: "", text };
}

// Detect line ending style
function detectLineEnding(text: string): "\r\n" | "\n" {
  const crlfCount = (text.match(/\r\n/g) || []).length;
  const lfCount = (text.match(/(?<!\r)\n/g) || []).length;
  return crlfCount > lfCount ? "\r\n" : "\n";
}

// Normalize to LF for consistent matching
function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

// Restore original line endings
function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
  if (ending === "\r\n") {
    return text.replace(/\n/g, "\r\n");
  }
  return text;
}

// Normalize whitespace for fuzzy matching
function normalizeForFuzzyMatch(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "") // trailing whitespace per line
    .replace(/^\s+/gm, (match) => match.replace(/\t/g, "  ")); // normalize leading tabs
}

// Find text with fuzzy matching fallback
function fuzzyFindText(
  content: string,
  searchText: string
): {
  found: boolean;
  index: number;
  matchLength: number;
  contentForReplacement: string;
  usedFuzzy: boolean;
} {
  // Try exact match first
  const exactIndex = content.indexOf(searchText);
  if (exactIndex !== -1) {
    return {
      found: true,
      index: exactIndex,
      matchLength: searchText.length,
      contentForReplacement: content,
      usedFuzzy: false,
    };
  }

  // Try fuzzy match (normalized whitespace)
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzySearchText = normalizeForFuzzyMatch(searchText);
  const fuzzyIndex = fuzzyContent.indexOf(fuzzySearchText);

  if (fuzzyIndex !== -1) {
    return {
      found: true,
      index: fuzzyIndex,
      matchLength: fuzzySearchText.length,
      contentForReplacement: fuzzyContent,
      usedFuzzy: true,
    };
  }

  return {
    found: false,
    index: -1,
    matchLength: 0,
    contentForReplacement: content,
    usedFuzzy: false,
  };
}

// Count occurrences using fuzzy matching
function countOccurrences(content: string, searchText: string): number {
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzySearchText = normalizeForFuzzyMatch(searchText);
  return fuzzyContent.split(fuzzySearchText).length - 1;
}

// Generate simple diff info
function generateDiffInfo(
  oldContent: string,
  newContent: string
): { linesChanged: number; firstChangedLine: number } {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  let firstChangedLine = 1;
  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    if (oldLines[i] !== newLines[i]) {
      firstChangedLine = i + 1;
      break;
    }
  }

  const linesChanged = Math.abs(newLines.length - oldLines.length) + 1;
  return { linesChanged, firstChangedLine };
}

export function createEditFileTool(opts: EditFileToolOptions): ToolDefinition {
  const { workspace: workspacePath } = opts;
  return {
    name: "edit_file",
    description:
      "Edit a file by replacing exact text. The old_text must match exactly (including whitespace). Use this for precise, surgical edits. Whitespace differences are handled with fuzzy matching.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to workspace",
        },
        old_text: {
          type: "string",
          description: "Exact text to find and replace",
        },
        new_text: {
          type: "string",
          description: "New text to replace with",
        },
      },
      required: ["path", "old_text", "new_text"],
    },
    security: {
      level: "write",
    },
    async execute(params) {
      const { path: relativePath, old_text, new_text } = params as {
        path: string;
        old_text: string;
        new_text: string;
      };

      // Security: ensure path is within workspace
      if (relativePath.includes("..") || relativePath.startsWith("/")) {
        return {
          success: false,
          error: "Invalid path: must be relative to workspace",
        };
      }

      const fullPath = join(workspacePath, relativePath);

      try {
        // Read file
        const rawContent = await readFile(fullPath, "utf-8");

        // Strip BOM
        const { bom, text: content } = stripBom(rawContent);
        const originalEnding = detectLineEnding(content);

        // Normalize for matching
        const normalizedContent = normalizeToLF(content);
        const normalizedOldText = normalizeToLF(old_text);
        const normalizedNewText = normalizeToLF(new_text);

        // Find the text
        const matchResult = fuzzyFindText(normalizedContent, normalizedOldText);

        if (!matchResult.found) {
          return {
            success: false,
            error: `Could not find the text in ${relativePath}. The old_text must match exactly including whitespace and newlines.`,
          };
        }

        // Check for multiple occurrences
        const occurrences = countOccurrences(normalizedContent, normalizedOldText);
        if (occurrences > 1) {
          return {
            success: false,
            error: `Found ${occurrences} occurrences in ${relativePath}. Please provide more context to make the match unique.`,
          };
        }

        // Perform replacement
        const baseContent = matchResult.contentForReplacement;
        const newContent =
          baseContent.substring(0, matchResult.index) +
          normalizedNewText +
          baseContent.substring(matchResult.index + matchResult.matchLength);

        // Check if actually changed
        if (baseContent === newContent) {
          return {
            success: false,
            error: `No changes made. The replacement produced identical content.`,
          };
        }

        // Restore line endings and BOM, then write
        const finalContent = bom + restoreLineEndings(newContent, originalEnding);
        await writeFile(fullPath, finalContent, "utf-8");

        const diffInfo = generateDiffInfo(baseContent, newContent);

        return {
          success: true,
          data: {
            message: `Successfully edited ${relativePath}`,
            path: relativePath,
            firstChangedLine: diffInfo.firstChangedLine,
            usedFuzzyMatch: matchResult.usedFuzzy,
          },
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            success: false,
            error: `File not found: ${relativePath}`,
          };
        }
        throw err;
      }
    },
  };
}
