/**
 * Heartbeat execution
 * @see design.md Section 5.7
 */

import { createLogger } from "../utils/logger.js";
import type { NotificationService } from "../notifications/service.js";
import type { WorkspaceFiles } from "../workspace/types.js";
import type { Config } from "../config/schema.js";
import { callWithFailover, type LLMProvider } from "../agent/runner.js";
import { buildSystemPrompt } from "../agent/system-prompt.js";
import type { Message } from "../agent/session.js";

const log = createLogger("heartbeat");

export interface HeartbeatOptions {
  config: Config;
  workspace: WorkspaceFiles;
  notifications: NotificationService;
}

export async function executeHeartbeat(options: HeartbeatOptions): Promise<void> {
  const { config, workspace, notifications } = options;

  log.info("Executing heartbeat...");

  // Build system prompt with heartbeat flag
  const systemPrompt = buildSystemPrompt({
    workspace,
    channel: "heartbeat",
    chatType: "direct",
    timezone: "UTC+8",
    model: config.providers[0].model,
    isHeartbeat: true,
  });

  // Build messages
  const messages: Message[] = [
    { role: "system", content: systemPrompt, timestamp: Date.now() },
    {
      role: "user",
      content: "Execute the heartbeat checklist from HEARTBEAT.md. If nothing needs attention, respond with exactly: HEARTBEAT_OK",
      timestamp: Date.now(),
    },
  ];

  // Call LLM
  const providers: LLMProvider[] = config.providers;
  const response = await callWithFailover(providers, messages, {});

  // Check response
  if (response.content.includes("HEARTBEAT_OK")) {
    log.info("Heartbeat OK - nothing to report");
    return;
  }

  // Send notification
  log.info("Heartbeat has something to report");
  await notifications.notify(`🦉 Heartbeat Report:\n\n${response.content}`);
}
