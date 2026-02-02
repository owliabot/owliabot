import { describe, it, expect } from "vitest";
import { isIpAllowed, hashToken, hashRequest } from "../utils.js";

describe("gateway utils", () => {
  it("matches allowlist CIDR", () => {
    expect(isIpAllowed("10.1.2.3", ["10.0.0.0/8"]))
      .toBe(true);
  });

  it("hashes tokens deterministically", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("hashes request inputs", () => {
    const h1 = hashRequest("POST", "/command/tool", "{}", "dev1");
    const h2 = hashRequest("POST", "/command/tool", "{}", "dev1");
    expect(h1).toBe(h2);
  });
});
