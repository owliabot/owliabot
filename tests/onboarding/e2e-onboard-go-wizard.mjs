#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const goOnboardDir = path.join(rootDir, "client");

const DEFAULT_TIMEOUT_MS = 90_000;

const scenarios = [
  {
    name: "provider-anthropic-discord",
    input: [
      "1", // Welcome: Continue
      "1", // Provider: Anthropic
      "sk-ant-test", // Anthropic token
      "", // Anthropic model (default)
      "1", // Channel: Discord
      "discord-test-token", // Discord token
      "2", // MCP: Done
      "1", // Review: Start initialization
      "5", // Complete: Exit
    ],
    expect: {
      providers: {
        anthropic: { model: "claude-opus-4-5", apiKey: "secrets" },
      },
      secrets: {
        anthropic: { apiKey: "sk-ant-test" },
        discord: { token: "discord-test-token" },
      },
      channels: { discord: true, telegram: false },
    },
  },
  {
    name: "provider-openai-telegram",
    input: [
      "1", // Welcome: Continue
      "2", // Provider: OpenAI
      "sk-openai-test", // OpenAI key
      "", // OpenAI model (default)
      "2", // Channel: Telegram
      "telegram-test-token", // Telegram token
      "2", // MCP: Done
      "1", // Review: Start initialization
      "5", // Complete: Exit
    ],
    expect: {
      providers: {
        openai: { model: "gpt-5.2", apiKey: "secrets" },
      },
      secrets: {
        openai: { apiKey: "sk-openai-test" },
        telegram: { token: "telegram-test-token" },
      },
      channels: { discord: false, telegram: true },
    },
  },
  {
    name: "provider-openai-codex-oauth-both",
    input: [
      "1", // Welcome: Continue
      "3", // Provider: OpenAI Codex (OAuth)
      "", // Codex model (default)
      "1", // Start OAuth now? Yes
      "1", // OAuth: Continue
      "3", // Channel: Both
      "discord-test-token", // Discord token
      "telegram-test-token", // Telegram token
      "2", // MCP: Done
      "1", // Review: Start initialization
      "5", // Complete: Exit
    ],
    expect: {
      providers: {
        "openai-codex": { model: "gpt-5.2", apiKey: "oauth" },
      },
      secrets: {
        discord: { token: "discord-test-token" },
        telegram: { token: "telegram-test-token" },
      },
      channels: { discord: true, telegram: true },
      oauth: true,
    },
  },
  {
    name: "provider-openai-compatible-skip-channels",
    input: [
      "1", // Welcome: Continue
      "4", // Provider: OpenAI-compatible
      "https://example.test/v1", // Base URL
      "", // Model (default)
      "compat-key", // API key
      "4", // Channel: Skip now
      "2", // MCP: Done
      "1", // Review: Start initialization
      "5", // Complete: Exit
    ],
    expect: {
      providers: {
        "openai-compatible": {
          model: "llama3.2",
          apiKey: "secrets",
          baseUrl: "https://example.test/v1",
        },
      },
      secrets: {
        "openai-compatible": { apiKey: "compat-key" },
      },
      channels: { discord: false, telegram: false },
    },
  },
  {
    name: "provider-skip-channel-skip",
    input: [
      "1", // Welcome: Continue
      "6", // Provider: Skip now
      "4", // Channel: Skip now
      "2", // MCP: Done
      "1", // Review: Start initialization
      "5", // Complete: Exit
    ],
    expect: {
      providers: {
        anthropic: { model: "claude-opus-4-5", apiKey: "env" },
      },
      secrets: {},
      channels: { discord: false, telegram: false },
    },
  },
  {
    name: "provider-multiple-discord",
    input: [
      "1", // Welcome: Continue
      "5", // Provider: Multiple
      "sk-ant-test", // Anthropic token
      "", // Anthropic model (default)
      "sk-openai-test", // OpenAI key
      "", // OpenAI model (default)
      "", // Codex model (default)
      "2", // Start OAuth now? No
      "https://compat.test/v1", // OpenAI-compatible base URL
      "", // OpenAI-compatible model (default)
      "compat-key", // OpenAI-compatible API key
      "1", // Channel: Discord
      "discord-test-token", // Discord token
      "2", // MCP: Done
      "1", // Review: Start initialization
      "5", // Complete: Exit
    ],
    expect: {
      providers: {
        anthropic: { model: "claude-opus-4-5", apiKey: "secrets" },
        openai: { model: "gpt-5.2", apiKey: "secrets" },
        "openai-codex": { model: "gpt-5.2", apiKey: "oauth" },
        "openai-compatible": {
          model: "llama3.2",
          apiKey: "secrets",
          baseUrl: "https://compat.test/v1",
        },
      },
      secrets: {
        anthropic: { apiKey: "sk-ant-test" },
        openai: { apiKey: "sk-openai-test" },
        "openai-compatible": { apiKey: "compat-key" },
        discord: { token: "discord-test-token" },
      },
      channels: { discord: true, telegram: false },
    },
  },
];

let failures = 0;

for (const scenario of scenarios) {
  try {
    await runScenario(scenario);
    console.log(`✅ ${scenario.name}`);
  } catch (err) {
    failures++;
    console.error(`❌ ${scenario.name}`);
    console.error(err?.stack || err);
  }
}

process.exit(failures > 0 ? 1 : 0);

async function runScenario(scenario) {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "owliabot-onboard-config-"));
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "owliabot-onboard-output-"));

  let transcript = "";
  let exitCode = 1;
  let timedOut = false;
  let spawnError = null;
  let done = false;
  const outputWaiters = [];

  try {
    const child = spawn(
      "go",
      ["run", ".", "--config-dir", configDir, "--output-dir", outputDir],
      {
        cwd: goOnboardDir,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        env: {
          ...process.env,
          OWLIABOT_ONBOARD_SKIP_DOCKER: "1",
          OWLIABOT_OAUTH_DEVICE_CODE_ONLY: "1",
          GOCACHE: process.env.GOCACHE ?? path.join(os.tmpdir(), "go-build"),
          GOMODCACHE: process.env.GOMODCACHE ?? path.join(os.tmpdir(), "go-mod"),
          CGO_ENABLED: process.env.CGO_ENABLED ?? "0",
        },
      },
    );

    child.stdin.on("error", () => {});
    child.on("error", (err) => {
      spawnError = err;
      terminate(child);
    });

    const onData = (chunk) => {
      const text = chunk.toString("utf8");
      transcript += text;
      flushOutputWaiters(outputWaiters);
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    const feedPromise = (async () => {
      await waitForOutputTick(outputWaiters, () => done);
      await feedInputs(child, scenario.input, outputWaiters, () => done);
    })().catch(() => {});

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, DEFAULT_TIMEOUT_MS);

    exitCode = await new Promise((resolve) => {
      child.on("close", (code) => resolve(code ?? 1));
    });
    done = true;
    flushOutputWaiters(outputWaiters);
    await feedPromise;
    clearTimeout(timeout);

    const plainTranscript = normalizeTerminalText(transcript);

    if (spawnError) {
      throw new Error(`wizard spawn failed: ${spawnError.message}`);
    }
    if (timedOut) {
      throw new Error(`wizard timed out after ${DEFAULT_TIMEOUT_MS}ms`);
    }
    if (exitCode !== 0) {
      throw new Error(`wizard exited with code ${exitCode}\n${plainTranscript.slice(-4000)}`);
    }

    const app = await readYaml(path.join(configDir, "app.yaml"));
    const secrets = await readYaml(path.join(configDir, "secrets.yaml"));

    assertProviders(app, scenario.expect.providers);
    assertSecrets(secrets, scenario.expect.secrets);
    assertChannels(app, scenario.expect.channels);

    if (scenario.expect.oauth) {
      if (!/device code|open url|https:\/\/auth\.openai\.com\/codex\/device/i.test(plainTranscript)) {
        throw new Error("expected OAuth device code or verification URL in transcript");
      }
    }
  } finally {
    await rm(configDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  }
}

function terminate(child) {
  if (!child || !child.pid) return;
  if (process.platform === "win32") {
    child.kill();
    return;
  }
  const killGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      return false;
    }
  };
  if (!killGroup("SIGINT")) {
    child.kill("SIGINT");
  }
  setTimeout(() => {
    if (!killGroup("SIGKILL") && !child.killed) {
      child.kill("SIGKILL");
    }
  }, 1200).unref();
}

async function feedInputs(child, lines, outputWaiters, isDone) {
  for (const line of lines) {
    if (isDone()) return;
    child.stdin.write(`${line}\n`);
    await waitForOutputTick(outputWaiters, isDone);
  }
}

function waitForOutputTick(outputWaiters, isDone) {
  return new Promise((resolve) => {
    if (isDone()) {
      resolve();
      return;
    }
    outputWaiters.push(resolve);
  });
}

function flushOutputWaiters(outputWaiters) {
  while (outputWaiters.length > 0) {
    const resolve = outputWaiters.shift();
    resolve();
  }
}

async function readYaml(filePath) {
  const raw = await readFile(filePath, "utf-8");
  const data = parse(raw);
  return data ?? {};
}

function assertProviders(app, expected) {
  const providers = Array.isArray(app.providers) ? app.providers : [];
  for (const [id, details] of Object.entries(expected)) {
    const provider = providers.find((p) => p.id === id);
    if (!provider) {
      throw new Error(`missing provider ${id}`);
    }
    if (details.model && provider.model !== details.model) {
      throw new Error(`provider ${id} model mismatch: ${provider.model}`);
    }
    if (details.apiKey && provider.apiKey !== details.apiKey) {
      throw new Error(`provider ${id} apiKey mismatch: ${provider.apiKey}`);
    }
    if (details.baseUrl && provider.baseUrl !== details.baseUrl) {
      throw new Error(`provider ${id} baseUrl mismatch: ${provider.baseUrl}`);
    }
  }
}

function assertSecrets(secrets, expected) {
  const filtered = { ...(secrets ?? {}) };
  delete filtered.gateway;

  for (const [key, details] of Object.entries(expected)) {
    const section = filtered?.[key];
    if (!section) {
      throw new Error(`missing secrets section ${key}`);
    }
    if (details.apiKey && section.apiKey !== details.apiKey) {
      throw new Error(`secret ${key}.apiKey mismatch: ${section.apiKey}`);
    }
    if (details.token && section.token !== details.token) {
      throw new Error(`secret ${key}.token mismatch: ${section.token}`);
    }
  }

  if (Object.keys(expected).length === 0) {
    const hasSecrets = filtered && Object.keys(filtered).length > 0;
    if (hasSecrets) {
      throw new Error(`expected no secrets, found: ${Object.keys(filtered).join(", ")}`);
    }
  }
}

function assertChannels(app, expected) {
  const hasDiscord = Object.prototype.hasOwnProperty.call(app ?? {}, "discord");
  const hasTelegram = Object.prototype.hasOwnProperty.call(app ?? {}, "telegram");
  if (expected.discord !== hasDiscord) {
    throw new Error(`discord config presence mismatch: ${hasDiscord}`);
  }
  if (expected.telegram !== hasTelegram) {
    throw new Error(`telegram config presence mismatch: ${hasTelegram}`);
  }
}

function normalizeTerminalText(value) {
  let output = value.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "");
  output = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  output = output.replace(/\u001b[@-_]/g, "");
  output = output.replace(/\r/g, "");
  return output;
}
