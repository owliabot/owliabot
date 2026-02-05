/**
 * Skill System Type Definitions (Markdown-based)
 * @see docs/architecture/skills-system.md
 */

/**
 * Skill metadata parsed from YAML frontmatter
 */
export interface SkillMeta {
  name: string;
  description: string;
  version?: string;
  metadata?: Record<string, unknown>;
}

/**
 * A loaded skill
 */
export interface Skill {
  /** Directory name (skill identifier) */
  id: string;
  /** Parsed frontmatter metadata */
  meta: SkillMeta;
  /** Absolute path to SKILL.md */
  location: string;
}

/**
 * Result of skill initialization
 */
export interface SkillsInitResult {
  /** Successfully loaded skills */
  skills: Skill[];
  /** XML block for system prompt (<available_skills>) */
  promptBlock: string;
  /** Instruction text for LLM on how to use skills */
  instruction: string;
}

/**
 * Result of loading skills from directories
 */
export interface LoadSkillsResult {
  /** Successfully loaded skills */
  loaded: Skill[];
  /** Skills that failed to load */
  failed: Array<{ id: string; error: string }>;
}

/**
 * Parsed frontmatter result
 */
export interface ParsedFrontmatter {
  /** Parsed YAML data */
  data: Record<string, unknown>;
  /** Content after frontmatter */
  content: string;
}
