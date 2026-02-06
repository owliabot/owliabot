/**
 * Mock LLM for deterministic bootstrap testing
 *
 * Simulates an LLM that follows BOOTSTRAP.md instructions:
 * - Asks questions in sequence
 * - Calls write_file tool for each workspace file
 * - Deletes BOOTSTRAP.md at the end
 */

import type { Message } from "../../agent/session.js";
import type { ToolDefinition, ToolCall } from "../../agent/tools/interface.js";
import type { LLMResponse, RunnerOptions } from "../../agent/runner.js";

// ─────────────────────────────────────────────────────────────────────────────
// Mock LLM State Machine
// ─────────────────────────────────────────────────────────────────────────────

export type BootstrapStage =
  | "init"           // Just started, will ask about user
  | "ask_user"       // Asked about user, waiting for response
  | "write_user"     // Got user info, will write USER.md
  | "ask_identity"   // Asked about assistant identity
  | "write_identity" // Got identity, will write IDENTITY.md
  | "ask_soul"       // Asked about tone/boundaries
  | "write_soul"     // Got soul info, will write SOUL.md
  | "ask_tools"      // Asked about tool preferences
  | "write_tools"    // Got tools info, will write TOOLS.md
  | "ask_heartbeat"  // Asked about heartbeat
  | "write_heartbeat"// Got heartbeat info, will write HEARTBEAT.md
  | "cleanup"        // Will delete BOOTSTRAP.md
  | "complete";      // All done

interface MockLLMState {
  stage: BootstrapStage;
  userData?: { name: string; timezone: string; language: string };
  identityData?: { name: string; role: string; emoji: string };
  soulData?: { tone: string; boundaries: string };
  toolsData?: { preferences: string };
  heartbeatData?: { enabled: boolean; checklist?: string[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Response Templates
// ─────────────────────────────────────────────────────────────────────────────

const QUESTIONS = {
  user: "Hi! Let's get you set up. What should I call you? And what's your timezone and preferred language?",
  identity: "Great! Now, what would you like to name me? What kind of assistant should I be, and pick an emoji for me!",
  soul: "How should I talk to you? Casual, formal, playful? And are there any boundaries I should respect?",
  tools: "Any tool preferences? Things you want me to use more or less?",
  heartbeat: "Last question - want me to check in periodically? If so, what should I check (emails, calendar, weather)?",
};

const CONFIRMATIONS = {
  user: "Got it! I've saved your info to USER.md.",
  identity: "Perfect! I've updated IDENTITY.md with my new identity.",
  soul: "Understood! SOUL.md is now configured with your preferences.",
  tools: "Noted! Tool preferences saved to TOOLS.md.",
  heartbeat: "All set! HEARTBEAT.md is configured.",
  complete: "Setup complete! 🎉 I've deleted BOOTSTRAP.md - we won't need it again. I'm ready to help you!",
};

// ─────────────────────────────────────────────────────────────────────────────
// File Content Generators
// ─────────────────────────────────────────────────────────────────────────────

function generateUserMd(data: { name: string; timezone: string; language: string }): string {
  return `# USER.md - About Your Human

## Primary
- **Name:** ${data.name}
- **What to call them:** ${data.name}
- **Timezone:** ${data.timezone}
- **Language:** ${data.language}

## Context
*(Add notes about them over time)*
`;
}

function generateIdentityMd(data: { name: string; role: string; emoji: string }): string {
  return `# IDENTITY.md - Who Am I?

- **Name:** ${data.name}
- **Creature/Role:** ${data.role}
- **Vibe:** Helpful and friendly
- **Emoji:** ${data.emoji}
`;
}

function generateSoulMd(data: { tone: string; boundaries: string }): string {
  return `# SOUL.md - Who You Are

## Core Truths
- Be genuinely helpful, not performatively helpful
- Have opinions — you're allowed to disagree
- Be resourceful before asking
- Earn trust through competence

## Tone
${data.tone}

## Boundaries
${data.boundaries}

## Vibe
A helpful assistant that respects boundaries.
`;
}

function generateToolsMd(data: { preferences: string }): string {
  return `# TOOLS.md - Local Notes

## Preferences
${data.preferences}

## Notes
*(Add specific tool notes here)*
`;
}

function generateHeartbeatMd(data: { enabled: boolean; checklist?: string[] }): string {
  if (!data.enabled) {
    return `# HEARTBEAT.md

# Heartbeat disabled - keeping this file empty.
`;
  }
  const items = data.checklist?.map(item => `- [ ] ${item}`).join("\n") ?? "";
  return `# HEARTBEAT.md

${items}
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock LLM Implementation
// ─────────────────────────────────────────────────────────────────────────────

export interface MockLLMOptions {
  /** Simulate parsing user responses to extract data */
  parseResponses?: boolean;
  /** Fixed responses for each stage (for deterministic testing) */
  fixedData?: {
    user?: { name: string; timezone: string; language: string };
    identity?: { name: string; role: string; emoji: string };
    soul?: { tone: string; boundaries: string };
    tools?: { preferences: string };
    heartbeat?: { enabled: boolean; checklist?: string[] };
  };
}

export function createMockLLM(options: MockLLMOptions = {}) {
  const state: MockLLMState = { stage: "init" };

  // Default fixed data for deterministic tests
  const fixedData = options.fixedData ?? {
    user: { name: "Alice", timezone: "UTC+8", language: "English" },
    identity: { name: "Owl", role: "wise owl assistant", emoji: "🦉" },
    soul: { tone: "Casual and friendly", boundaries: "No politics or religion" },
    tools: { preferences: "Use web search frequently" },
    heartbeat: { enabled: true, checklist: ["Check emails", "Check calendar"] },
  };

  let toolCallCounter = 0;

  function generateToolCallId(): string {
    return `call_mock_${++toolCallCounter}`;
  }

  async function complete(
    messages: Message[],
    _options?: RunnerOptions
  ): Promise<LLMResponse> {
    // Get the last user message
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user" && !m.toolResults);
    const lastToolResult = [...messages].reverse().find(m => m.role === "user" && m.toolResults);

    // State machine transitions
    switch (state.stage) {
      case "init":
        state.stage = "ask_user";
        return {
          content: QUESTIONS.user,
          usage: { promptTokens: 100, completionTokens: 50 },
          provider: "mock",
          model: "mock-bootstrap",
        };

      case "ask_user":
        // User responded, now write USER.md
        state.userData = fixedData.user;
        state.stage = "write_user";
        return {
          content: "Let me save that...",
          toolCalls: [{
            id: generateToolCallId(),
            name: "write_file",
            arguments: {
              path: "USER.md",
              content: generateUserMd(state.userData),
            },
          }],
          usage: { promptTokens: 150, completionTokens: 100 },
          provider: "mock",
          model: "mock-bootstrap",
        };

      case "write_user":
        // Tool result received, ask about identity
        state.stage = "ask_identity";
        return {
          content: `${CONFIRMATIONS.user}\n\n${QUESTIONS.identity}`,
          usage: { promptTokens: 200, completionTokens: 75 },
          provider: "mock",
          model: "mock-bootstrap",
        };

      case "ask_identity":
        state.identityData = fixedData.identity;
        state.stage = "write_identity";
        return {
          content: "I like that!",
          toolCalls: [{
            id: generateToolCallId(),
            name: "write_file",
            arguments: {
              path: "IDENTITY.md",
              content: generateIdentityMd(state.identityData),
            },
          }],
          usage: { promptTokens: 250, completionTokens: 100 },
          provider: "mock",
          model: "mock-bootstrap",
        };

      case "write_identity":
        state.stage = "ask_soul";
        return {
          content: `${CONFIRMATIONS.identity}\n\n${QUESTIONS.soul}`,
          usage: { promptTokens: 300, completionTokens: 75 },
          provider: "mock",
          model: "mock-bootstrap",
        };

      case "ask_soul":
        state.soulData = fixedData.soul;
        state.stage = "write_soul";
        return {
          content: "Understood!",
          toolCalls: [{
            id: generateToolCallId(),
            name: "write_file",
            arguments: {
              path: "SOUL.md",
              content: generateSoulMd(state.soulData),
            },
          }],
          usage: { promptTokens: 350, completionTokens: 100 },
          provider: "mock",
          model: "mock-bootstrap",
        };

      case "write_soul":
        state.stage = "ask_tools";
        return {
          content: `${CONFIRMATIONS.soul}\n\n${QUESTIONS.tools}`,
          usage: { promptTokens: 400, completionTokens: 75 },
          provider: "mock",
          model: "mock-bootstrap",
        };

      case "ask_tools":
        state.toolsData = fixedData.tools;
        state.stage = "write_tools";
        return {
          content: "Got it!",
          toolCalls: [{
            id: generateToolCallId(),
            name: "write_file",
            arguments: {
              path: "TOOLS.md",
              content: generateToolsMd(state.toolsData),
            },
          }],
          usage: { promptTokens: 450, completionTokens: 100 },
          provider: "mock",
          model: "mock-bootstrap",
        };

      case "write_tools":
        state.stage = "ask_heartbeat";
        return {
          content: `${CONFIRMATIONS.tools}\n\n${QUESTIONS.heartbeat}`,
          usage: { promptTokens: 500, completionTokens: 75 },
          provider: "mock",
          model: "mock-bootstrap",
        };

      case "ask_heartbeat":
        state.heartbeatData = fixedData.heartbeat;
        state.stage = "write_heartbeat";
        return {
          content: "Setting that up...",
          toolCalls: [{
            id: generateToolCallId(),
            name: "write_file",
            arguments: {
              path: "HEARTBEAT.md",
              content: generateHeartbeatMd(state.heartbeatData),
            },
          }],
          usage: { promptTokens: 550, completionTokens: 100 },
          provider: "mock",
          model: "mock-bootstrap",
        };

      case "write_heartbeat":
        state.stage = "cleanup";
        return {
          content: `${CONFIRMATIONS.heartbeat}\n\nNow let me clean up...`,
          toolCalls: [{
            id: generateToolCallId(),
            name: "write_file",
            arguments: {
              path: "BOOTSTRAP.md",
              content: "", // Empty content = delete
            },
          }],
          usage: { promptTokens: 600, completionTokens: 100 },
          provider: "mock",
          model: "mock-bootstrap",
        };

      case "cleanup":
        state.stage = "complete";
        return {
          content: CONFIRMATIONS.complete,
          usage: { promptTokens: 650, completionTokens: 50 },
          provider: "mock",
          model: "mock-bootstrap",
        };

      case "complete":
        return {
          content: "I'm all set up and ready to help! What would you like to do?",
          usage: { promptTokens: 700, completionTokens: 25 },
          provider: "mock",
          model: "mock-bootstrap",
        };

      default:
        throw new Error(`Unknown stage: ${state.stage}`);
    }
  }

  return {
    complete,
    getState: () => ({ ...state }),
    reset: () => {
      state.stage = "init";
      delete state.userData;
      delete state.identityData;
      delete state.soulData;
      delete state.toolsData;
      delete state.heartbeatData;
      toolCallCounter = 0;
    },
  };
}

export type MockLLM = ReturnType<typeof createMockLLM>;
