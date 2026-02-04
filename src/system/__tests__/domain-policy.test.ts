import { describe, it, expect } from "vitest";
import { checkUrlAgainstDomainPolicy, domainMatches } from "../security/domain-policy.js";

describe("system/security/domain-policy", () => {
  it("matches wildcard patterns", () => {
    expect(domainMatches("*.example.com", "a.example.com")).toBe(true);
    expect(domainMatches("*.example.com", "example.com")).toBe(true);
    expect(domainMatches("*.example.com", "evil.com")).toBe(false);
  });

  it("allows public domains when allowlist empty", () => {
    const v = checkUrlAgainstDomainPolicy("https://example.com/", {
      allowList: [],
      denyList: [],
      allowPrivateNetworks: false,
    });
    expect(v.allowed).toBe(true);
  });

  it("denies non-http protocols", () => {
    const v = checkUrlAgainstDomainPolicy("file:///etc/passwd", {
      allowList: [],
      denyList: [],
      allowPrivateNetworks: false,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("invalid_protocol");
  });

  it("denies localhost by default", () => {
    const v = checkUrlAgainstDomainPolicy("http://localhost:1234/", {
      allowList: ["localhost"],
      denyList: [],
      allowPrivateNetworks: false,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("localhost_blocked");
  });

  it("allows localhost only when allowPrivateNetworks and explicitly allowlisted", () => {
    const v = checkUrlAgainstDomainPolicy("http://localhost:1234/", {
      allowList: ["localhost"],
      denyList: [],
      allowPrivateNetworks: true,
    });
    expect(v.allowed).toBe(true);
  });

  it("denies loopback IP by default", () => {
    const v = checkUrlAgainstDomainPolicy("http://127.0.0.1:8080/", {
      allowList: ["127.0.0.1"],
      denyList: [],
      allowPrivateNetworks: false,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("ip_");
  });

  it("allows loopback IP when allowPrivateNetworks and explicitly allowlisted", () => {
    const v = checkUrlAgainstDomainPolicy("http://127.0.0.1:8080/", {
      allowList: ["127.0.0.1"],
      denyList: [],
      allowPrivateNetworks: true,
    });
    expect(v.allowed).toBe(true);
  });

  it("denylist wins over allowlist", () => {
    const v = checkUrlAgainstDomainPolicy("https://example.com/", {
      allowList: ["example.com"],
      denyList: ["example.com"],
      allowPrivateNetworks: false,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("denylisted");
  });

  it("requires allowlist match when allowlist is non-empty", () => {
    const v = checkUrlAgainstDomainPolicy("https://example.com/", {
      allowList: ["allowed.com"],
      denyList: [],
      allowPrivateNetworks: false,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("not_allowlisted");
  });
});
