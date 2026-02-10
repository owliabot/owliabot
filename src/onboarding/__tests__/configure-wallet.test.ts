/**
 * Unit tests for configureWallet step function.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createInterface } from "node:readline";

let answers: string[] = [];
let promptLog: string[] = [];

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (q: string, cb: (ans: string) => void) => {
      promptLog.push(q);
      const next = answers.shift();
      if (next === undefined) throw new Error(`Ran out of answers at: "${q}"`);
      cb(next);
    },
    close: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  }),
}));

vi.mock("../../auth/oauth.js", () => ({
  startOAuthFlow: vi.fn().mockResolvedValue({}),
}));

vi.mock("../clawlet-onboard.js", () => ({
  runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }),
}));

import { configureWallet } from "../steps/configure-wallet.js";
import { runClawletOnboarding } from "../clawlet-onboard.js";

describe("configureWallet step", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let rl: ReturnType<typeof createInterface>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    answers = [];
    promptLog = [];
    rl = createInterface({ input: process.stdin, output: process.stdout });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("skips wallet when clawlet returns enabled=false", async () => {
    vi.mocked(runClawletOnboarding).mockResolvedValue({ enabled: false });
    const config: any = {};
    await configureWallet(rl, {}, config);
    expect(config.wallet).toBeUndefined();
  });

  it("configures wallet when clawlet returns enabled=true", async () => {
    vi.mocked(runClawletOnboarding).mockResolvedValue({
      enabled: true,
      baseUrl: "http://localhost:3000",
      defaultChainId: 1,
      defaultAddress: "0xABC",
    });
    const config: any = {};
    await configureWallet(rl, {}, config);
    expect(config.wallet).toBeDefined();
    expect(config.wallet.clawlet.enabled).toBe(true);
    expect(config.wallet.clawlet.defaultAddress).toBe("0xABC");
    expect(config.wallet.clawlet.baseUrl).toBe("http://localhost:3000");
  });

  it("handles clawlet onboarding error gracefully", async () => {
    vi.mocked(runClawletOnboarding).mockRejectedValue(new Error("daemon not running"));
    const config: any = {};
    // configureWallet doesn't catch errors itself, so it will throw
    await expect(configureWallet(rl, {}, config)).rejects.toThrow("daemon not running");
  });
});
