import * as ipaddr from "ipaddr.js";
import { createHash } from "node:crypto";

export function isIpAllowed(ip: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip.trim());
  } catch {
    return false;
  }
  return allowlist.some((entry) => {
    const trimmed = entry.trim();
    try {
      if (trimmed.includes("/")) {
        const cidr = ipaddr.parseCIDR(trimmed);
        return addr.match(cidr);
      }
      return addr.toString() === ipaddr.parse(trimmed).toString();
    } catch {
      return false;
    }
  });
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashRequest(
  method: string,
  path: string,
  body: string,
  deviceId: string
): string {
  return createHash("sha256")
    .update(`${method}:${path}:${deviceId}:${body}`)
    .digest("hex");
}
