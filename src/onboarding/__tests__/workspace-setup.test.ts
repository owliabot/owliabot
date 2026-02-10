/**
 * Unit tests for workspace-setup step:
 * - getWorkspacePath
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createInterface } from "node:readline";

let answers: string[] = [];

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (q: string, cb: (ans: string) => void) => {
      const next = answers.shift();
      if (next === undefined) throw new Error(`Ran out of answers at: "${q}"`);
      cb(next);
    },
    close: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  }),
}));

vi.mock("../../auth/oauth.js", () => ({ startOAuthFlow: vi.fn() }));
vi.mock("../clawlet-onboard.js", () => ({ runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }) }));

import { getWorkspacePath } from "../steps/workspace-setup.js";

describe("workspace-setup step", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let rl: ReturnType<typeof createInterface>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    answers = [];
    rl = createInterface({ input: process.stdin, output: process.stdout });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe("getWorkspacePath", () => {
    it("returns /app/workspace in docker mode", async () => {
      const result = await getWorkspacePath(rl, true, "/app/config/app.yaml");
      expect(result).toBe("/app/workspace");
    });

    it("returns default (sibling of config) when empty input", async () => {
      answers = [""];
      const result = await getWorkspacePath(rl, false, "/home/user/.owlia_dev/app.yaml");
      expect(result).toBe("/home/user/.owlia_dev/workspace");
    });

    it("returns custom path when provided", async () => {
      answers = ["/custom/workspace"];
      const result = await getWorkspacePath(rl, false, "/home/user/.owlia_dev/app.yaml");
      expect(result).toBe("/custom/workspace");
    });

    it("does not prompt in docker mode", async () => {
      answers = ["should-not-be-consumed"];
      await getWorkspacePath(rl, true, "/any/path");
      expect(answers).toHaveLength(1); // answer was not consumed
    });
  });
});
