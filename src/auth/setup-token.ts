/**
 * Anthropic setup-token validation
 * 
 * Users generate tokens via `claude setup-token` (Claude Code CLI)
 * These tokens start with sk-ant-oat01- and are at least 80 characters
 * 
 * @see https://docs.anthropic.com/claude/docs/claude-code
 */

export const ANTHROPIC_SETUP_TOKEN_PREFIX = "sk-ant-oat01-";
export const ANTHROPIC_SETUP_TOKEN_MIN_LENGTH = 80;

/**
 * Validate an Anthropic setup-token
 * @param raw - The raw token input
 * @returns Error message if invalid, undefined if valid
 */
export function validateAnthropicSetupToken(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "Required";
  }
  if (!trimmed.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX)) {
    return `Expected token starting with ${ANTHROPIC_SETUP_TOKEN_PREFIX}`;
  }
  if (trimmed.length < ANTHROPIC_SETUP_TOKEN_MIN_LENGTH) {
    return "Token looks too short; paste the full setup-token";
  }
  return undefined;
}

/**
 * Check if a string looks like a setup-token (for auto-detection)
 */
export function isSetupToken(value: string): boolean {
  return value.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX);
}

/**
 * Check if a string looks like a standard Anthropic API key
 */
export function isStandardApiKey(value: string): boolean {
  // Standard API keys start with sk-ant-api03- (or similar prefix without oat01)
  return value.startsWith("sk-ant-") && !value.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX);
}
