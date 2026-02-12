// src/gateway/session-steering.ts
/**
 * Session steering manager — tracks active agent sessions and queues
 * mid-run (steering) and post-run (follow-up) messages.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { UserMessage } from "@mariozechner/pi-ai";

export interface SessionSteeringManager {
  /** Mark a session as having an active agent loop */
  setActive(sessionKey: string): void;
  /** Mark a session as no longer running */
  setInactive(sessionKey: string): void;
  /** Check if a session currently has an active loop */
  isActive(sessionKey: string): boolean;

  /** Push a steering message (arrives while loop is running) */
  pushSteering(sessionKey: string, content: string, timestamp?: number): void;
  /** Drain all pending steering messages for a session */
  drainSteering(sessionKey: string): AgentMessage[];

  /** Push a follow-up message (to process after loop finishes current work) */
  pushFollowUp(sessionKey: string, content: string, timestamp?: number): void;
  /** Drain all pending follow-up messages for a session */
  drainFollowUp(sessionKey: string): AgentMessage[];
}

/**
 * Create a new SessionSteeringManager instance.
 */
export function createSessionSteeringManager(): SessionSteeringManager {
  const activeSessions = new Set<string>();
  const steeringQueues = new Map<string, AgentMessage[]>();
  const followUpQueues = new Map<string, AgentMessage[]>();

  function makeUserMessage(content: string, timestamp?: number): UserMessage {
    return {
      role: "user",
      content,
      timestamp: timestamp ?? Date.now(),
    };
  }

  return {
    setActive(sessionKey: string) {
      activeSessions.add(sessionKey);
    },

    setInactive(sessionKey: string) {
      activeSessions.delete(sessionKey);
      // Clean up empty queues
      if (steeringQueues.get(sessionKey)?.length === 0) steeringQueues.delete(sessionKey);
      if (followUpQueues.get(sessionKey)?.length === 0) followUpQueues.delete(sessionKey);
    },

    isActive(sessionKey: string): boolean {
      return activeSessions.has(sessionKey);
    },

    pushSteering(sessionKey: string, content: string, timestamp?: number) {
      if (!steeringQueues.has(sessionKey)) steeringQueues.set(sessionKey, []);
      steeringQueues.get(sessionKey)!.push(makeUserMessage(content, timestamp));
    },

    drainSteering(sessionKey: string): AgentMessage[] {
      const queue = steeringQueues.get(sessionKey);
      if (!queue || queue.length === 0) return [];
      const messages = [...queue];
      queue.length = 0;
      return messages;
    },

    pushFollowUp(sessionKey: string, content: string, timestamp?: number) {
      if (!followUpQueues.has(sessionKey)) followUpQueues.set(sessionKey, []);
      followUpQueues.get(sessionKey)!.push(makeUserMessage(content, timestamp));
    },

    drainFollowUp(sessionKey: string): AgentMessage[] {
      const queue = followUpQueues.get(sessionKey);
      if (!queue || queue.length === 0) return [];
      const messages = [...queue];
      queue.length = 0;
      return messages;
    },
  };
}
