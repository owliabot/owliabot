// src/gateway/session-summarizer.ts
/**
 * Summarize a session's transcript before reset, then append to daily memory.
 *
 * Flow:
 *  1. Read the transcript for the current sessionId
 *  2. If it has enough content (≥2 user messages), call LLM to produce a summary
 *  3. Append the summary to memory/YYYY-MM-DD.md in the workspace
 *
 * The LLM call uses a cheap/fast model (haiku) by default to minimize latency & cost.
 */

import { mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createLogger } from "../utils/logger.js";
import { runLLM, type RunnerOptions } from "../agent/runner.js";
import type { ModelConfig } from "../agent/models.js";
import type { Message } from "../agent/session.js";
import type { SessionTranscriptStore } from "../agent/session-transcript.js";

const log = createLogger("session-summarizer");

/** Minimum user messages before we bother summarizing. */
const MIN_USER_MESSAGES = 2;

/**
 * No hardcoded default model - caller must provide one.
 * This aligns with OpenClaw's strategy of using the session's model.
 */

const SUMMARY_SYSTEM_PROMPT = `You are a conversation summarizer. Given a conversation transcript, produce a concise summary of key points, decisions, and action items.

Rules:
- Write in the same language as the conversation
- Use bullet points
- Focus on: decisions made, tasks discussed, important context, action items
- Skip small talk and greetings
- Keep it under 200 words
- Do NOT include any preamble like "Here is a summary" — just output the bullets`;

export interface SummarizeOptions {
  /** Session ID whose transcript to summarize */
  sessionId: string;
  /** Transcript store */
  transcripts: SessionTranscriptStore;
  /** Workspace root path (where memory/ lives) */
  workspacePath: string;
  /** Override the summarization model */
  summaryModel?: ModelConfig;
  /** Timezone for date formatting */
  timezone?: string;
}

export interface SummarizeResult {
  /** Whether a summary was produced */
  summarized: boolean;
  /** The summary text (if produced) */
  summary?: string;
  /** File path where the summary was appended */
  filePath?: string;
}

/**
 * Summarize the current session transcript and append it to the daily memory file.
 *
 * Returns { summarized: false } if the transcript is too short to bother.
 * Errors are caught and logged (non-fatal — we don't want a failed summary
 * to block the /new command).
 */
export async function summarizeAndSave(
  options: SummarizeOptions
): Promise<SummarizeResult> {
  const {
    sessionId,
    transcripts,
    workspacePath,
    summaryModel,
    timezone = "UTC",
  } = options;

  // Model is required - caller should provide it (aligned with OpenClaw strategy)
  if (!summaryModel) {
    log.warn(`Skipping summary for ${sessionId}: no model configured`);
    return { summarized: false };
  }

  try {
    // 1. Read transcript
    const messages = await transcripts.getHistory(sessionId, 50);

    // Debug: log what we actually read
    if (messages.length === 0) {
      log.warn(
        `Transcript for ${sessionId} is empty — no messages found. ` +
        `This may indicate the session store and transcript store are out of sync.`
      );
    } else {
      const roleCounts = messages.reduce((acc, m) => {
        acc[m.role] = (acc[m.role] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      log.debug(
        `Transcript for ${sessionId}: ${messages.length} messages (${JSON.stringify(roleCounts)})`
      );
    }

    // Filter for actual user messages with content (exclude tool result placeholders)
    const userMessages = messages.filter(
      (m) => m.role === "user" && m.content && m.content.trim().length > 0
    );
    
    if (userMessages.length < MIN_USER_MESSAGES) {
      log.info(
        `Skipping summary for ${sessionId}: only ${userMessages.length} user message(s) with content ` +
        `(total messages: ${messages.length})`
      );
      return { summarized: false };
    }

    // 2. Build prompt
    const transcriptText = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `[${m.role}]: ${m.content}`)
      .join("\n");

    const llmMessages: Message[] = [
      {
        role: "system",
        content: SUMMARY_SYSTEM_PROMPT,
        timestamp: Date.now(),
      },
      {
        role: "user",
        content: `Summarize this conversation:\n\n${transcriptText}`,
        timestamp: Date.now(),
      },
    ];

    // 3. Call LLM
    log.info(
      `Summarizing session ${sessionId} (${messages.length} messages, ${userMessages.length} user)...`
    );
    const response = await runLLM(summaryModel, llmMessages, {
      maxTokens: 512,
      temperature: 0.3,
    });

    const summary = response.content.trim();
    if (!summary) {
      log.warn(`Empty summary for ${sessionId}`);
      return { summarized: false };
    }

    // 4. Append to daily memory file
    const now = new Date();
    const dateStr = now.toLocaleDateString("sv-SE", { timeZone: timezone }); // YYYY-MM-DD
    const timeStr = now.toLocaleTimeString("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
    });

    const memoryDir = join(workspacePath, "memory");
    const filePath = join(memoryDir, `${dateStr}.md`);

    await mkdir(memoryDir, { recursive: true });

    // Check if file exists to decide header
    let existing = "";
    try {
      existing = await readFile(filePath, "utf-8");
    } catch {
      // File doesn't exist yet — we'll create it
    }

    const header = existing
      ? "" // File already has content, just append
      : `# ${dateStr} Daily Notes\n\n`;

    const entry = `${header}## Session summary (${timeStr})\n\n${summary}\n\n`;

    await appendFile(filePath, entry);

    log.info(`Summary saved to ${filePath}`);
    return { summarized: true, summary, filePath };
  } catch (err) {
    // Non-fatal: log and continue
    log.error(
      `Failed to summarize session ${sessionId}: ${(err as Error).message}`
    );
    return { summarized: false };
  }
}
