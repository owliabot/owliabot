import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile, readdir, readFile } from "node:fs/promises";
import { parse } from "yaml";

import { configSchema } from "../../config/schema.js";
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

      const cfgObj = parse(await readFile(configPath, "utf-8"));
      expect(() => configSchema.parse(cfgObj)).not.toThrow();
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
});

