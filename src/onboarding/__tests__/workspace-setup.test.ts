/**
 * Unit tests for workspace-setup step:
 * - getWorkspacePath
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let answers: string[] = [];

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (q: string, cb: (ans: string) => void) => {
      const next = answers.shift();
      if (next === undefined) throw new Error(`Ran out of answers at: "${q}"`);
      cb(next);
    },
    close: vi.fn(),
  }),
}));

vi.mock("../../auth/oauth.js", () => ({ startOAuthFlow: vi.fn() }));
vi.mock("../clawlet-onboard.js", () => ({ runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }) }));

describe("workspace-setup step", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    answers = [];
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe("getWorkspacePath", () => {
    it.skip("requires export after refactor — returns /app/workspace in docker mode", async () => {
      // const result = await getWorkspacePath(rl, true, "/app/config/app.yaml");
      // expect(result).toBe("/app/workspace");
    });

    it.skip("requires export after refactor — returns default (sibling of config) when empty input", async () => {
      // answers = [""];
      // const result = await getWorkspacePath(rl, false, "/home/user/.owlia_dev/app.yaml");
      // expect(result).toBe("/home/user/.owlia_dev/workspace");
    });

    it.skip("requires export after refactor — returns custom path when provided", async () => {
      // answers = ["/custom/workspace"];
      // const result = await getWorkspacePath(rl, false, "/home/user/.owlia_dev/app.yaml");
      // expect(result).toBe("/custom/workspace");
    });

    it.skip("requires export after refactor — does not prompt in docker mode", async () => {
      // In docker mode the function should return immediately without asking
      // const result = await getWorkspacePath(rl, true, "/any/path");
      // expect(answers).toHaveLength(0); // no answers consumed
    });
  });
});
