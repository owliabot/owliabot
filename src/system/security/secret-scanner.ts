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

const RULES: Array<{
  type: string;
  severity: SecretSeverity;
  re: RegExp;
}> = [
  {
    type: "private_key_pem",
    severity: "high",
    re: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]{0,2000}-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/g,
  },
  {
    type: "openai_api_key",
    severity: "high",
    re: /\bsk-[A-Za-z0-9]{20,}\b/g,
  },
  {
    type: "github_token",
    severity: "high",
    re: /\bgh[pous]_[A-Za-z0-9]{20,}\b/g,
  },
  {
    type: "aws_access_key_id",
    severity: "high",
    re: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    type: "aws_secret_access_key",
    severity: "high",
    re: /\b(?:(?:aws|amazon)[^\n]{0,20})?(?:secret|private)[^\n]{0,20}[=:]\s*([A-Za-z0-9/+=]{35,})\b/g,
  },
  {
    type: "jwt",
    severity: "medium",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    type: "generic_token_assignment",
    severity: "medium",
    re: /\b(?:api[_-]?key|token|secret|password)\b\s*[:=]\s*['\"]?[A-Za-z0-9_\-/.+=]{12,}['\"]?/gi,
  },
];

function snippetFor(body: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 20);
  const end = Math.min(body.length, idx + len + 20);
  const raw = body.slice(start, end);
  return raw.replace(/\s+/g, " ").slice(0, 140);
}

/**
 * Scan an arbitrary string for sensitive patterns.
 * Intended for blocking unsafe POST bodies in web.fetch.
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
