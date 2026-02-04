export type SecretSeverity = "high" | "medium" | "low";

export interface SecretFinding {
  type: string;
  severity: SecretSeverity;
  /** small snippet to aid debugging; never include entire body */
  snippet: string;
}

export interface SecretScanResult {
  findings: SecretFinding[];
  hasHighConfidence: boolean;
}

/**
 * Secret detection rules.
 *
 * HIGH severity (blocked by default):
 * - private_key_pem: PEM-encoded private keys (-----BEGIN PRIVATE KEY-----)
 * - openai_api_key: OpenAI API keys (sk-[20+ alphanumeric])
 * - github_token: GitHub tokens (ghp_, gho_, ghu_, ghs_[20+ alphanumeric])
 * - aws_access_key_id: AWS access key IDs (AKIA[16 uppercase alphanumeric])
 * - aws_secret_access_key: AWS secrets with contextual keywords
 * - anthropic_api_key: Anthropic API keys (sk-ant-[20+ alphanumeric])
 * - stripe_key: Stripe API keys (sk_live_, sk_test_, rk_live_, rk_test_)
 * - slack_token: Slack tokens (xox[bpras]-[alphanumeric])
 *
 * MEDIUM severity (logged but not blocked by default):
 * - jwt: JSON Web Tokens (eyJ...eyJ...signature)
 * - generic_secret_assignment: Direct assignment of long values to secret-named variables
 *   (e.g., api_key = "abc123...") - must have assignment operator, not just JSON key
 *
 * Designed to avoid false positives:
 * - JSON like {"token": "value"} is NOT matched (no assignment operator)
 * - Short values are NOT matched (minimum 20+ chars for generic patterns)
 * - Plain words like "token" or "secret" without values are NOT matched
 */
const RULES: Array<{
  type: string;
  severity: SecretSeverity;
  re: RegExp;
  description: string;
}> = [
  {
    type: "private_key_pem",
    severity: "high",
    re: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]{0,2000}-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/g,
    description: "PEM-encoded private key block",
  },
  {
    type: "openai_api_key",
    severity: "high",
    re: /\bsk-[A-Za-z0-9]{20,}\b/g,
    description: "OpenAI API key (sk-...)",
  },
  {
    type: "anthropic_api_key",
    severity: "high",
    re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    description: "Anthropic API key (sk-ant-...)",
  },
  {
    type: "github_token",
    severity: "high",
    re: /\bgh[pous]_[A-Za-z0-9]{20,}\b/g,
    description: "GitHub token (ghp_, gho_, ghu_, ghs_...)",
  },
  {
    type: "aws_access_key_id",
    severity: "high",
    re: /\bAKIA[0-9A-Z]{16}\b/g,
    description: "AWS access key ID (AKIA...)",
  },
  {
    type: "aws_secret_access_key",
    severity: "high",
    re: /\b(?:aws|amazon)[_\s]?(?:secret|private)[_\s]?(?:access)?[_\s]?key\s*[=:]\s*['\"]?[A-Za-z0-9/+=]{35,}['\"]?/gi,
    description: "AWS secret access key with contextual keywords",
  },
  {
    type: "stripe_key",
    severity: "high",
    re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
    description: "Stripe API key (sk_live_, sk_test_, rk_...)",
  },
  {
    type: "slack_token",
    severity: "high",
    re: /\bxox[bpras]-[A-Za-z0-9-]{20,}\b/g,
    description: "Slack token (xoxb-, xoxp-, xoxa-, xoxr-, xoxs-...)",
  },
  {
    type: "jwt",
    severity: "medium",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    description: "JSON Web Token (JWT)",
  },
  {
    type: "generic_secret_assignment",
    severity: "medium",
    // Only match actual assignment patterns (= not :) to avoid JSON false positives
    // Requires 20+ char value to reduce noise
    re: /\b(?:api[_-]?key|api[_-]?secret|auth[_-]?token|access[_-]?token|private[_-]?key|secret[_-]?key)\s*=\s*['\"]?[A-Za-z0-9_\-/.+=]{20,}['\"]?/gi,
    description: "Secret value assigned to sensitive variable name",
  },
];

/**
 * Returns descriptions of all secret patterns that are scanned.
 * Useful for documentation and transparency.
 */
export function getSecretPatternDescriptions(): Array<{
  type: string;
  severity: SecretSeverity;
  description: string;
}> {
  return RULES.map((r) => ({
    type: r.type,
    severity: r.severity,
    description: r.description,
  }));
}

function snippetFor(body: string, idx: number, len: number): string {
  // Create a redacted snippet that shows context without leaking the actual secret
  const start = Math.max(0, idx - 10);
  const end = Math.min(body.length, idx + len + 10);
  const raw = body.slice(start, end);
  // Replace the actual matched content with asterisks to avoid leaking
  const beforeMatch = body.slice(start, idx);
  const afterMatch = body.slice(idx + len, end);
  const redactedMatch = len > 8 ? `${"*".repeat(Math.min(len, 20))}` : "****";
  const snippet = `${beforeMatch}${redactedMatch}${afterMatch}`;
  return snippet.replace(/\s+/g, " ").slice(0, 80);
}

/**
 * Structured block reason for logging (does not leak secret values).
 */
export interface SecretBlockReason {
  blocked: boolean;
  findingCount: number;
  types: string[];
  severities: SecretSeverity[];
  /** Human-readable summary */
  summary: string;
}

/**
 * Generate a structured block reason suitable for logging.
 * Does NOT include the actual secret values or full snippets.
 */
export function formatBlockReason(result: SecretScanResult): SecretBlockReason {
  const types = [...new Set(result.findings.map((f) => f.type))];
  const severities = [...new Set(result.findings.map((f) => f.severity))];
  const highCount = result.findings.filter((f) => f.severity === "high").length;
  const mediumCount = result.findings.filter((f) => f.severity === "medium").length;

  let summary: string;
  if (result.findings.length === 0) {
    summary = "No secrets detected";
  } else if (result.hasHighConfidence) {
    summary = `Blocked: ${highCount} high-severity secret(s) detected (${types.join(", ")})`;
  } else {
    summary = `Warning: ${mediumCount} medium-severity pattern(s) detected (${types.join(", ")})`;
  }

  return {
    blocked: result.hasHighConfidence,
    findingCount: result.findings.length,
    types,
    severities,
    summary,
  };
}

/**
 * Scan an arbitrary string for sensitive patterns.
 * Intended for blocking unsafe POST bodies in web.fetch.
 *
 * Returns findings with redacted snippets (safe to log).
 * Use formatBlockReason() to get a structured reason for logging.
 */
export function scanForSecrets(body: string): SecretScanResult {
  const findings: SecretFinding[] = [];
  if (!body) return { findings, hasHighConfidence: false };

  // Cap scan size to reduce worst-case regex backtracking.
  const text = body.length > 200_000 ? body.slice(0, 200_000) : body;

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    let safety = 0;
    while ((match = rule.re.exec(text))) {
      const m = match[0] ?? "";
      findings.push({
        type: rule.type,
        severity: rule.severity,
        snippet: snippetFor(text, match.index, m.length),
      });

      // Prevent runaway in pathological inputs
      if (++safety > 20) break;
    }
  }

  const hasHighConfidence = findings.some((f) => f.severity === "high");
  return { findings, hasHighConfidence };
}
