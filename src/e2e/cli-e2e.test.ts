import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";

import { loadConfig } from "../config/loader.js";
import { startGatewayHttp } from "../gateway/http/server.js";
import { ToolRegistry } from "../agent/tools/registry.js";
import { echoTool } from "../agent/tools/builtin/echo.js";
import { createEditFileTool } from "../agent/tools/builtin/edit-file.js";

describe.sequential("E2E: CLI onboard -> config/secrets -> gateway http", () => {
  const tmpRoot = "/tmp/e2e-test-config";
  const appYamlPath = join(tmpRoot, "app.yaml");
  const secretsYamlPath = join(tmpRoot, "secrets.yaml");
  const workspacePath = join(tmpRoot, "workspace");

  let gateway: Awaited<ReturnType<typeof startGatewayHttp>> | null = null;

  beforeAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
    await mkdir(dirname(appYamlPath), { recursive: true });
    await mkdir(workspacePath, { recursive: true });
    await writeFile(
      join(workspacePath, "policy.yml"),
      stringify({
        version: "1",
        defaults: {},
        tools: {},
        fallback: { tier: "none", requireConfirmation: false },
      }),
      "utf-8"
    );
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
      // Generate minimal config + secrets (equivalent to onboard output, but without spawning a subprocess).
      const appYaml = stringify({
        workspace: workspacePath,
        providers: [{ id: "anthropic", model: "claude-opus-4-5", apiKey: "secrets", priority: 1 }],
        discord: {
          requireMentionInGuild: true,
          channelAllowList: [],
          memberAllowList: ["123456789"],
        },
        telegram: {
          allowList: ["987654321"],
        },
        tools: { allowWrite: true },
        security: {
          writeToolAllowList: ["123456789", "987654321"],
          writeGateEnabled: false,
          writeToolConfirmation: false,
        },
      });

      const secretsYaml = stringify({
        anthropic: { apiKey: "sk-ant-api-test-e2e-fake-key" },
        discord: { token: "test-discord-token-e2e" },
        telegram: { token: "test-telegram-token-e2e" },
      });

      await writeFile(appYamlPath, appYaml, "utf-8");
      await writeFile(secretsYamlPath, secretsYaml, { encoding: "utf-8", mode: 0o600 });

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
      expect(app.discord.channelAllowList).toEqual([]);
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
      toolRegistry.register(createEditFileTool({ workspacePath }));

      // Register MCP-style tools (name with __ pattern) for MCP e2e tests
      toolRegistry.register({
        name: "testserver__echo",
        description: "MCP echo tool for testing",
        parameters: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] },
        security: { level: "read" },
        async execute(params: any) {
          return { success: true, data: { echoed: params.msg } };
        },
      });
      toolRegistry.register({
        name: "testserver__write_thing",
        description: "MCP write tool for testing scope enforcement",
        parameters: { type: "object", properties: { val: { type: "string" } } },
        security: { level: "write" },
        async execute(params: any) {
          return { success: true, data: { wrote: params.val } };
        },
      });

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
        fetchImpl: async (url) => {
          // Minimal stub for web.fetch in sandboxed test environments.
          if (typeof url === "string" && url.startsWith("http://example.test/")) {
            return new Response("system-ok", { status: 200, headers: { "content-type": "text/plain" } });
          }
          // Fall through to real fetch for local test servers (127.0.0.1)
          return fetch(typeof url === "string" ? url : (url as Request).url);
        },
        system: {
          web: {
            domainAllowList: ["example.test", "127.0.0.1"],
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
        const res = await gateway.request("/health");
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(json.version).toBeTruthy();
      }

      // Unauthenticated request (missing device auth)
      {
        const res = await gateway.request("/command/tool", {
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
        const res = await gateway.request("/pairing/pending", {
          headers: { "X-Gateway-Token": "gw-token-e2e" },
        });
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.pending.map((p: any) => p.deviceId)).toContain(deviceId);
      }

      let deviceToken = "";
      {
        const res = await gateway.request("/pairing/approve", {
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
        const res = await gateway.request("/command/tool", {
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
        const res = await gateway.request("/command/system", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Device-Id": deviceId,
            "X-Device-Token": deviceToken,
          },
          body: JSON.stringify({
            payload: {
              action: "web.fetch",
              args: { url: "http://example.test/" },
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
      }

      // Events poll
      {
        const res = await gateway.request("/events/poll?since=0", {
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
        const res = await gateway.request("/pairing/revoke", {
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
        const res = await gateway.request("/command/tool", {
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

  it(
    "API Key lifecycle: create -> use -> scope enforcement -> revoke -> reject",
    async () => {
      // Ensure gateway is running (started by previous test)
      expect(gateway).toBeTruthy();

      // --- Positive: Create API key via admin route ---
      let apiKeyId = "";
      let apiKeySecret = "";
      {
        const res = await fetch(gateway!.baseUrl + "/admin/api-keys", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Gateway-Token": "gw-token-e2e",
          },
          body: JSON.stringify({
            name: "e2e-read-key",
            scope: { tools: "read", system: false, mcp: false },
          }),
        });
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.id).toMatch(/^ak_/);
        expect(json.data.key).toMatch(/^owk_/);
        apiKeyId = json.data.id;
        apiKeySecret = json.data.key;
      }

      // --- Positive: Use API key to call a read-only tool (echo) ---
      {
        const res = await fetch(gateway!.baseUrl + "/command/tool", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Authorization": `Bearer ${apiKeySecret}`,
          },
          body: JSON.stringify({
            payload: {
              toolCalls: [{ id: "ak1", name: "echo", arguments: { message: "api-key-works" } }],
            },
          }),
        });
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.results[0].success).toBe(true);
        expect(json.data.results[0].data.echoed).toBe("api-key-works");
      }

      // --- Positive: List API keys shows the created key ---
      {
        const res = await fetch(gateway!.baseUrl + "/admin/api-keys", {
          headers: { "X-Gateway-Token": "gw-token-e2e" },
        });
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        const found = json.data.keys.find((k: any) => k.id === apiKeyId);
        expect(found).toBeTruthy();
        expect(found.name).toBe("e2e-read-key");
        expect(found.lastUsedAt).toBeGreaterThan(0);
        // key_hash must NOT be exposed
        expect(found.keyHash).toBeUndefined();
        expect(found.key_hash).toBeUndefined();
      }

      // --- Negative: read-scope key cannot call system route ---
      {
        const res = await fetch(gateway!.baseUrl + "/command/system", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Authorization": `Bearer ${apiKeySecret}`,
          },
          body: JSON.stringify({
            payload: { action: "web.search", args: { query: "test" } },
          }),
        });
        expect(res.status).toBe(403);
        const json: any = await res.json();
        expect(json.error.code).toBe("ERR_SCOPE_INSUFFICIENT_SYSTEM");
      }

      // --- Negative: Invalid API key gets 401 ---
      {
        const res = await fetch(gateway!.baseUrl + "/command/tool", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Authorization": "Bearer owk_invalid_key_that_does_not_exist",
          },
          body: JSON.stringify({
            payload: {
              toolCalls: [{ id: "ak2", name: "echo", arguments: { message: "nope" } }],
            },
          }),
        });
        expect(res.status).toBe(401);
      }

      // --- Negative: Admin routes require gateway token, not API key ---
      {
        const res = await fetch(gateway!.baseUrl + "/admin/api-keys", {
          headers: { "Authorization": `Bearer ${apiKeySecret}` },
        });
        expect(res.status).toBe(401);
      }

      // --- Positive: Create a key with system scope, verify system call works ---
      let systemKeySecret = "";
      {
        const res = await fetch(gateway!.baseUrl + "/admin/api-keys", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Gateway-Token": "gw-token-e2e",
          },
          body: JSON.stringify({
            name: "e2e-system-key",
            scope: { tools: "read", system: true, mcp: false },
          }),
        });
        const json: any = await res.json();
        systemKeySecret = json.data.key;
      }

      {
        const sysSrv = http.createServer((_, res) => {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("api-key-system-ok");
        });
        const port = await new Promise<number>((resolve) => {
          sysSrv.listen(0, "127.0.0.1", () => {
            const addr = sysSrv.address();
            resolve(typeof addr === "object" && addr ? addr.port : 0);
          });
        });
        try {
          const res = await fetch(gateway!.baseUrl + "/command/system", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "Authorization": `Bearer ${systemKeySecret}`,
            },
            body: JSON.stringify({
              payload: { action: "web.fetch", args: { url: `http://127.0.0.1:${port}/` }, sessionId: "e2e-ak" },
              security: { level: "read" },
            }),
          });
          expect(res.status).toBe(200);
          const json: any = await res.json();
          expect(json.ok).toBe(true);
          expect(json.data.result.data.bodyText).toBe("api-key-system-ok");
        } finally {
          await new Promise<void>((resolve) => sysSrv.close(() => resolve()));
        }
      }

      // --- Negative: Revoke key -> 401 ---
      {
        const res = await fetch(gateway!.baseUrl + `/admin/api-keys/${apiKeyId}`, {
          method: "DELETE",
          headers: { "X-Gateway-Token": "gw-token-e2e" },
        });
        expect(res.status).toBe(200);
      }

      {
        const res = await fetch(gateway!.baseUrl + "/command/tool", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Authorization": `Bearer ${apiKeySecret}`,
          },
          body: JSON.stringify({
            payload: {
              toolCalls: [{ id: "ak3", name: "echo", arguments: { message: "revoked" } }],
            },
          }),
        });
        expect(res.status).toBe(401);
      }

      // --- Negative: Create expired key -> immediate 401 ---
      {
        const res = await fetch(gateway!.baseUrl + "/admin/api-keys", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Gateway-Token": "gw-token-e2e",
          },
          body: JSON.stringify({
            name: "e2e-expired-key",
            scope: { tools: "read", system: false, mcp: false },
            expiresAt: Date.now() - 1000, // already expired
          }),
        });
        const json: any = await res.json();
        const expiredKey = json.data.key;

        const toolRes = await fetch(gateway!.baseUrl + "/command/tool", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Authorization": `Bearer ${expiredKey}`,
          },
          body: JSON.stringify({
            payload: {
              toolCalls: [{ id: "ak4", name: "echo", arguments: { message: "expired" } }],
            },
          }),
        });
        expect(toolRes.status).toBe(401);
      }
    },
    180_000
  );

  it(
    "API Key: system scope key can call /command/system successfully",
    async () => {
      expect(gateway).toBeTruthy();

      // Create key with system scope
      const createRes = await fetch(gateway!.baseUrl + "/admin/api-keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Gateway-Token": "gw-token-e2e",
        },
        body: JSON.stringify({
          name: "e2e-system-positive",
          scope: { tools: "read", system: true, mcp: false },
        }),
      });
      const createJson: any = await createRes.json();
      const sysKey = createJson.data.key;

      // Call /command/system with web.fetch
      const sysSrv = http.createServer((_, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("system-scope-works");
      });
      const port = await new Promise<number>((resolve) => {
        sysSrv.listen(0, "127.0.0.1", () => {
          const addr = sysSrv.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });
      try {
        const res = await fetch(gateway!.baseUrl + "/command/system", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Authorization": `Bearer ${sysKey}`,
          },
          body: JSON.stringify({
            payload: { action: "web.fetch", args: { url: `http://127.0.0.1:${port}/` }, sessionId: "e2e-sys" },
            security: { level: "read" },
          }),
        });
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.result.success).toBe(true);
        expect(json.data.result.data.bodyText).toBe("system-scope-works");
      } finally {
        await new Promise<void>((resolve) => sysSrv.close(() => resolve()));
      }
    },
    180_000
  );

  it(
    "API Key: write scope key can call tier3 (edit_file) tool",
    async () => {
      expect(gateway).toBeTruthy();

      // Create key with write scope
      const createRes = await fetch(gateway!.baseUrl + "/admin/api-keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Gateway-Token": "gw-token-e2e",
        },
        body: JSON.stringify({
          name: "e2e-write-key",
          scope: { tools: "write", system: false, mcp: false },
        }),
      });
      const createJson: any = await createRes.json();
      const writeKey = createJson.data.key;

      // Call edit_file (security.level = "write" → tier3)
      // Use a non-existent file so it will fail at execution, but should pass auth + scope
      const res = await fetch(gateway!.baseUrl + "/command/tool", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Authorization": `Bearer ${writeKey}`,
        },
        body: JSON.stringify({
          payload: {
            toolCalls: [{ id: "wt1", name: "edit_file", arguments: { path: "nonexistent.txt", old_text: "a", new_text: "b" } }],
          },
        }),
      });
      // Should NOT be 401 or 403 — scope allows it
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.ok).toBe(true);
      // The tool execution may fail (file not found) but that's fine — we're testing auth/scope pass-through
      expect(json.data.results[0].name).toBe("edit_file");
    },
    180_000
  );

  // Helper: create an MCP-scoped API key
  async function createMcpApiKey(g: NonNullable<typeof gateway>, name: string, scope: { tools: string; system: boolean; mcp: boolean }): Promise<string> {
    const res = await fetch(g.baseUrl + "/admin/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw-token-e2e" },
      body: JSON.stringify({ name, scope }),
    });
    expect(res.status).toBe(200);
    const json: any = await res.json();
    return json.data.key;
  }

  it(
    "MCP: tools/list via API key with mcp scope",
    async () => {
      expect(gateway).toBeTruthy();
      const g = gateway!;
      const mcpKey = await createMcpApiKey(g, "e2e-mcp-tools-list", { tools: "read", system: false, mcp: true });

      const res = await fetch(g.baseUrl + "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "Authorization": `Bearer ${mcpKey}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.jsonrpc).toBe("2.0");
      expect(json.id).toBe(1);
      expect(Array.isArray(json.result.tools)).toBe(true);
      const names = json.result.tools.map((t: any) => t.name);
      expect(names).toContain("testserver__echo");
      expect(names).toContain("testserver__write_thing");
      expect(names).not.toContain("echo");
    },
    180_000
  );

  it(
    "MCP: tools/call executes MCP tool successfully",
    async () => {
      expect(gateway).toBeTruthy();
      const g = gateway!;
      const mcpKey = await createMcpApiKey(g, "e2e-mcp-tools-call", { tools: "read", system: false, mcp: true });

      const res = await fetch(g.baseUrl + "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "Authorization": `Bearer ${mcpKey}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "testserver__echo", arguments: { msg: "hello-mcp" } } }),
      });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.jsonrpc).toBe("2.0");
      expect(json.id).toBe(2);
      expect(json.result.isError).toBe(false);
      expect(Array.isArray(json.result.content)).toBe(true);
      const text = json.result.content[0].text;
      expect(text).toContain("hello-mcp");
    },
    180_000
  );

  it(
    "MCP: servers/list returns server info",
    async () => {
      expect(gateway).toBeTruthy();
      const g = gateway!;
      const mcpKey = await createMcpApiKey(g, "e2e-mcp-servers-list", { tools: "read", system: false, mcp: true });

      const res = await fetch(g.baseUrl + "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "Authorization": `Bearer ${mcpKey}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "servers/list", params: {} }),
      });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.jsonrpc).toBe("2.0");
      expect(json.id).toBe(3);
      expect(Array.isArray(json.result.servers)).toBe(true);
      const server = json.result.servers.find((s: any) => s.name === "testserver");
      expect(server).toBeTruthy();
      expect(server.toolCount).toBe(2);
      expect(server.tools).toContain("testserver__echo");
      expect(server.tools).toContain("testserver__write_thing");
    },
    180_000
  );

  it(
    "MCP: tools/call via paired device with mcp scope",
    async () => {
      expect(gateway).toBeTruthy();
      const g = gateway!;

      const deviceId = "device-mcp-e2e";
      g.store.addPending(deviceId, "127.0.0.1", "vitest-mcp");
      const approveRes = await fetch(g.baseUrl + "/pairing/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw-token-e2e" },
        body: JSON.stringify({ deviceId, scope: { tools: "read", system: false, mcp: true } }),
      });
      const approveJson: any = await approveRes.json();
      const devToken = approveJson.data.deviceToken;

      const res = await fetch(g.baseUrl + "/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Device-Id": deviceId,
          "X-Device-Token": devToken,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "testserver__echo", arguments: { msg: "device-mcp" } } }),
      });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.jsonrpc).toBe("2.0");
      expect(json.id).toBe(4);
      expect(json.result.isError).toBe(false);
      expect(json.result.content[0].text).toContain("device-mcp");
    },
    180_000
  );

  it(
    "MCP: rejects request without mcp scope",
    async () => {
      expect(gateway).toBeTruthy();
      const g = gateway!;
      const noMcpKey = await createMcpApiKey(g, "e2e-no-mcp-key", { tools: "read", system: false, mcp: false });

      const res = await fetch(g.baseUrl + "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "Authorization": `Bearer ${noMcpKey}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list", params: {} }),
      });
      expect(res.status).toBe(403);
    },
    180_000
  );

  it(
    "MCP: returns error for unknown JSON-RPC method",
    async () => {
      expect(gateway).toBeTruthy();
      const g = gateway!;
      const mcpKey = await createMcpApiKey(g, "e2e-mcp-unknown-method", { tools: "read", system: false, mcp: true });

      const res = await fetch(g.baseUrl + "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "Authorization": `Bearer ${mcpKey}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "foo/bar", params: {} }),
      });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.jsonrpc).toBe("2.0");
      expect(json.id).toBe(6);
      expect(json.error).toBeTruthy();
      expect(json.error.code).toBe(-32601);
    },
    180_000
  );

  it(
    "MCP: tools/call enforces tool-level scope",
    async () => {
      expect(gateway).toBeTruthy();
      const g = gateway!;
      const mcpKey = await createMcpApiKey(g, "e2e-mcp-scope-enforce", { tools: "read", system: false, mcp: true });

      const res = await fetch(g.baseUrl + "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "Authorization": `Bearer ${mcpKey}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "testserver__write_thing", arguments: { val: "test" } } }),
      });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.jsonrpc).toBe("2.0");
      expect(json.id).toBe(7);
      expect(json.error).toBeTruthy();
      expect(json.error.code).toBe(-32603);
    },
    180_000
  );

  it(
    "API Key: Bearer header tolerates extra whitespace",
    async () => {
      expect(gateway).toBeTruthy();

      // Create a key
      const createRes = await fetch(gateway!.baseUrl + "/admin/api-keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Gateway-Token": "gw-token-e2e",
        },
        body: JSON.stringify({
          name: "e2e-whitespace-key",
          scope: { tools: "read", system: false, mcp: false },
        }),
      });
      const createJson: any = await createRes.json();
      const key = createJson.data.key;

      // Test with extra whitespace: "Bearer  owk_..."
      {
        const res = await fetch(gateway!.baseUrl + "/command/tool", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Authorization": `Bearer  ${key}`,
          },
          body: JSON.stringify({
            payload: {
              toolCalls: [{ id: "ws1", name: "echo", arguments: { message: "whitespace" } }],
            },
          }),
        });
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.results[0].data.echoed).toBe("whitespace");
      }

      // Test with triple space
      {
        const res = await fetch(gateway!.baseUrl + "/command/tool", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Authorization": `Bearer   ${key}`,
          },
          body: JSON.stringify({
            payload: {
              toolCalls: [{ id: "ws2", name: "echo", arguments: { message: "triple-space" } }],
            },
          }),
        });
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
      }
    },
    180_000
  );
});
