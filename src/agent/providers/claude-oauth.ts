/**
 * Claude provider using OAuth token (Claude CLI or OwliaBot auth)
 * @see design.md DR-007
 */

import { createLogger } from "../../utils/logger.js";
import type { Message } from "../session.js";
import type { LLMResponse, CallOptions, LLMProvider } from "../runner.js";
import type { ToolCall } from "../tools/interface.js";
import { HTTPError } from "../runner.js";
import { providerRegistry } from "./registry.js";
import { createAuthStore, type AuthStore, type AuthToken } from "../../auth/store.js";
import { loadClaudeCliToken } from "../../auth/claude-cli.js";
import { join } from "node:path";

const log = createLogger("claude-oauth");

// Claude CLI token uses api.anthropic.com (same as regular API)
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

let authStore: AuthStore | null = null;

function getAuthStore(): AuthStore {
  if (!authStore) {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
    authStore = createAuthStore(join(homeDir, ".owliabot"));
  }
  return authStore;
}

async function getValidToken(): Promise<AuthToken> {
  // Priority 1: OwliaBot's own token
  const store = getAuthStore();
  let token = await store.get();

  // Priority 2: Claude CLI token
  if (!token) {
    token = loadClaudeCliToken();
    if (!token) {
      throw new Error(
        "Not authenticated. Run 'claude auth' (Claude CLI) first."
      );
    }
    log.debug("Using Claude CLI token");
  }

  if (Date.now() >= token.expiresAt) {
    throw new Error("Token expired. Run 'claude auth' to re-authenticate.");
  }

  return token;
}

async function callClaudeOAuth(
  config: LLMProvider,
  messages: Message[],
  options?: CallOptions
): Promise<LLMResponse> {
  const token = await getValidToken();

  log.debug(`Calling Claude OAuth ${config.model}`);

  // Convert messages to Claude format
  const claudeMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const systemMessage = messages.find((m) => m.role === "system");

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: options?.maxTokens ?? 4096,
    system: systemMessage?.content,
    messages: claudeMessages,
  };

  if (options?.tools && options.tools.length > 0) {
    body.tools = options.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  // Claude CLI token uses x-api-key header (same as regular Anthropic API)
  const response = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": token.accessToken,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    log.error(`Claude OAuth error: ${response.status} ${text}`);
    throw new HTTPError(response.status, text);
  }

  const data = (await response.json()) as {
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
    >;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");

  const toolCalls: ToolCall[] = data.content
    .filter(
      (c): c is { type: "tool_use"; id: string; name: string; input: unknown } =>
        c.type === "tool_use"
    )
    .map((c) => ({
      id: c.id,
      name: c.name,
      arguments: c.input,
    }));

  return {
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
    },
    provider: "claude-oauth",
  };
}

// Register provider
providerRegistry.register("claude-oauth", callClaudeOAuth);
