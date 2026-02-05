export const MEMORY_TAG_TYPES = [
  "preference",
  "style",
  "boundary",
  "tooling",
  "context",
] as const;

export type MemoryTag = (typeof MEMORY_TAG_TYPES)[number];

export const DEFAULT_MEMORY_TAG_ALLOWLIST = new Set<MemoryTag>(MEMORY_TAG_TYPES);

export const SENSITIVE_MEMORY_TAGS = new Set([
  "private",
  "secret",
  "credential",
  "credentials",
  "password",
  "passphrase",
  "token",
  "mnemonic",
  "seed",
  "seed phrase",
  "seed_phrase",
  "private key",
  "private_key",
  "private-key",
  "api key",
  "api_key",
  "api-key",
  "apikey",
  "access key",
  "access_key",
  "access-key",
  "ssh key",
  "ssh_key",
  "ssh-key",
  "jwt",
  "bearer",
]);

const SENSITIVE_TAG_PATTERNS: RegExp[] = [
  /secret/i,
  /password/i,
  /passphrase/i,
  /token/i,
  /mnemonic/i,
  /seed/i,
  /private[_ -]?key/i,
  /api[_ -]?key/i,
  /access[_ -]?key/i,
  /ssh[_ -]?key/i,
  /bearer/i,
  /jwt/i,
];

const SENSITIVE_CONTENT_PATTERNS: RegExp[] = [
  /\bsecret\b/i,
  /\bpassword\b/i,
  /\bpassphrase\b/i,
  /\btoken\b/i,
  /\bmnemonic\b/i,
  /\bseed phrase\b/i,
  /\bseed[_-]?phrase\b/i,
  /\bprivate[_-]?key\b/i,
  /\bapi[_-]?key\b/i,
  /\baccess[_-]?key\b/i,
  /\bssh[_-]?key\b/i,
  /\bbearer\b/i,
  /\bjwt\b/i,
  /\bsk-[a-z0-9]{16,}\b/i,
];

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function isMemoryTag(tag: string): tag is MemoryTag {
  return (MEMORY_TAG_TYPES as readonly string[]).includes(tag);
}

export function isSensitiveTag(tag: string): boolean {
  const normalized = normalizeTag(tag);
  if (!normalized) return false;
  if (SENSITIVE_MEMORY_TAGS.has(normalized)) return true;
  return SENSITIVE_TAG_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function containsSensitiveContent(text: string): boolean {
  if (!text) return false;
  return SENSITIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(text));
}
