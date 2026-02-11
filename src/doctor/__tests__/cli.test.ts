import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile, readdir, readFile } from "node:fs/promises";
import { parse } from "yaml";

import { runDoctorCli, type DoctorIO } from "../cli.js";

function createTestIO(opts: {
  interactive: boolean;
  ynAnswers?: boolean[];
  selectAnswers?: number[];
  secretAnswers?: string[];
}) {
  const logs: string[] = [];
  const yn = [...(opts.ynAnswers ?? [])];
  const sel = [...(opts.selectAnswers ?? [])];
  const sec = [...(opts.secretAnswers ?? [])];

  const io: DoctorIO = {
    interactive: opts.interactive,
    print: (msg) => logs.push(msg),
    header: (t) => logs.push(`HEADER:${t}`),
    info: (msg) => logs.push(`INFO:${msg}`),
    warn: (msg) => logs.push(`WARN:${msg}`),
    error: (msg) => logs.push(`ERROR:${msg}`),
    success: (msg) => logs.push(`SUCCESS:${msg}`),
    askYN: async () => {
      const v = yn.shift();
      if (v === undefined) throw new Error("Unexpected askYN()");
      return v;
    },
    selectOption: async () => {
      const v = sel.shift();
      if (v === undefined) throw new Error("Unexpected selectOption()");
      return v;
    },
    askSecret: async () => {
      const v = sec.shift();
      if (v === undefined) throw new Error("Unexpected askSecret()");
      return v;
    },
  };

  return { io, logs };
}

describe("doctor cli", () => {
  it("returns exit code 1 in non-interactive mode when config is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "owliabot-doctor-cli-"));
    try {
      const configPath = path.join(dir, "app.yaml");
      const { io } = createTestIO({ interactive: false });
      const code = await runDoctorCli({ configPath, env: {}, io });
      expect(code).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("can backup+reset config in interactive mode when YAML is broken", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "owliabot-doctor-cli-"));
    try {
      const configPath = path.join(dir, "app.yaml");
      await writeFile(configPath, "providers: [", "utf-8");

      const { io } = createTestIO({ interactive: true, ynAnswers: [true] });
      const code = await runDoctorCli({ configPath, env: {}, io });
      expect(code).toBe(0);

      const files = await readdir(dir);
      expect(files.some((f) => f.startsWith("app.yaml.bak."))).toBe(true);

      // Reset should produce a non-empty yaml file
      const txt = await readFile(configPath, "utf-8");
      expect(txt).toContain("providers:");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("can delete an invalid Telegram token in interactive mode", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "owliabot-doctor-cli-"));
    try {
      const configPath = path.join(dir, "app.yaml");
      await writeFile(
        configPath,
        [
          "providers:",
          "  - id: anthropic",
          "    model: claude-sonnet-4-5",
          "    priority: 1",
          "telegram: {}",
          "",
        ].join("\n"),
        "utf-8",
      );
      await writeFile(
        path.join(dir, "secrets.yaml"),
        ["telegram:", "  token: badtoken", ""].join("\n"),
        "utf-8",
      );

      // Select: Delete stored value
      const { io } = createTestIO({ interactive: true, selectAnswers: [1] });
      const code = await runDoctorCli({ configPath, env: {}, io });
      expect(code).toBe(0);

      const secrets = parse(await readFile(path.join(dir, "secrets.yaml"), "utf-8")) as any;
      expect(secrets.telegram?.token).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not loop when user chooses skip for a credential issue (returns non-zero)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "owliabot-doctor-cli-"));
    try {
      const configPath = path.join(dir, "app.yaml");
      await writeFile(
        configPath,
        [
          "providers:",
          "  - id: anthropic",
          "    model: claude-sonnet-4-5",
          "    priority: 1",
          "telegram: {}",
          "",
        ].join("\n"),
        "utf-8",
      );
      await writeFile(
        path.join(dir, "secrets.yaml"),
        ["telegram:", "  token: badtoken", ""].join("\n"),
        "utf-8",
      );

      // Select: Skip for now
      const { io } = createTestIO({ interactive: true, selectAnswers: [2] });
      const code = await runDoctorCli({ configPath, env: {}, io });
      expect(code).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("can remediate a config-sourced OpenAI apiKey by setting a new value in app.yaml", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "owliabot-doctor-cli-"));
    try {
      const configPath = path.join(dir, "app.yaml");
      await writeFile(
        configPath,
        [
          "providers:",
          "  - id: openai",
          "    model: gpt-5.2",
          "    apiKey: badkey",
          "    priority: 1",
          "",
        ].join("\n"),
        "utf-8",
      );

      // Set new value
      const good = "sk-proj-test_abcdefghijklmnopqrstuvwxyz0123456789";
      const { io } = createTestIO({
        interactive: true,
        selectAnswers: [0],
        secretAnswers: [good],
      });
      const code = await runDoctorCli({ configPath, env: {}, io });
      expect(code).toBe(0);

      const updated = parse(await readFile(configPath, "utf-8")) as any;
      expect(updated.providers?.[0]?.apiKey).toBe(good);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
