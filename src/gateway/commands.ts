// src/gateway/commands.ts
/**
 * Slash-command interceptor for the gateway message pipeline.
 *
 * Handles commands like /new, /reset before they reach the LLM agent loop.
 * Modeled after OpenClaw's resetTriggers behavior:
 * - Case-insensitive trigger matching
 * - Authorization check (only allowed senders can reset)
 * - Model override on reset (/new sonnet)
 * - Greeting with model info
 * - Optional memory summarization before clear
 */

import { createLogger } from "../utils/logger.js";
import type { MsgContext } from "../channels/interface.js";
import type { SessionStore } from "../agent/session-store.js";
import type { SessionTranscriptStore } from "../agent/session-transcript.js";
import type { ChannelRegistry } from "../channels/registry.js";
import { summarizeAndSave, type SummarizeResult } from "./session-summarizer.js";
import type { ModelConfig } from "../agent/models.js";
import type { InfraStore } from "../infra/index.js";
import { listConfiguredModelCatalog } from "../models/catalog.js";
import { parseModelRef } from "../models/ref.js";
import { applyPrimaryModelRefOverride } from "../models/override.js";
import { updateAppConfigFilePrimaryModel } from "../models/config-file.js";
import { resolvePathLike, defaultConfigPath } from "../utils/paths.js";

const log = createLogger("commands");

/** Default triggers that reset the session. */
const DEFAULT_RESET_TRIGGERS = ["/new", "/reset"];

/** Help command triggers */
const HELP_TRIGGERS = ["/help", "help"];

/** Status command triggers */
const STATUS_TRIGGERS = ["/status"];

/** Help message text */
const HELP_TEXT = `🦉 **OwliaBot 帮助**

**命令**
• \`/new\` — 开始新会话
• \`/new <model>\` — 切换模型并开始新会话 (sonnet, opus, haiku, gpt-4o)
• \`/models [filter]\` — 列出可用模型（可选过滤）
• \`/model <provider/model|alias>\` — 本会话切换 primary 模型
• \`/model default <provider/model|alias>\` — 设置全局默认 primary 模型 (写入 app.yaml)
• \`/model clear\` — 清除本会话模型覆盖
• \`/reset\` — 重置当前会话
• \`/help\` — 显示此帮助信息

**使用**
直接 @我 发送消息即可开始对话。

**模型别名**
• sonnet → claude-sonnet-4-5
• opus → claude-opus-4-5
• haiku → claude-haiku-4-5
• gpt-4o → OpenAI GPT-4o`;

/**
 * Known model aliases for /new model switching.
 * Maps alias → { provider, model } for quick resolution.
 */
const MODEL_ALIASES: Record<string, { provider: string; model: string }> = {
  sonnet: { provider: "anthropic", model: "claude-sonnet-4-5" },
  opus: { provider: "anthropic", model: "claude-opus-4-5" },
  haiku: { provider: "anthropic", model: "claude-haiku-4-5" },
  "gpt-4o": { provider: "openai", model: "gpt-4o" },
  "gpt-4o-mini": { provider: "openai", model: "gpt-4o-mini" },
  gemini: { provider: "google", model: "gemini-2.5-pro" },
  "gemini-flash": { provider: "google", model: "gemini-2.5-flash" },
};

export interface CommandContext {
  ctx: MsgContext;
  sessionKey: string;
  sessionStore: SessionStore;
  transcripts: SessionTranscriptStore;
  channels: ChannelRegistry;
  /** Provider chain from config (used for /models and /model). */
  providers?: Array<{ id: string; model: string; priority: number }>;
  resetTriggers?: string[];
  /** Workspace root path — needed for writing memory summaries. */
  workspacePath?: string;
  /** Override the model used for summarization. */
  summaryModel?: ModelConfig;
  /** Timezone for date formatting in memory files. */
  timezone?: string;
  /**
   * Authorization check: if provided, only these sender IDs can trigger reset.
   * If undefined/empty, all senders are allowed (backward compat).
   */
  authorizedSenders?: string[];
  /** Default model label for greeting (e.g. "anthropic/claude-sonnet-4-5"). */
  defaultModelLabel?: string;
  /** Whether to summarize transcript to memory before reset. Default: true. */
  summarizeOnReset?: boolean;
}

export interface CommandResult {
  /** Whether the command was handled (true = skip LLM loop). */
  handled: boolean;
}

export interface ModelSelection {
  provider: string;
  model: string;
  alias?: string;
}

/**
 * Try to resolve a string as a model alias or provider/model pair.
 * Returns null if not recognized.
 */
export function resolveModelFromRemainder(token: string): ModelSelection | null {
  if (!token) return null;

  const lower = token.toLowerCase();

  // Check aliases first
  const alias = MODEL_ALIASES[lower];
  if (alias) {
    return { provider: alias.provider, model: alias.model, alias: lower };
  }

  // Check provider/model format (e.g. "anthropic/claude-sonnet-4-5")
  if (token.includes("/")) {
    const parsed = parseModelRef(token);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Try to intercept a slash command. Returns { handled: true } if the message
 * was a recognized command and has been fully processed (reply sent).
 *
 * If not a command, returns { handled: false } and the caller should continue
 * to the normal LLM agent loop.
 */
export async function tryHandleCommand(
  options: CommandContext
): Promise<CommandResult> {
  const {
    ctx, sessionKey, sessionStore, transcripts, channels,
    providers,
    resetTriggers, workspacePath, summaryModel, timezone,
    authorizedSenders, defaultModelLabel,
    summarizeOnReset = true,
  } = options;

  const body = ctx.body.trim();
  const bodyLower = body.toLowerCase();

  // ─────────────────────────────────────────────────────────────────────────────
  // Model listing / switching (/models, /model)
  // ─────────────────────────────────────────────────────────────────────────────

  const isModels = bodyLower === "/models" || bodyLower.startsWith("/models ");
  if (isModels) {
    const channel = channels.get(ctx.channel);
    if (channel) {
      const target = ctx.chatType === "direct" ? ctx.from : ctx.groupId ?? ctx.from;
      const filter = body.slice("/models".length).trim();
      const entries = providers
        ? listConfiguredModelCatalog({ providers, filter })
        : [];

      if (!providers || providers.length === 0) {
        await channel.send(target, {
          text: "⚠️ No providers configured. Update app.yaml `providers` first.",
          replyToId: ctx.messageId,
        });
        return { handled: true };
      }

      if (entries.length === 0) {
        await channel.send(target, {
          text: filter
            ? `No models found for filter: "${filter}".`
            : "No models found (provider catalogs unavailable).",
          replyToId: ctx.messageId,
        });
        return { handled: true };
      }

      const MAX = 30;
      const lines = entries.slice(0, MAX).map((e) => {
        const label = e.name && e.name !== e.model ? ` — ${e.name}` : "";
        return `• \`${e.key}\`${label}`;
      });
      const suffix =
        entries.length > MAX ? `\n… and ${entries.length - MAX} more. Add a filter: \`/models gpt-5\`` : "";

      const title = filter ? `Available models (filter: "${filter}"):` : "Available models:";
      await channel.send(target, {
        text: `${title}\n${lines.join("\n")}${suffix}`,
        replyToId: ctx.messageId,
      });
    }
    return { handled: true };
  }

  const isModel = bodyLower === "/model" || bodyLower.startsWith("/model ");
  if (isModel) {
    const channel = channels.get(ctx.channel);
    if (channel) {
      const target = ctx.chatType === "direct" ? ctx.from : ctx.groupId ?? ctx.from;
      const remainder = body.slice("/model".length).trim();

      const existing = await sessionStore.get(sessionKey);

      const sortedProviders = [...(providers ?? [])].toSorted((a, b) => a.priority - b.priority);
      const defaultRef = sortedProviders[0]
        ? `${sortedProviders[0].id}/${sortedProviders[0].model}`
        : defaultModelLabel ?? "(unknown)";
      const activeRef = existing?.primaryModelRefOverride?.trim() || defaultRef;

      if (!remainder) {
        await channel.send(target, {
          text: `Current model: \`${activeRef}\`\nDefault: \`${defaultRef}\``,
          replyToId: ctx.messageId,
        });
        return { handled: true };
      }

      const remainderLower = remainder.toLowerCase();
      if (remainderLower === "default" || remainderLower.startsWith("default ")) {
        const after = remainder.slice("default".length).trim();
        if (!after) {
          await channel.send(target, {
            text: `Usage: \`/model default <provider/model|alias>\`\nTip: use \`/models\` to browse.`,
            replyToId: ctx.messageId,
          });
          return { handled: true };
        }

        const token = after.split(/\s+/)[0] ?? "";
        const resolved = resolveModelFromRemainder(token) ?? (() => {
          // If no provider is specified and it's not an alias, treat as model id for the default provider.
          if (!token.includes("/") && sortedProviders[0]) {
            return { provider: sortedProviders[0].id, model: token };
          }
          return null;
        })();

        if (!resolved) {
          await channel.send(target, {
            text: `⚠️ Invalid model reference: "${token}". Use \`/models\` to see options.`,
            replyToId: ctx.messageId,
          });
          return { handled: true };
        }

        const allowedProviders = new Set((providers ?? []).map((p) => p.id.toLowerCase()));
        if (providers && providers.length > 0 && !allowedProviders.has(resolved.provider.toLowerCase())) {
          await channel.send(target, {
            text: `⚠️ Provider not configured: "${resolved.provider}". Configure it in app.yaml first.`,
            replyToId: ctx.messageId,
          });
          return { handled: true };
        }

        const modelRef = `${resolved.provider}/${resolved.model}`;

        // Persist to app.yaml (write raw YAML to avoid leaking merged secrets/env).
        const rawConfigPath = process.env.OWLIABOT_CONFIG_PATH ?? defaultConfigPath();
        const configPath = resolvePathLike(rawConfigPath);
        try {
          await updateAppConfigFilePrimaryModel(configPath, {
            provider: resolved.provider,
            model: resolved.model,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await channel.send(target, {
            text: `⚠️ Failed to update app.yaml default model: ${message}`,
            replyToId: ctx.messageId,
          });
          return { handled: true };
        }

        // Update in-memory provider chain so it takes effect immediately in this process.
        // Note: this is an intentional in-place mutation because `providers` is passed
        // by reference into the message pipeline.
        if (providers && providers.length > 0) {
          const next = applyPrimaryModelRefOverride(providers as any, {
            provider: resolved.provider,
            model: resolved.model,
          });
          providers.splice(0, providers.length, ...(next as any));
        }

        // Clear session override so the session follows the new default.
        await sessionStore.getOrCreate(sessionKey, {
          primaryModelRefOverride: undefined,
        } as any);

        await channel.send(target, {
          text: `✅ Default model updated: \`${modelRef}\``,
          replyToId: ctx.messageId,
        });
        return { handled: true };
      }

      if (remainder.toLowerCase() === "clear") {
        await sessionStore.getOrCreate(sessionKey, {
          // Setting undefined clears the field; JSON serialization will omit it.
          primaryModelRefOverride: undefined,
        } as any);
        await channel.send(target, {
          text: `✅ Model override cleared. Using default: \`${defaultRef}\``,
          replyToId: ctx.messageId,
        });
        return { handled: true };
      }

      const token = remainder.split(/\s+/)[0] ?? "";
      const resolved = resolveModelFromRemainder(token) ?? (() => {
        // If no provider is specified and it's not an alias, treat as model id for the default provider.
        if (!token.includes("/") && sortedProviders[0]) {
          return { provider: sortedProviders[0].id, model: token };
        }
        return null;
      })();

      if (!resolved) {
        await channel.send(target, {
          text: `⚠️ Invalid model reference: "${token}". Use \`/models\` to see options.`,
          replyToId: ctx.messageId,
        });
        return { handled: true };
      }

      const modelRef = `${resolved.provider}/${resolved.model}`;
      const allowedProviders = new Set((providers ?? []).map((p) => p.id.toLowerCase()));
      if (providers && providers.length > 0 && !allowedProviders.has(resolved.provider.toLowerCase())) {
        await channel.send(target, {
          text: `⚠️ Provider not configured: "${resolved.provider}". Configure it in app.yaml first.`,
          replyToId: ctx.messageId,
        });
        return { handled: true };
      }

      await sessionStore.getOrCreate(sessionKey, {
        primaryModelRefOverride: modelRef,
      } as any);

      await channel.send(target, {
        text: `✅ Model set for this session: \`${modelRef}\``,
        replyToId: ctx.messageId,
      });
    }
    return { handled: true };
  }

  // Check for help command first (no auth required)
  const isHelp = HELP_TRIGGERS.some((t) => bodyLower === t.toLowerCase());
  if (isHelp) {
    log.info(`Help command from ${ctx.from}`);
    const channel = channels.get(ctx.channel);
    if (channel) {
      const target = ctx.chatType === "direct" ? ctx.from : ctx.groupId ?? ctx.from;
      await channel.send(target, {
        text: HELP_TEXT,
        replyToId: ctx.messageId,
      });
    }
    return { handled: true };
  }

  const triggers = resetTriggers ?? DEFAULT_RESET_TRIGGERS;

  // Case-insensitive trigger matching (aligned with OpenClaw)
  const matchedTrigger = triggers.find((t) => {
    const tLower = t.toLowerCase();
    return bodyLower === tLower || bodyLower.startsWith(tLower + " ");
  });

  if (!matchedTrigger) {
    return { handled: false };
  }

  // Authorization check (aligned with OpenClaw)
  if (authorizedSenders && authorizedSenders.length > 0) {
    if (!authorizedSenders.includes(ctx.from)) {
      log.info(`Ignoring reset from unauthorized sender: ${ctx.from}`);
      return { handled: false };
    }
  }

  // Extract remainder after the trigger (e.g. "/new sonnet" → "sonnet")
  // Use original body (not lowered) to preserve casing for non-model remainder
  const remainder = body.slice(matchedTrigger.length).trim();

  log.info(`Reset command "${matchedTrigger}" from ${sessionKey}${remainder ? ` (remainder: "${remainder}")` : ""}`);

  // Try to parse remainder as model override
  let modelSelection: ModelSelection | null = null;
  let bodyAfterModel = remainder;

  if (remainder) {
    const tokens = remainder.split(/\s+/);
    const firstToken = tokens[0];

    // Try first token as model
    modelSelection = resolveModelFromRemainder(firstToken);
    if (modelSelection) {
      bodyAfterModel = tokens.slice(1).join(" ").trim();
    }
  }

  // Rotate session (creates a new sessionId for this sessionKey)
  const oldEntry = await sessionStore.get(sessionKey);

  // Carry forward session model override unless explicitly changed via "/new <model>".
  const carriedModelRef = oldEntry?.primaryModelRefOverride?.trim() || undefined;
  const nextModelRef = modelSelection
    ? `${modelSelection.provider}/${modelSelection.model}`
    : carriedModelRef;

  // Summarize transcript → memory before clearing (non-blocking on failure)
  let summaryResult: SummarizeResult = { summarized: false };
  if (summarizeOnReset && oldEntry?.sessionId && workspacePath) {
    summaryResult = await summarizeAndSave({
      sessionId: oldEntry.sessionId,
      transcripts,
      workspacePath,
      summaryModel,
    timezone,
  });
  }

  const newEntry = await sessionStore.rotate(sessionKey, {
    channel: ctx.channel,
    chatType: ctx.chatType,
    groupId: ctx.groupId,
    displayName: ctx.senderName,
    primaryModelRefOverride: nextModelRef,
  });

  // Clear old transcript (after summary is saved)
  if (oldEntry?.sessionId) {
    await transcripts.clear(oldEntry.sessionId);
  }

  log.info(`Session rotated: ${oldEntry?.sessionId ?? "(none)"} → ${newEntry.sessionId}`);

  // Send confirmation (aligned with OpenClaw greeting format)
  const channel = channels.get(ctx.channel);
  if (channel) {
    const target =
      ctx.chatType === "direct" ? ctx.from : ctx.groupId ?? ctx.from;

    // Build model label for greeting
    const activeModelLabel = nextModelRef ?? defaultModelLabel;

    const modelInfo = activeModelLabel
      ? modelSelection && defaultModelLabel && activeModelLabel !== defaultModelLabel
        ? ` · model: ${activeModelLabel} (default: ${defaultModelLabel})`
        : ` · model: ${activeModelLabel}`
      : "";

    const memorySuffix = summaryResult.summarized
      ? "\n📝 对话摘要已保存到记忆文件。"
      : "";

    let greeting: string;
    if (bodyAfterModel) {
      greeting = `✅ New session started${modelInfo}${memorySuffix}\n${bodyAfterModel}`;
    } else {
      greeting = `✅ New session started${modelInfo}${memorySuffix}`;
    }

    await channel.send(target, {
      text: greeting,
      replyToId: ctx.messageId,
    });
  }

  return { handled: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Command Handler
// ─────────────────────────────────────────────────────────────────────────────

export interface StatusCommandContext {
  ctx: MsgContext;
  channels: ChannelRegistry;
  infraStore: InfraStore | null;
}

/**
 * Handle /status command to show infrastructure status.
 * Returns { handled: true } if the message was a status command.
 */
export async function tryHandleStatusCommand(
  options: StatusCommandContext
): Promise<CommandResult> {
  const { ctx, channels, infraStore } = options;

  const body = ctx.body.trim();
  const bodyLower = body.toLowerCase();

  const isStatus = STATUS_TRIGGERS.some((t) => bodyLower === t.toLowerCase());
  if (!isStatus) {
    return { handled: false };
  }

  log.info(`Status command from ${ctx.from}`);

  const channel = channels.get(ctx.channel);
  if (!channel) {
    return { handled: true };
  }

  const target = ctx.chatType === "direct" ? ctx.from : ctx.groupId ?? ctx.from;

  if (!infraStore) {
    await channel.send(target, {
      text: "📊 **系统状态**\n\n基础设施模块未启用。",
      replyToId: ctx.messageId,
    });
    return { handled: true };
  }

  const stats = infraStore.getStats();
  const recentEvents = infraStore.getRecentEvents(5);

  // Format recent events
  const eventsText = recentEvents.length > 0
    ? recentEvents.map((e) => {
        const time = new Date(e.time).toISOString().slice(11, 19);
        const statusIcon = e.status === "success" ? "✅" : e.status === "error" ? "❌" : "⚠️";
        return `  ${statusIcon} \`${time}\` ${e.type} (${e.source.split(":").pop()})`;
      }).join("\n")
    : "  无最近事件";

  const statusText = `📊 **系统状态**

**运行时间:** ${formatUptime(stats.uptime)}
**事件记录:** ${stats.eventCount} 条
**去重缓存:** ${stats.idempotencyCount} 条
**限流桶:** ${stats.rateLimitBuckets} 个

**最近事件:**
${eventsText}`;

  await channel.send(target, {
    text: statusText,
    replyToId: ctx.messageId,
  });

  return { handled: true };
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
