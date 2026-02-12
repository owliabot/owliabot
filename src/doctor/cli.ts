import { createInterface } from "node:readline";

import {
  diagnoseDoctor,
  resetConfigFile,
  setChannelToken,
  deleteChannelToken,
  setProviderSecret,
  deleteProviderSecret,
  setProviderApiKeyInConfig,
  setProviderApiKeyModeInConfig,
  deleteProviderApiKeyInConfig,
  type DoctorIssue,
} from "./index.js";

const COLORS = {
  RED: "\x1b[0;31m",
  GREEN: "\x1b[0;32m",
  YELLOW: "\x1b[1;33m",
  BLUE: "\x1b[0;34m",
  CYAN: "\x1b[0;36m",
  NC: "\x1b[0m",
};

function uiInfo(msg: string): void { console.log(`${COLORS.BLUE}i${COLORS.NC} ${msg}`); }
function uiSuccess(msg: string): void { console.log(`${COLORS.GREEN}✓${COLORS.NC} ${msg}`); }
function uiWarn(msg: string): void { console.log(`${COLORS.YELLOW}!${COLORS.NC} ${msg}`); }
function uiError(msg: string): void { console.log(`${COLORS.RED}x${COLORS.NC} ${msg}`); }
function uiHeader(title: string): void {
  console.log("");
  console.log(`${COLORS.CYAN}━━━ ${title} ━━━${COLORS.NC}`);
  console.log("");
}

type RL = ReturnType<typeof createInterface>;

function ask(rl: RL, q: string, secret = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const onClose = () => reject(new Error("input closed"));
    rl.once("close", onClose);
    const done = (value: string) => {
      rl.removeListener("close", onClose);
      resolve(value.trim());
    };
    if (!secret) {
      rl.question(q, done);
      return;
    }
    rl.question(q, (ans) => done(ans));
  });
}

async function askYN(rl: RL, q: string, defaultYes = false): Promise<boolean> {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const ans = await ask(rl, `${q} ${suffix}: `);
  if (!ans) return defaultYes;
  return ans.toLowerCase().startsWith("y");
}

async function selectOption(rl: RL, prompt: string, options: string[]): Promise<number> {
  console.log(prompt);
  options.forEach((opt, i) => console.log(`  ${i + 1}) ${opt}`));
  while (true) {
    const ans = await ask(rl, `Pick a number [1-${options.length}]: `);
    const num = Number.parseInt(ans, 10);
    if (num >= 1 && num <= options.length) return num - 1;
    uiWarn(`Please type a number between 1 and ${options.length}.`);
  }
}

type FixOutcome = "fixed" | "deleted" | "skipped" | "not_applicable";

export interface DoctorIO {
  interactive: boolean;
  print: (msg: string) => void;
  header?: (title: string) => void;
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
  success?: (msg: string) => void;
  askYN?: (q: string, defaultYes?: boolean) => Promise<boolean>;
  selectOption?: (prompt: string, options: string[]) => Promise<number>;
  askSecret?: (q: string) => Promise<string>;
}

export function createDefaultDoctorIO(opts?: { interactive?: boolean }): {
  io: DoctorIO;
  close: () => void;
} {
  const interactive =
    opts?.interactive ??
    Boolean(process.stdin.isTTY && process.stdout.isTTY);

  if (!interactive) {
    return {
      io: {
        interactive: false,
        print: (msg) => console.log(msg),
        header: uiHeader,
        info: uiInfo,
        warn: uiWarn,
        error: uiError,
        success: uiSuccess,
      },
      close: () => {},
    };
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    io: {
      interactive: true,
      print: (msg) => console.log(msg),
      header: uiHeader,
      info: uiInfo,
      warn: uiWarn,
      error: uiError,
      success: uiSuccess,
      askYN: (q, defaultYes) => askYN(rl, q, defaultYes),
      selectOption: (prompt, options) => selectOption(rl, prompt, options),
      askSecret: (q) => ask(rl, q, true),
    },
    close: () => rl.close(),
  };
}

function printIssues(io: DoctorIO, issues: DoctorIssue[]): void {
  for (const issue of issues) {
    const sev = issue.severity.toUpperCase();
    const src = issue.source ? ` (${issue.source})` : "";
    io.print(`${sev} ${issue.id}${src}: ${issue.message}`);
  }
}

async function fixConfigIssues(opts: {
  configPath: string;
  io: DoctorIO;
  issues: DoctorIssue[];
}): Promise<FixOutcome> {
  const { io, issues } = opts;
  const hasConfigError = issues.some((i) => i.severity === "error" && i.id.startsWith("config."));
  if (!hasConfigError) return "not_applicable";

  const ok = io.askYN ? await io.askYN("Config looks broken. Backup and reset it now?", true) : false;
  if (!ok) return "skipped";

  const { backupPath } = await resetConfigFile({ configPath: opts.configPath, backup: true });
  if (backupPath) {
    io.success?.(`Backed up previous config: ${backupPath}`);
  } else {
    io.info?.("No existing config to back up.");
  }
  io.success?.("Config reset to a minimal template.");
  return "fixed";
}

async function fixCredentialIssue(opts: {
  configPath: string;
  io: DoctorIO;
  issue: DoctorIssue;
}): Promise<FixOutcome> {
  const { io, issue } = opts;
  if (!issue.id.startsWith("credential.")) return "not_applicable";
  if (!io.selectOption) return "not_applicable";

  const action = await io.selectOption(
    `Fix ${issue.id}?`,
    ["Set a new value", "Delete stored value", "Skip for now"],
  );

  if (action === 2) return "skipped";

  if (action === 0 && !io.askSecret) {
    throw new Error("Interactive secret input is not available");
  }

  const setNew = async (setter: (value: string) => Promise<void>) => {
    const value = (await io.askSecret!("Enter new value (hidden): ")).trim();
    if (!value) throw new Error("Empty value");
    await setter(value);
    io.success?.("Saved.");
  };

  const del = async (deleter: () => Promise<void>) => {
    await deleter();
    io.success?.("Deleted.");
  };

  switch (issue.id) {
    case "credential.telegram.token.invalid_format": {
      if (action === 0) await setNew((v) => setChannelToken({ configPath: opts.configPath, channel: "telegram", token: v }));
      if (action === 1) await del(() => deleteChannelToken({ configPath: opts.configPath, channel: "telegram" }));
      return action === 1 ? "deleted" : "fixed";
    }
    case "credential.discord.token.invalid_format": {
      if (action === 0) await setNew((v) => setChannelToken({ configPath: opts.configPath, channel: "discord", token: v }));
      if (action === 1) await del(() => deleteChannelToken({ configPath: opts.configPath, channel: "discord" }));
      return action === 1 ? "deleted" : "fixed";
    }
    case "credential.openai.apiKey.invalid_format": {
      const source = issue.source ?? "secrets";
      if (action === 0) {
        await setNew(async (v) => {
          if (source === "config") {
            await setProviderApiKeyInConfig({ configPath: opts.configPath, providerId: "openai", apiKey: v });
            return;
          }
          if (source === "env") {
            // Can't write env vars, so switch provider to secrets and persist there.
            await setProviderApiKeyModeInConfig({ configPath: opts.configPath, providerId: "openai", mode: "secrets" });
          }
          await setProviderSecret({ configPath: opts.configPath, provider: "openai", field: "apiKey", value: v });
        });
        return "fixed";
      }
      if (action === 1) {
        await del(async () => {
          if (source === "config") {
            await deleteProviderApiKeyInConfig({ configPath: opts.configPath, providerId: "openai" });
            return;
          }
          if (source === "env") {
            await setProviderApiKeyModeInConfig({ configPath: opts.configPath, providerId: "openai", mode: "secrets" });
          }
          await deleteProviderSecret({ configPath: opts.configPath, provider: "openai", field: "apiKey" });
        });
        return "deleted";
      }
      return "not_applicable";
    }
    case "credential.anthropic.token.invalid_format": {
      const source = issue.source ?? "secrets";
      if (action === 0) {
        await setNew(async (v) => {
          if (source === "config") {
            await setProviderApiKeyInConfig({ configPath: opts.configPath, providerId: "anthropic", apiKey: v });
            return;
          }
          if (source === "env") {
            await setProviderApiKeyModeInConfig({ configPath: opts.configPath, providerId: "anthropic", mode: "secrets" });
          }
          await setProviderSecret({ configPath: opts.configPath, provider: "anthropic", field: "token", value: v });
        });
        return "fixed";
      }
      if (action === 1) {
        await del(async () => {
          if (source === "config") {
            await deleteProviderApiKeyInConfig({ configPath: opts.configPath, providerId: "anthropic" });
            return;
          }
          if (source === "env") {
            await setProviderApiKeyModeInConfig({ configPath: opts.configPath, providerId: "anthropic", mode: "secrets" });
          }
          await deleteProviderSecret({ configPath: opts.configPath, provider: "anthropic", field: "token" });
        });
        return "deleted";
      }
      return "not_applicable";
    }
    case "credential.anthropic.apiKey.invalid_format": {
      const source = issue.source ?? "secrets";
      if (action === 0) {
        await setNew(async (v) => {
          if (source === "config") {
            await setProviderApiKeyInConfig({ configPath: opts.configPath, providerId: "anthropic", apiKey: v });
            return;
          }
          if (source === "env") {
            await setProviderApiKeyModeInConfig({ configPath: opts.configPath, providerId: "anthropic", mode: "secrets" });
          }
          await setProviderSecret({ configPath: opts.configPath, provider: "anthropic", field: "apiKey", value: v });
        });
        return "fixed";
      }
      if (action === 1) {
        await del(async () => {
          if (source === "config") {
            await deleteProviderApiKeyInConfig({ configPath: opts.configPath, providerId: "anthropic" });
            return;
          }
          if (source === "env") {
            await setProviderApiKeyModeInConfig({ configPath: opts.configPath, providerId: "anthropic", mode: "secrets" });
          }
          await deleteProviderSecret({ configPath: opts.configPath, provider: "anthropic", field: "apiKey" });
        });
        return "deleted";
      }
      return "not_applicable";
    }
    default:
      io.warn?.("No automatic fix available for this issue; please edit your config/secrets manually.");
      return "skipped";
  }
}

export async function runDoctorCli(opts: {
  configPath: string;
  env?: Record<string, string | undefined>;
  io: DoctorIO;
}): Promise<number> {
  const { io } = opts;
  io.header?.("Doctor");
  io.info?.(`Config: ${opts.configPath}`);

  // Prevent accidental infinite loops (e.g., user keeps skipping).
  for (let round = 0; round < 10; round++) {
    const report = await diagnoseDoctor({ configPath: opts.configPath, env: opts.env });

    if (report.ok) {
      io.success?.("No blocking issues found.");
      return 0;
    }

    printIssues(io, report.issues);

    if (!io.interactive) {
      return 1;
    }

    // 1) Config errors: offer backup + reset
    const configOutcome = await fixConfigIssues({ configPath: opts.configPath, io, issues: report.issues });
    if (configOutcome === "fixed") continue;
    if (configOutcome === "skipped") {
      io.error?.("Unresolved config issues remain.");
      return 1;
    }

    // 2) Credential format errors: offer set/delete
    const cred = report.issues.find((i) => i.severity === "error" && i.id.startsWith("credential."));
    if (cred) {
      const outcome = await fixCredentialIssue({ configPath: opts.configPath, io, issue: cred });
      if (outcome === "fixed" || outcome === "deleted") continue;
      if (outcome === "skipped") {
        io.error?.("Unresolved credential issues remain.");
        return 1;
      }
    }

    // 3) Unknown errors: no auto-fix
    io.error?.("Doctor found errors that require manual fixes.");
    return 1;
  }

  io.error?.("Doctor exceeded max fix attempts.");
  return 1;
}
