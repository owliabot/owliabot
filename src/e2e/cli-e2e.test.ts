import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse } from "yaml";

import { loadConfig } from "../config/loader.js";
import { startGatewayHttp } from "../gateway-http/server.js";

const execFileAsync = promisify(execFile);

async function run(cmd: string, args: string[], opts?: { cwd?: string }) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd: opts?.cwd,
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
}

async function runOnboardCli(opts: { cwd: string; appYamlPath: string; answers: string[] }) {
  const prompts = [
    "Enable channels (discord/telegram) [discord]: ",
    "Workspace path [./workspace]: ",
    "Anthropic model [claude-sonnet-4-5]: ",
    "Use Anthropic OAuth now? (y/n) [n=skip for now]: ",
    "In guild, require @mention unless channel allowlisted? (y/n) [y]: ",
    "Discord guild channelAllowList (comma-separated channel IDs) [1467915124764573736]: ",
    "Discord bot token (leave empty to set later via `owliabot token set discord`) [skip]: ",
    "Telegram bot token (leave empty to set later via `owliabot token set telegram`) [skip]: ",
  ];

  const child = spawn("node", ["dist/entry.js", "onboard", "--path", opts.appYamlPath], {
    cwd: opts.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  const answers = [...opts.answers];
  let stdout = "";
  let stderr = "";
  let promptIndex = 0;

  function tryRespond() {
    while (promptIndex < prompts.length && stdout.includes(prompts[promptIndex])) {
      const ans = answers.shift() ?? "";
      child.stdin.write(ans + "\n");
      promptIndex++;
    }
  }

  child.stdout.on("data", (d) => {
    stdout += String(d);
    tryRespond();
  });
  child.stderr.on("data", (d) => {
    stderr += String(d);
  });

  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });

  if (code !== 0) {
    throw new Error(
      `node dist/entry.js onboard --path ${opts.appYamlPath} exited with code ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
    );
  }

  return { stdout, stderr };
}

describe.sequential("E2E: CLI onboard -> config/secrets -> gateway-http", () => {
  const repoRoot = process.cwd();
  const tmpRoot = "/tmp/e2e-test-config";
  const appYamlPath = join(tmpRoot, "app.yaml");
  const secretsYamlPath = join(tmpRoot, "secrets.yaml");
  const workspacePath = join(tmpRoot, "workspace");

  let gateway: Awaited<ReturnType<typeof startGatewayHttp>> | null = null;

  beforeAll(async () => {
    // Step 1 — Build CLI and verify help
    await run("npm", ["run", "build"], { cwd: repoRoot });
    await run("node", ["dist/entry.js", "--help"], { cwd: repoRoot });

    // Prepare output dirs for onboarding
    await rm(tmpRoot, { recursive: true, force: true });
    await mkdir(dirname(appYamlPath), { recursive: true });
  }, 180_000);

  afterAll(async () => {
    if (gateway) {
      await gateway.stop();
      gateway = null;
    }
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it(
    "runs onboarding, validates generated config, starts gateway, and exercises pairing + tool + events",
    async () => {
      // Step 2 + 3 — Execute onboard (simulate stdin, no real tokens)
      await runOnboardCli({
        cwd: repoRoot,
        appYamlPath,
        answers: [
          "discord,telegram", // Enable channels
          workspacePath, // Workspace path
          "", // Anthropic model (default)
          "n", // Skip OAuth
          "", // requireMentionInGuild (default y)
          "", // channelAllowList (default)
          "test-discord-token-e2e", // Discord token
          "test-telegram-token-e2e", // Telegram token
        ],
      });

      // Step 4 — Check generated config files
      const appYamlRaw = await readFile(appYamlPath, "utf-8");
      const secretsYamlRaw = await readFile(secretsYamlPath, "utf-8");

      const app: any = parse(appYamlRaw);
      const secrets: any = parse(secretsYamlRaw);

      expect(app.workspace).toBe(workspacePath);
      expect(Array.isArray(app.providers)).toBe(true);
      expect(app.providers[0]).toMatchObject({ id: "anthropic", apiKey: "oauth" });

      expect(app.discord).toBeTruthy();
      expect(app.discord.requireMentionInGuild).toBe(true);
      expect(app.discord.channelAllowList).toContain("1467915124764573736");

      // Onboarding only writes telegram section if token was provided
      expect(app.telegram).toEqual({});

      expect(secrets.discord.token).toBe("test-discord-token-e2e");
      expect(secrets.telegram.token).toBe("test-telegram-token-e2e");

      const st = await stat(secretsYamlPath);
      expect(st.mode & 0o777).toBe(0o600);

      // Validate that the standard config loader can load this and merge tokens
      const loaded = await loadConfig(appYamlPath);
      expect(loaded.discord?.token).toBe("test-discord-token-e2e");
      expect(loaded.telegram?.token).toBe("test-telegram-token-e2e");
      expect(loaded.workspace).toBe(workspacePath);

      // Step 5 — Start gateway + send requests
      gateway = await startGatewayHttp({
        config: {
          host: "127.0.0.1",
          port: 0,
          token: "gw-token-e2e",
          allowlist: ["127.0.0.1"],
          sqlitePath: ":memory:",
          idempotencyTtlMs: 10 * 60 * 1000,
          eventTtlMs: 24 * 60 * 60 * 1000,
          rateLimit: { windowMs: 60_000, max: 60 },
        },
        workspacePath: loaded.workspace,
      });

      // Health
      {
        const res = await fetch(gateway.baseUrl + "/health");
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(json.version).toBeTruthy();
      }

      // Unauthenticated request (missing device auth)
      {
        const res = await fetch(gateway.baseUrl + "/command/tool", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payload: { toolCalls: [] } }),
        });
        expect(res.status).toBe(401);
      }

      // Pairing flow: request -> pending -> approve -> token
      const deviceId = "device-e2e-1";
      gateway.store.addPending(deviceId, "127.0.0.1", "vitest");

      {
        const res = await fetch(gateway.baseUrl + "/pairing/pending", {
          headers: { "X-Gateway-Token": "gw-token-e2e" },
        });
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.pending.map((p: any) => p.deviceId)).toContain(deviceId);
      }

      let deviceToken = "";
      {
        const res = await fetch(gateway.baseUrl + "/pairing/approve", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Gateway-Token": "gw-token-e2e",
          },
          body: JSON.stringify({ deviceId }),
        });
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        deviceToken = json.data.deviceToken;
        expect(typeof deviceToken).toBe("string");
        expect(deviceToken.length).toBeGreaterThan(10);
      }

      // Tool call with device token
      {
        const res = await fetch(gateway.baseUrl + "/command/tool", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Device-Id": deviceId,
            "X-Device-Token": deviceToken,
          },
          body: JSON.stringify({
            payload: {
              toolCalls: [{ id: "1", name: "echo", arguments: { message: "hello" } }],
            },
          }),
        });
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.results[0]).toMatchObject({
          id: "1",
          name: "echo",
          success: true,
        });
        expect(json.data.results[0].data.echoed).toBe("hello");
      }

      // Events poll
      {
        const res = await fetch(gateway.baseUrl + "/events/poll?since=0");
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(Array.isArray(json.events)).toBe(true);
        expect(json.events.some((e: any) => e.type === "command.tool")).toBe(true);
      }

      // Revoke device -> tool call should be 401
      {
        const res = await fetch(gateway.baseUrl + "/pairing/revoke", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Gateway-Token": "gw-token-e2e",
          },
          body: JSON.stringify({ deviceId }),
        });
        expect(res.status).toBe(200);
      }

      {
        const res = await fetch(gateway.baseUrl + "/command/tool", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Device-Id": deviceId,
            "X-Device-Token": deviceToken,
          },
          body: JSON.stringify({
            payload: {
              toolCalls: [{ id: "2", name: "echo", arguments: { message: "should-fail" } }],
            },
          }),
        });
        expect(res.status).toBe(401);
      }
    },
    180_000
  );
});
