import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import http from "node:http";
import { parse } from "yaml";

import { loadConfig } from "../config/loader.js";
import { startGatewayHttp } from "../gateway/http/server.js";
import { ToolRegistry } from "../agent/tools/registry.js";
import { echoTool } from "../agent/tools/builtin/echo.js";

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
  // Updated prompts to match refactored onboard.ts with selectOption
  // Includes Discord/Telegram allowlists and writeGate allowlist prompts
  const prompts = [
    "Select [1-3]: ",                                    // Chat platform: 3 = Both
    "Discord bot token (leave empty to set later): ",    // Discord token
    "Telegram bot token (leave empty to set later): ",   // Telegram token
    "Workspace path [",                                  // Workspace (default path is dynamic)
    "Select [1-5]: ",                                    // AI provider: 1 = Anthropic
    "Paste setup-token or API key (leave empty for env var): ", // Anthropic key
    "Model [claude-opus-4-5]: ",                         // Model
    "Enable Gateway HTTP? [y/N]: ",                      // Gateway
    "Channel allowlist (comma-separated channel IDs, leave empty for all): ", // Discord channelAllowList
    "Member allowlist - user IDs allowed to interact (comma-separated, leave empty for all): ", // Discord memberAllowList
    "Require @mention to respond in servers? (recommended) [Y/n]: ",          // Discord requireMention
    "User allowlist - user IDs allowed to interact (comma-separated): ",      // Telegram allowList
    "Additional user IDs to allow (comma-separated, leave empty to use only channel users): ", // writeGate (only shown if channel users exist)
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

describe.sequential("E2E: CLI onboard -> config/secrets -> gateway http", () => {
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
      // Answers match the new refactored prompts order including allowlists
      await runOnboardCli({
        cwd: repoRoot,
        appYamlPath,
        answers: [
          "3",                             // Chat platform: 3 = Both (Discord + Telegram)
          "test-discord-token-e2e",        // Discord token
          "test-telegram-token-e2e",       // Telegram token
          workspacePath,                   // Workspace path
          "1",                             // AI provider: 1 = Anthropic
          "sk-ant-api-test-e2e-fake-key",  // Anthropic API key
          "",                              // Model (default claude-opus-4-5)
          "n",                             // Gateway HTTP: no
          "",                              // Discord channelAllowList (empty)
          "123456789",                     // Discord memberAllowList
          "y",                             // Require @mention in guild
          "987654321",                     // Telegram allowList
          "",                              // writeGate additional IDs (use defaults from channel)
        ],
      });

      // Step 4 — Check generated config files
      const appYamlRaw = await readFile(appYamlPath, "utf-8");
      const secretsYamlRaw = await readFile(secretsYamlPath, "utf-8");

      const app: any = parse(appYamlRaw);
      const secrets: any = parse(secretsYamlRaw);

      expect(app.workspace).toBe(workspacePath);
      expect(Array.isArray(app.providers)).toBe(true);
      expect(app.providers[0]).toMatchObject({ id: "anthropic", apiKey: "secrets" });

      expect(app.discord).toBeTruthy();
      expect(app.discord.requireMentionInGuild).toBe(true);
      // manualDiscordSetup returns undefined for empty channelAllowList
      expect(app.discord.channelAllowList).toBeUndefined();
      expect(app.discord.memberAllowList).toEqual(["123456789"]);

      // Telegram section includes allowList
      expect(app.telegram.allowList).toEqual(["987654321"]);

      // Security section with writeGate
      expect(app.tools).toBeTruthy();
      expect(app.tools.allowWrite).toBe(true);
      expect(app.security).toBeTruthy();
      expect(app.security.writeToolAllowList).toEqual(["123456789", "987654321"]);
      expect(app.security.writeGateEnabled).toBe(false);
      expect(app.security.writeToolConfirmation).toBe(false);

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
      const toolRegistry = new ToolRegistry();
      toolRegistry.register(echoTool);

      gateway = await startGatewayHttp({
        toolRegistry,
        sessionStore: undefined as any,
        transcripts: undefined as any,
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
        system: {
          web: {
            domainAllowList: ["127.0.0.1"],
            domainDenyList: [],
            allowPrivateNetworks: true,
            timeoutMs: 5_000,
            maxResponseBytes: 128 * 1024,
            userAgent: "owliabot-e2e",
            blockOnSecret: true,
          },
          exec: {
            commandAllowList: [],
            envAllowList: ["PATH", "LANG"],
            timeoutMs: 30_000,
            maxOutputBytes: 64 * 1024,
          },
          webSearch: {
            defaultProvider: "duckduckgo",
            timeoutMs: 10_000,
            maxResults: 5,
          },
        },
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
          body: JSON.stringify({ deviceId, scope: { tools: "sign", system: true, mcp: false } }),
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

      // System call: web.fetch
      {
        const sysSrv = http.createServer((_, res) => {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("system-ok");
        });

        const port = await new Promise<number>((resolve) => {
          sysSrv.listen(0, "127.0.0.1", () => {
            const addr = sysSrv.address();
            resolve(typeof addr === "object" && addr ? addr.port : 0);
          });
        });

        try {
          const targetUrl = `http://127.0.0.1:${port}/`;
          const res = await fetch(gateway.baseUrl + "/command/system", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "X-Device-Id": deviceId,
              "X-Device-Token": deviceToken,
            },
            body: JSON.stringify({
              payload: {
                action: "web.fetch",
                args: { url: targetUrl },
                sessionId: "e2e",
              },
              security: { level: "read" },
            }),
          });
          expect(res.status).toBe(200);
          const json: any = await res.json();
          expect(json.ok).toBe(true);
          expect(json.data.result.success).toBe(true);
          expect(json.data.result.data.bodyText).toBe("system-ok");
        } finally {
          await new Promise<void>((resolve) => sysSrv.close(() => resolve()));
        }
      }

      // Events poll
      {
        const res = await fetch(gateway.baseUrl + "/events/poll?since=0", {
          headers: {
            "X-Device-Id": deviceId,
            "X-Device-Token": deviceToken,
          },
        });
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(Array.isArray(json.events)).toBe(true);
        expect(json.events.some((e: any) => e.type === "command.tool")).toBe(true);
        expect(json.events.some((e: any) => e.type === "command.system")).toBe(true);
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
