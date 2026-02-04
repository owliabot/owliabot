import ipaddr from "ipaddr.js";

export interface DomainPolicy {
  allowList: string[];
  denyList: string[];
  /**
   * If false (default), block requests to private/loopback/link-local IPs and localhost.
   * If true, allow them only when they are explicitly allowlisted.
   */
  allowPrivateNetworks: boolean;
}

export interface DomainPolicyVerdict {
  allowed: boolean;
  reason?: string;
  host?: string;
}

function normalizePattern(p: string): string {
  return p.trim().toLowerCase();
}

export function domainMatches(patternRaw: string, hostRaw: string): boolean {
  const pattern = normalizePattern(patternRaw);
  const host = hostRaw.trim().toLowerCase();
  if (!pattern || !host) return false;
  if (pattern === host) return true;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    if (!suffix) return false;
    return host === suffix || host.endsWith("." + suffix);
  }
  return false;
}

function isLocalhost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "localhost.";
}

function classifyIp(host: string):
  | "invalid"
  | "public"
  | "private"
  | "loopback"
  | "linkLocal"
  | "uniqueLocal" {
  try {
    if (!ipaddr.isValid(host)) return "invalid";
    const addr = ipaddr.parse(host);
    const range = addr.range();
    // ipaddr ranges: 'unicast', 'multicast', 'linkLocal', 'loopback', 'private', 'uniqueLocal', ...
    if (range === "loopback") return "loopback";
    if (range === "linkLocal") return "linkLocal";
    if (range === "private") return "private";
    if (range === "uniqueLocal") return "uniqueLocal";
    return "public";
  } catch {
    return "invalid";
  }
}

export function checkUrlAgainstDomainPolicy(
  urlStr: string,
  policy: DomainPolicy
): DomainPolicyVerdict {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { allowed: false, reason: "invalid_url" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { allowed: false, reason: "invalid_protocol", host: url.hostname };
  }

  const host = url.hostname;
  if (!host) {
    return { allowed: false, reason: "missing_host" };
  }

  const allowList = policy.allowList ?? [];
  const denyList = policy.denyList ?? [];

  // Denylist wins
  for (const pat of denyList) {
    if (domainMatches(pat, host)) {
      return { allowed: false, reason: "denylisted", host };
    }
  }

  // Block localhost/private IPs by default; allow only when explicitly allowlisted and allowPrivateNetworks enabled
  if (isLocalhost(host)) {
    const explicitlyAllowlisted = allowList.some((pat) => domainMatches(pat, host));
    if (!policy.allowPrivateNetworks || !explicitlyAllowlisted) {
      return { allowed: false, reason: "localhost_blocked", host };
    }
  }

  const ipClass = classifyIp(host);
  if (ipClass !== "invalid" && ipClass !== "public") {
    const explicitlyAllowlisted = allowList.some((pat) => domainMatches(pat, host));
    if (!policy.allowPrivateNetworks || !explicitlyAllowlisted) {
      return { allowed: false, reason: `ip_${ipClass}_blocked`, host };
    }
  }

  // Allowlist if configured
  if (Array.isArray(allowList) && allowList.length > 0) {
    const ok = allowList.some((pat) => domainMatches(pat, host));
    if (!ok) {
      return { allowed: false, reason: "not_allowlisted", host };
    }
  }

  return { allowed: true, host };
}
