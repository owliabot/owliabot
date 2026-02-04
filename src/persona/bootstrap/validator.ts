import type { PersonaFrontmatter } from "../types.js";

export interface PersonaValidationResult {
  missing: string[];
  invalid: string[];
  isValid: boolean;
}

const REQUIRED_FIELDS: Array<{
  label: string;
  key: string;
  type: "string" | "string[]";
}> = [
  { label: "schema_version", key: "schemaVersion", type: "string" },
  { label: "id", key: "id", type: "string" },
  { label: "name", key: "name", type: "string" },
  { label: "role", key: "role", type: "string" },
  { label: "boundaries", key: "boundaries", type: "string[]" },
];

const OPTIONAL_STRING_FIELDS = ["mission", "memoryPolicy"] as const;
const OPTIONAL_LIST_FIELDS = ["tone", "do", "dont", "tools", "notes"] as const;

export function validatePersonaFrontmatter(
  frontmatter: PersonaFrontmatter | Record<string, unknown>
): PersonaValidationResult {
  const missing: string[] = [];
  const invalid: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    const raw = readField(frontmatter, field.key);
    if (raw === undefined) {
      if (field.key === "schemaVersion") {
        const snake = readField(frontmatter, "schema_version");
        if (snake !== undefined) {
          if (!isStringValue(snake)) {
            invalid.push(field.label);
          } else if (snake.trim().length === 0) {
            missing.push(field.label);
          }
          continue;
        }
      }
      missing.push(field.label);
      continue;
    }

    if (field.type === "string") {
      if (!isStringValue(raw)) {
        invalid.push(field.label);
      } else if (raw.trim().length === 0) {
        missing.push(field.label);
      }
      continue;
    }

    if (!isStringOrStringArray(raw)) {
      invalid.push(field.label);
      continue;
    }
    const normalized = normalizeStringArray(raw);
    if (!normalized || normalized.length === 0) {
      missing.push(field.label);
    }
  }

  for (const field of OPTIONAL_STRING_FIELDS) {
    const raw = readField(frontmatter, field);
    if (raw !== undefined && !isStringValue(raw)) {
      invalid.push(field);
    }
  }

  for (const field of OPTIONAL_LIST_FIELDS) {
    const raw = readField(frontmatter, field);
    if (raw !== undefined && !isStringOrStringArray(raw)) {
      invalid.push(field);
    }
  }

  return {
    missing,
    invalid,
    isValid: missing.length === 0 && invalid.length === 0,
  };
}

function readField(
  frontmatter: PersonaFrontmatter | Record<string, unknown>,
  key: string
): unknown {
  return (frontmatter as Record<string, unknown>)[key];
}

function isStringValue(value: unknown): value is string {
  return typeof value === "string";
}

function isStringOrStringArray(value: unknown): boolean {
  if (typeof value === "string") {
    return true;
  }
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function normalizeStringArray(value: unknown): string[] | undefined {
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
