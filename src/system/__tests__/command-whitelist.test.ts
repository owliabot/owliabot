import { describe, it, expect } from "vitest";
import { checkCommandWhitelist } from "../security/command-whitelist.js";

describe("system/security/command-whitelist", () => {
  it("allows commands that are explicitly allowlisted", () => {
    const v = checkCommandWhitelist("ls", ["ls", "cat"]);
    expect(v.allowed).toBe(true);
  });

  it("denies when allowlist is empty", () => {
    const v = checkCommandWhitelist("ls", []);
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("allowlist_empty");
  });

  it("denies commands not on allowlist", () => {
    const v = checkCommandWhitelist("rm", ["ls"]);
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("command_not_allowlisted");
  });

  it("denies commands with path separators", () => {
    const v = checkCommandWhitelist("/bin/ls", ["ls"]);
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("command_must_be_basename");
  });

  it("denies commands with invalid characters", () => {
    const v = checkCommandWhitelist("ls -la", ["ls"]);
    expect(v.allowed).toBe(false);
  });
});
