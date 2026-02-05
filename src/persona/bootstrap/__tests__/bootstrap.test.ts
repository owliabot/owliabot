import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BootstrapSession,
  DEFAULT_BOOTSTRAP_QUESTIONS,
  generatePersonaOverlay,
  validatePersonaFrontmatter,
} from "../index.js";
import { parsePersonaFile } from "../../frontmatter.js";

const FIXED_DATE = new Date("2025-01-01T00:00:00.000Z");

describe("bootstrap questions", () => {
  it("provides a concise question set", () => {
    expect(DEFAULT_BOOTSTRAP_QUESTIONS.length).toBeGreaterThanOrEqual(5);
    expect(DEFAULT_BOOTSTRAP_QUESTIONS.length).toBeLessThanOrEqual(7);
  });
});

describe("bootstrap session", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "owliabot-bootstrap-"));
  });

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("walks through questions and supports optional skips", async () => {
    const session = new BootstrapSession({
      agentId: "test",
      rootDir: dir,
      now: FIXED_DATE,
    });

    let question = session.start();
    expect(question?.id).toBe("name");

    question = session.answer("name", "Test Agent");
    expect(question?.id).toBe("role");

    session.answer("role", "Support user setup");
    session.answer("mission", "");
    session.answer("tone", "calm, direct");
    session.answer("boundaries", ["no secrets"]);
    session.answer("tools", "");

    const result = await session.complete();
    expect(result.validation.missing).toEqual([]);

    const content = await readFile(result.overlayPath, "utf-8");
    const parsed = parsePersonaFile(content);

    expect(parsed.frontmatter.name).toBe("Test Agent");
    expect(parsed.frontmatter.role).toBe("Support user setup");
    expect(parsed.frontmatter.tone).toEqual(["calm", "direct"]);
    expect(parsed.frontmatter.boundaries).toEqual(["no secrets"]);
    expect(parsed.frontmatter.tools).toBeUndefined();
  });

  it("rejects invalid agent ids", () => {
    expect(
      () =>
        new BootstrapSession({
          agentId: "../escape",
          rootDir: dir,
        })
    ).toThrow(/agent id/i);
  });
});

describe("overlay generation", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "owliabot-overlay-"));
  });

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes overlay file with metadata", async () => {
    const result = await generatePersonaOverlay({
      agentId: "main",
      rootDir: dir,
      now: FIXED_DATE,
      status: "confirmed",
      answers: {
        name: "Owlia",
        role: "Guide",
        boundaries: "no secrets",
      },
    });

    const content = await readFile(result.path, "utf-8");
    expect(content).toContain("status: confirmed");
    expect(content).toContain("created_at: 2025-01-01T00:00:00.000Z");

    const parsed = parsePersonaFile(content);
    expect(parsed.frontmatter.name).toBe("Owlia");
    expect(parsed.frontmatter.role).toBe("Guide");
    expect(parsed.frontmatter.boundaries).toEqual(["no secrets"]);
  });

  it("blocks path traversal in overlay generation", async () => {
    await expect(
      generatePersonaOverlay({
        agentId: "..",
        rootDir: dir,
        answers: {},
      })
    ).rejects.toThrow(/agent id/i);
  });
});

describe("validator", () => {
  it("reports missing and invalid fields", () => {
    const result = validatePersonaFrontmatter({
      schemaVersion: "1.0",
      id: "main",
      name: "",
      role: "",
      boundaries: [],
      tools: 123,
    });

    expect(result.missing).toEqual(["name", "role", "boundaries"]);
    expect(result.invalid).toEqual(["tools"]);
  });
});
