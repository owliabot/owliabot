import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";

// We test the underlying functions by importing and calling them
// after setting OWLIABOT_CONFIG_PATH to a temp file.

const TEST_DIR = join(tmpdir(), `owliabot-security-cli-test-${Date.now()}`);
const TEST_CONFIG = join(TEST_DIR, "app.yaml");

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  delete process.env.OWLIABOT_CONFIG_PATH;
  await rm(TEST_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe("security add-user", () => {
  it("adds a user to empty config", async () => {
    await writeFile(TEST_CONFIG, "providers:\n  - id: anthropic\n");
    process.env.OWLIABOT_CONFIG_PATH = TEST_CONFIG;

    const { securityAddUser } = await import("../cli.js");
    await securityAddUser("123456");

    const raw = await readFile(TEST_CONFIG, "utf-8");
    const doc = parseYaml(raw) as Record<string, any>;
    expect(doc.security.writeToolAllowList).toContain("123456");
  });

  it("does not duplicate existing user", async () => {
    await writeFile(TEST_CONFIG, "security:\n  writeToolAllowList:\n    - '123456'\n");
    process.env.OWLIABOT_CONFIG_PATH = TEST_CONFIG;

    const { securityAddUser } = await import("../cli.js");
    await securityAddUser("123456");

    const raw = await readFile(TEST_CONFIG, "utf-8");
    const doc = parseYaml(raw) as Record<string, any>;
    const list = doc.security.writeToolAllowList;
    expect(list.filter((id: string) => id === "123456")).toHaveLength(1);
  });
});

describe("security remove-user", () => {
  it("removes a user from allowlist", async () => {
    await writeFile(TEST_CONFIG, "security:\n  writeToolAllowList:\n    - '111'\n    - '222'\n");
    process.env.OWLIABOT_CONFIG_PATH = TEST_CONFIG;

    const { securityRemoveUser } = await import("../cli.js");
    await securityRemoveUser("111");

    const raw = await readFile(TEST_CONFIG, "utf-8");
    const doc = parseYaml(raw) as Record<string, any>;
    expect(doc.security.writeToolAllowList).toEqual(["222"]);
  });
});
