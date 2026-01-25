# OwliaBot MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a working Telegram bot that can receive messages, call LLM with workspace context, and respond.

**Architecture:** Config loader reads YAML → Gateway starts Telegram plugin → Messages route to Agent → Agent builds system prompt from workspace files + calls LLM → Response sent back via Telegram.

**Tech Stack:** TypeScript ESM, grammy (Telegram), undici (HTTP), Zod (config), tslog (logging)

---

## Prerequisites

- Node.js 22+
- Telegram bot token (from @BotFather)
- Anthropic API key
- Project already initialized with interfaces defined

---

## Task 1: Config Loader

**Files:**
- Create: `src/config/loader.ts`
- Create: `src/config/types.ts`
- Modify: `src/config/schema.ts` (add exports)

**Step 1: Create types file**

```typescript
// src/config/types.ts
import type { Config } from "./schema.js";

export type { Config };

export interface ConfigLoader {
  load(path: string): Promise<Config>;
}
```

**Step 2: Create config loader**

```typescript
// src/config/loader.ts
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { configSchema, type Config } from "./schema.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("config");

export async function loadConfig(path: string): Promise<Config> {
  log.info(`Loading config from ${path}`);

  const content = await readFile(path, "utf-8");
  const raw = parse(content);

  // Expand environment variables
  const expanded = expandEnvVars(raw);

  // Validate with Zod
  const config = configSchema.parse(expanded);

  log.info("Config loaded successfully");
  return config;
}

function expandEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? "");
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvVars);
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVars(value);
    }
    return result;
  }
  return obj;
}
```

**Step 3: Verify it compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/config/
git commit -m "feat(config): add config loader with env var expansion"
```

---

## Task 2: Workspace Loader

**Files:**
- Create: `src/workspace/loader.ts`
- Create: `src/workspace/types.ts`
- Create: `workspace/SOUL.md` (example)
- Create: `workspace/IDENTITY.md` (example)
- Create: `workspace/USER.md` (example)

**Step 1: Create workspace types**

```typescript
// src/workspace/types.ts
export interface WorkspaceFiles {
  soul?: string;
  identity?: string;
  user?: string;
  heartbeat?: string;
  memory?: string;
  tools?: string;
}

export interface WorkspaceLoader {
  load(): Promise<WorkspaceFiles>;
  getFile(name: string): Promise<string | undefined>;
}
```

**Step 2: Create workspace loader**

```typescript
// src/workspace/loader.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "../utils/logger.js";
import type { WorkspaceFiles } from "./types.js";

const log = createLogger("workspace");

const WORKSPACE_FILES = [
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
  "MEMORY.md",
  "TOOLS.md",
] as const;

export async function loadWorkspace(workspacePath: string): Promise<WorkspaceFiles> {
  log.info(`Loading workspace from ${workspacePath}`);

  const files: WorkspaceFiles = {};

  for (const filename of WORKSPACE_FILES) {
    const key = filename.replace(".md", "").toLowerCase() as keyof WorkspaceFiles;
    const content = await readWorkspaceFile(workspacePath, filename);
    if (content) {
      files[key] = content;
    }
  }

  log.info(`Loaded ${Object.keys(files).length} workspace files`);
  return files;
}

async function readWorkspaceFile(
  workspacePath: string,
  filename: string
): Promise<string | undefined> {
  try {
    const filepath = join(workspacePath, filename);
    return await readFile(filepath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
}
```

**Step 3: Create example workspace files**

```markdown
<!-- workspace/SOUL.md -->
# Soul

You are Owlia, a helpful crypto-focused AI assistant.

## Tone
- Direct and concise
- Technical when needed
- Security-conscious

## Boundaries
- Never share private keys
- Always confirm before transactions
- Warn about risks
```

```markdown
<!-- workspace/IDENTITY.md -->
# Identity

- **Name:** Owlia
- **Emoji:** 🦉
- **Vibe:** Wise, watchful, helpful
```

```markdown
<!-- workspace/USER.md -->
# User Profile

- **Timezone:** UTC+8
- **Language:** Chinese/English
```

**Step 4: Verify it compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 5: Commit**

```bash
git add src/workspace/ workspace/
git commit -m "feat(workspace): add workspace loader with example files"
```

---

## Task 3: Telegram Channel Plugin

**Files:**
- Create: `src/channels/telegram/index.ts`
- Create: `src/channels/registry.ts`

**Step 1: Create Telegram plugin**

```typescript
// src/channels/telegram/index.ts
import { Bot } from "grammy";
import { createLogger } from "../../utils/logger.js";
import type {
  ChannelPlugin,
  MessageHandler,
  MsgContext,
  OutboundMessage,
  ChannelCapabilities,
} from "../interface.js";

const log = createLogger("telegram");

export interface TelegramConfig {
  token: string;
  allowList?: string[];
}

export function createTelegramPlugin(config: TelegramConfig): ChannelPlugin {
  const bot = new Bot(config.token);
  let messageHandler: MessageHandler | null = null;

  const capabilities: ChannelCapabilities = {
    reactions: true,
    threads: false,
    buttons: true,
    markdown: true,
    maxMessageLength: 4096,
  };

  return {
    id: "telegram",
    capabilities,

    async start() {
      log.info("Starting Telegram bot...");

      bot.on("message:text", async (ctx) => {
        if (!messageHandler) return;

        const chatType = ctx.chat.type === "private" ? "direct" : "group";

        // MVP: only handle direct messages
        if (chatType !== "direct") {
          log.debug(`Ignoring ${chatType} message`);
          return;
        }

        // Check allowlist
        if (config.allowList && config.allowList.length > 0) {
          const userId = ctx.from?.id.toString();
          if (!userId || !config.allowList.includes(userId)) {
            log.warn(`User ${userId} not in allowlist`);
            return;
          }
        }

        const msgCtx: MsgContext = {
          from: ctx.from?.id.toString() ?? "",
          senderName: ctx.from?.first_name ?? "Unknown",
          senderUsername: ctx.from?.username,
          body: ctx.message.text,
          messageId: ctx.message.message_id.toString(),
          replyToId: ctx.message.reply_to_message?.message_id.toString(),
          channel: "telegram",
          chatType,
          groupId: chatType === "group" ? ctx.chat.id.toString() : undefined,
          timestamp: ctx.message.date * 1000,
        };

        try {
          await messageHandler(msgCtx);
        } catch (err) {
          log.error("Error handling message", err);
        }
      });

      await bot.start();
      log.info("Telegram bot started");
    },

    async stop() {
      log.info("Stopping Telegram bot...");
      await bot.stop();
      log.info("Telegram bot stopped");
    },

    onMessage(handler: MessageHandler) {
      messageHandler = handler;
    },

    async send(target: string, message: OutboundMessage) {
      const chatId = parseInt(target, 10);
      await bot.api.sendMessage(chatId, message.text, {
        parse_mode: "Markdown",
        reply_to_message_id: message.replyToId
          ? parseInt(message.replyToId, 10)
          : undefined,
      });
    },
  };
}
```

**Step 2: Create channel registry**

```typescript
// src/channels/registry.ts
import type { ChannelPlugin, ChannelId } from "./interface.js";

export class ChannelRegistry {
  private plugins = new Map<ChannelId, ChannelPlugin>();

  register(plugin: ChannelPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  get(id: ChannelId): ChannelPlugin | undefined {
    return this.plugins.get(id);
  }

  getAll(): ChannelPlugin[] {
    return Array.from(this.plugins.values());
  }

  async startAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      await plugin.start();
    }
  }

  async stopAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      await plugin.stop();
    }
  }
}
```

**Step 3: Verify it compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/channels/
git commit -m "feat(telegram): add Telegram channel plugin"
```

---

## Task 4: LLM Runner Implementation

**Files:**
- Create: `src/agent/providers/anthropic.ts`
- Create: `src/agent/providers/index.ts`
- Modify: `src/agent/runner.ts` (add implementation)

**Step 1: Create Anthropic provider**

```typescript
// src/agent/providers/anthropic.ts
import { createLogger } from "../../utils/logger.js";
import type { Message } from "../session.js";
import type { LLMResponse, CallOptions } from "../runner.js";

const log = createLogger("anthropic");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export interface AnthropicConfig {
  apiKey: string;
  model: string;
}

export async function callAnthropic(
  config: AnthropicConfig,
  messages: Message[],
  options?: CallOptions
): Promise<LLMResponse> {
  log.debug(`Calling Anthropic ${config.model}`);

  // Convert messages to Anthropic format
  const anthropicMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const systemMessage = messages.find((m) => m.role === "system");

  const body = {
    model: config.model,
    max_tokens: options?.maxTokens ?? 4096,
    system: systemMessage?.content,
    messages: anthropicMessages,
  };

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    log.error(`Anthropic error: ${response.status} ${text}`);
    throw new HTTPError(response.status, text);
  }

  const data = await response.json() as AnthropicResponse;

  const content = data.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");

  return {
    content,
    usage: {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
    },
    provider: "anthropic",
  };
}

// Import HTTPError from runner
import { HTTPError } from "../runner.js";

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}
```

**Step 2: Create provider index**

```typescript
// src/agent/providers/index.ts
export { callAnthropic, type AnthropicConfig } from "./anthropic.js";
```

**Step 3: Update runner with implementation**

```typescript
// src/agent/runner.ts (full replacement)
import { createLogger } from "../utils/logger.js";
import type { Message } from "./session.js";
import type { ToolDefinition, ToolCall } from "./tools/interface.js";
import { callAnthropic } from "./providers/anthropic.js";

const log = createLogger("runner");

export interface LLMProvider {
  id: string;
  model: string;
  apiKey: string;
  priority: number;
  baseUrl?: string;
}

export interface CallOptions {
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  stream?: boolean;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
  provider: string;
}

export class HTTPError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "HTTPError";
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof HTTPError) {
    return [429, 500, 502, 503, 504].includes(err.status);
  }
  if (err instanceof TimeoutError) {
    return true;
  }
  return false;
}

export async function callWithFailover(
  providers: LLMProvider[],
  messages: Message[],
  options?: CallOptions
): Promise<LLMResponse> {
  const sorted = [...providers].sort((a, b) => a.priority - b.priority);

  let lastError: Error | null = null;

  for (const provider of sorted) {
    try {
      log.info(`Trying provider: ${provider.id}`);
      return await callProvider(provider, messages, options);
    } catch (err) {
      lastError = err as Error;
      if (isRetryable(err)) {
        log.warn(`Provider ${provider.id} failed with retryable error, trying next...`);
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error("All providers failed");
}

async function callProvider(
  provider: LLMProvider,
  messages: Message[],
  options?: CallOptions
): Promise<LLMResponse> {
  switch (provider.id) {
    case "anthropic":
      return callAnthropic(
        { apiKey: provider.apiKey, model: provider.model },
        messages,
        options
      );

    // TODO: Add OpenAI, OpenRouter
    default:
      throw new Error(`Unknown provider: ${provider.id}`);
  }
}
```

**Step 4: Verify it compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 5: Commit**

```bash
git add src/agent/
git commit -m "feat(agent): add LLM runner with Anthropic provider and failover"
```

---

## Task 5: System Prompt Builder

**Files:**
- Create: `src/agent/system-prompt.ts`

**Step 1: Create system prompt builder**

```typescript
// src/agent/system-prompt.ts
import type { WorkspaceFiles } from "../workspace/types.js";

export interface PromptContext {
  workspace: WorkspaceFiles;
  channel: string;
  timezone: string;
  model: string;
  isHeartbeat?: boolean;
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const sections: string[] = [];

  // 1. Base role
  sections.push("You are a crypto-focused AI assistant running locally.");

  // 2. SOUL.md - Persona
  if (ctx.workspace.soul) {
    sections.push(`## Persona & Boundaries\n${ctx.workspace.soul}`);
  }

  // 3. IDENTITY.md - Identity
  if (ctx.workspace.identity) {
    sections.push(`## Identity\n${ctx.workspace.identity}`);
  }

  // 4. USER.md - User profile
  if (ctx.workspace.user) {
    sections.push(`## User Profile\n${ctx.workspace.user}`);
  }

  // 5. Runtime info
  sections.push(`## Runtime
- Time: ${new Date().toISOString()}
- Timezone: ${ctx.timezone}
- Channel: ${ctx.channel}
- Model: ${ctx.model}
`);

  // 6. Heartbeat mode
  if (ctx.isHeartbeat && ctx.workspace.heartbeat) {
    sections.push(`## Heartbeat
Read the following checklist and execute it:

${ctx.workspace.heartbeat}

If nothing needs attention, reply: HEARTBEAT_OK
`);
  }

  return sections.join("\n\n");
}
```

**Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/agent/system-prompt.ts
git commit -m "feat(agent): add system prompt builder"
```

---

## Task 6: Session Manager Implementation

**Files:**
- Modify: `src/agent/session.ts` (add implementation)

**Step 1: Implement session manager**

```typescript
// src/agent/session.ts (full replacement)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createLogger } from "../utils/logger.js";
import type { ChannelId } from "../channels/interface.js";
import type { ToolCall, ToolResult } from "./tools/interface.js";

const log = createLogger("session");

export type SessionKey = `${ChannelId}:${string}`;

export interface Session {
  key: SessionKey;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface SessionManager {
  get(key: SessionKey): Promise<Session>;
  append(key: SessionKey, message: Message): Promise<void>;
  getHistory(key: SessionKey, maxTurns?: number): Promise<Message[]>;
  clear(key: SessionKey): Promise<void>;
  list(): Promise<SessionKey[]>;
}

export function createSessionManager(sessionsDir: string): SessionManager {
  const getSessionPath = (key: SessionKey) =>
    join(sessionsDir, `${key.replace(":", "_")}.jsonl`);

  return {
    async get(key: SessionKey): Promise<Session> {
      const messages = await readSessionFile(getSessionPath(key));
      const now = Date.now();

      return {
        key,
        createdAt: messages[0]?.timestamp ?? now,
        lastActiveAt: messages[messages.length - 1]?.timestamp ?? now,
        messageCount: messages.length,
      };
    },

    async append(key: SessionKey, message: Message): Promise<void> {
      const path = getSessionPath(key);
      await mkdir(dirname(path), { recursive: true });

      const line = JSON.stringify(message) + "\n";
      await writeFile(path, line, { flag: "a" });

      log.debug(`Appended message to ${key}`);
    },

    async getHistory(key: SessionKey, maxTurns = 20): Promise<Message[]> {
      const messages = await readSessionFile(getSessionPath(key));

      // Group into turns (user + assistant = 1 turn)
      const turns: Message[][] = [];
      let currentTurn: Message[] = [];

      for (const msg of messages) {
        currentTurn.push(msg);
        if (msg.role === "assistant") {
          turns.push(currentTurn);
          currentTurn = [];
        }
      }

      // Include incomplete turn
      if (currentTurn.length > 0) {
        turns.push(currentTurn);
      }

      // Take last N turns
      const recentTurns = turns.slice(-maxTurns);
      return recentTurns.flat();
    },

    async clear(key: SessionKey): Promise<void> {
      const path = getSessionPath(key);
      await writeFile(path, "");
      log.info(`Cleared session ${key}`);
    },

    async list(): Promise<SessionKey[]> {
      // TODO: Implement listing
      return [];
    },
  };
}

async function readSessionFile(path: string): Promise<Message[]> {
  try {
    const content = await readFile(path, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Message);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}
```

**Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/agent/session.ts
git commit -m "feat(agent): add session manager with JSONL persistence"
```

---

## Task 7: Gateway / Main Loop

**Files:**
- Create: `src/gateway/server.ts`
- Modify: `src/entry.ts` (wire everything together)

**Step 1: Create gateway server**

```typescript
// src/gateway/server.ts
import { createLogger } from "../utils/logger.js";
import type { Config } from "../config/schema.js";
import type { WorkspaceFiles } from "../workspace/types.js";
import { ChannelRegistry } from "../channels/registry.js";
import { createTelegramPlugin } from "../channels/telegram/index.js";
import { createSessionManager, type Message, type SessionKey } from "../agent/session.js";
import { callWithFailover, type LLMProvider } from "../agent/runner.js";
import { buildSystemPrompt } from "../agent/system-prompt.js";
import type { MsgContext } from "../channels/interface.js";

const log = createLogger("gateway");

export interface GatewayOptions {
  config: Config;
  workspace: WorkspaceFiles;
  sessionsDir: string;
}

export async function startGateway(options: GatewayOptions): Promise<() => Promise<void>> {
  const { config, workspace, sessionsDir } = options;

  const channels = new ChannelRegistry();
  const sessions = createSessionManager(sessionsDir);

  // Register Telegram if configured
  if (config.telegram) {
    const telegram = createTelegramPlugin({
      token: config.telegram.token,
      allowList: config.telegram.allowList,
    });

    telegram.onMessage(async (ctx) => {
      await handleMessage(ctx, config, workspace, sessions, channels);
    });

    channels.register(telegram);
  }

  // Start all channels
  await channels.startAll();
  log.info("Gateway started");

  // Return cleanup function
  return async () => {
    await channels.stopAll();
    log.info("Gateway stopped");
  };
}

async function handleMessage(
  ctx: MsgContext,
  config: Config,
  workspace: WorkspaceFiles,
  sessions: ReturnType<typeof createSessionManager>,
  channels: ChannelRegistry
): Promise<void> {
  const sessionKey: SessionKey = `${ctx.channel}:${ctx.from}`;

  log.info(`Message from ${sessionKey}: ${ctx.body.slice(0, 50)}...`);

  // Append user message to session
  const userMessage: Message = {
    role: "user",
    content: ctx.body,
    timestamp: ctx.timestamp,
  };
  await sessions.append(sessionKey, userMessage);

  // Get conversation history
  const history = await sessions.getHistory(sessionKey);

  // Build system prompt
  const systemPrompt = buildSystemPrompt({
    workspace,
    channel: ctx.channel,
    timezone: "UTC+8", // TODO: from config
    model: config.providers[0].model,
  });

  // Prepare messages for LLM
  const messages: Message[] = [
    { role: "system", content: systemPrompt, timestamp: Date.now() },
    ...history,
  ];

  // Call LLM
  const providers: LLMProvider[] = config.providers;
  const response = await callWithFailover(providers, messages);

  log.info(`Response from ${response.provider}: ${response.content.slice(0, 50)}...`);

  // Append assistant response to session
  const assistantMessage: Message = {
    role: "assistant",
    content: response.content,
    timestamp: Date.now(),
  };
  await sessions.append(sessionKey, assistantMessage);

  // Send response
  const channel = channels.get(ctx.channel);
  if (channel) {
    await channel.send(ctx.from, {
      text: response.content,
      replyToId: ctx.messageId,
    });
  }
}
```

**Step 2: Update entry.ts**

```typescript
// src/entry.ts (full replacement)
#!/usr/bin/env node
import { program } from "commander";
import { join } from "node:path";
import { loadConfig } from "./config/loader.js";
import { loadWorkspace } from "./workspace/loader.js";
import { startGateway } from "./gateway/server.js";
import { logger } from "./utils/logger.js";

const log = logger;

program
  .name("owliabot")
  .description("Crypto-native AI agent for Telegram and Discord")
  .version("0.1.0");

program
  .command("start")
  .description("Start the bot")
  .option("-c, --config <path>", "Config file path", "config.yaml")
  .action(async (options) => {
    try {
      log.info("Starting OwliaBot...");

      // Load config
      const config = await loadConfig(options.config);

      // Load workspace
      const workspace = await loadWorkspace(config.workspace);

      // Determine sessions directory
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
      const sessionsDir = join(homeDir, ".owliabot", "sessions");

      // Start gateway
      const stop = await startGateway({
        config,
        workspace,
        sessionsDir,
      });

      // Handle shutdown
      const shutdown = async () => {
        log.info("Shutting down...");
        await stop();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      log.info("OwliaBot is running. Press Ctrl+C to stop.");
    } catch (err) {
      log.error("Failed to start", err);
      process.exit(1);
    }
  });

program.parse();
```

**Step 3: Verify it compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/gateway/ src/entry.ts
git commit -m "feat(gateway): add main gateway server and wire entry point"
```

---

## Task 8: Create Test Config and Run

**Files:**
- Create: `config.yaml` (from example, with real tokens)

**Step 1: Create config file**

Copy `config.example.yaml` to `config.yaml` and fill in:
- `ANTHROPIC_API_KEY` in environment or directly
- `TELEGRAM_BOT_TOKEN` from @BotFather

**Step 2: Run the bot**

```bash
# Set environment variables
export ANTHROPIC_API_KEY="sk-ant-..."
export TELEGRAM_BOT_TOKEN="123456:ABC..."

# Run with dev mode
npm run dev -- start
```

Expected: Bot starts, logs "OwliaBot is running"

**Step 3: Test in Telegram**

1. Open Telegram
2. Find your bot
3. Send a message
4. Verify response

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve any issues from integration test"
```

---

## Summary

After completing all tasks, you will have:

1. ✅ Config loader with env var expansion
2. ✅ Workspace loader for SOUL/IDENTITY/USER files
3. ✅ Telegram channel plugin
4. ✅ LLM runner with Anthropic provider
5. ✅ System prompt builder
6. ✅ Session manager with JSONL persistence
7. ✅ Gateway server wiring everything together
8. ✅ Working bot responding to Telegram messages

**Next phase:** Add Discord support, Tool execution, Heartbeat/Cron
