import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runOnboarding } from "../onboard.js";
import { loadAppConfig } from "../storage.js";
import { loadSecrets } from "../secrets.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let answers: string[] = [];

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (_q: string, cb: (ans: string) => void) => {
      const next = answers.shift() ?? "";
      cb(next);
    },
    close: () => {},
  }),
}));

describe("onboarding", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "owliabot-onboard-"));
  });

  afterEach(async () => {
    answers = [];
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  it("writes config and separates secrets", async () => {
    const appConfigPath = join(dir, "app.yaml");

    answers = [
      "discord,telegram",
      "",
      "",
      "n",
      "y",
      "111,222",
      "discord-secret",
      "telegram-secret",
    ];

    await runOnboarding({ appConfigPath });

    const config = await loadAppConfig(appConfigPath);
    const secrets = await loadSecrets(appConfigPath);

    expect(config?.workspace).toBe("./workspace");
    expect(config?.providers?.[0]?.apiKey).toBe("oauth");
    expect(config?.discord?.requireMentionInGuild).toBe(true);
    expect(config?.discord?.channelAllowList).toEqual(["111", "222"]);
    expect(config?.discord && "token" in config.discord).toBe(false);
    expect(config?.telegram && "token" in config.telegram).toBe(false);

    expect(secrets?.discord?.token).toBe("discord-secret");
    expect(secrets?.telegram?.token).toBe("telegram-secret");
  });
});
