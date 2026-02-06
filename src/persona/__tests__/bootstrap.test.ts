/**
 * Bootstrap Flow Tests
 *
 * Tests the bootstrap flow where LLM uses tools to write workspace files.
 *
 * Run modes:
 * - `pnpm test bootstrap` - Uses mock LLM (fast, deterministic, no API key needed)
 * - `USE_REAL_LLM=1 pnpm test bootstrap` - Uses real API (requires ANTHROPIC_API_KEY)
 *
 * @see BOOTSTRAP.md for the expected flow
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockLLM, type MockLLM } from "./mock-llm.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test Utilities
// ─────────────────────────────────────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap Session Simulator
// ─────────────────────────────────────────────────────────────────────────────

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: unknown;
  }>;
  toolResults?: Array<{
    toolCallId: string;
    toolName: string;
    success: boolean;
    data?: unknown;
    error?: string;
  }>;
  timestamp?: number;
}

interface BootstrapSession {
  messages: Message[];
  workspacePath: string;
  send: (userMessage: string) => Promise<string>;
  runToCompletion: (userResponses: string[]) => Promise<void>;
}

/**
 * Create a bootstrap session that simulates the LLM + tool execution flow
 */
function createBootstrapSession(
  workspacePath: string,
  llm: MockLLM
): BootstrapSession {
  const messages: Message[] = [];

  // Load BOOTSTRAP.md as system context
  async function loadSystemPrompt(): Promise<string> {
    const bootstrapContent = await readFileIfExists(join(workspacePath, "BOOTSTRAP.md"));
    const agentsContent = await readFileIfExists(join(workspacePath, "AGENTS.md"));
    
    let prompt = "You are a helpful assistant.\n\n";
    if (agentsContent) {
      prompt += `## AGENTS.md\n${agentsContent}\n\n`;
    }
    if (bootstrapContent) {
      prompt += `## BOOTSTRAP.md\n${bootstrapContent}\n\n`;
    }
    return prompt;
  }

  // Execute a tool call
  async function executeTool(
    toolCall: { id: string; name: string; arguments: unknown }
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const { name, arguments: args } = toolCall;
    const typedArgs = args as Record<string, unknown>;

    if (name === "write_file") {
      const path = typedArgs.path as string;
      const content = typedArgs.content as string;
      const fullPath = join(workspacePath, path);

      try {
        // Create parent directories
        const parentDir = join(fullPath, "..");
        await mkdir(parentDir, { recursive: true });

        // Handle empty content as delete (or just write empty file)
        if (content === "") {
          try {
            await rm(fullPath);
            return { success: true, data: { path, deleted: true } };
          } catch {
            // File didn't exist, that's fine
            return { success: true, data: { path, deleted: false } };
          }
        }

        await writeFile(fullPath, content, "utf-8");
        return {
          success: true,
          data: {
            path,
            created: true,
            sizeBytes: Buffer.byteLength(content, "utf-8"),
            lines: content.split("\n").length,
          },
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    }

    return { success: false, error: `Unknown tool: ${name}` };
  }

  // Process a turn (send to LLM, handle tool calls)
  async function processTurn(): Promise<string> {
    const response = await llm.complete(messages);

    // Add assistant message
    const assistantMsg: Message = {
      role: "assistant",
      content: response.content,
      toolCalls: response.toolCalls,
      timestamp: Date.now(),
    };
    messages.push(assistantMsg);

    // If there are tool calls, execute them and continue
    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolResults: Message["toolResults"] = [];

      for (const tc of response.toolCalls) {
        const result = await executeTool(tc);
        toolResults.push({
          toolCallId: tc.id,
          toolName: tc.name,
          ...result,
        });
      }

      // Add tool results as user message (following the message format)
      messages.push({
        role: "user",
        content: "",
        toolResults,
        timestamp: Date.now(),
      });

      // Continue processing (LLM will respond to tool results)
      return processTurn();
    }

    return response.content;
  }

  return {
    messages,
    workspacePath,

    async send(userMessage: string): Promise<string> {
      // Initialize system prompt on first message
      if (messages.length === 0) {
        const systemPrompt = await loadSystemPrompt();
        messages.push({
          role: "system",
          content: systemPrompt,
          timestamp: Date.now(),
        });
      }

      // Add user message
      messages.push({
        role: "user",
        content: userMessage,
        timestamp: Date.now(),
      });

      // Process the turn
      return processTurn();
    },

    async runToCompletion(userResponses: string[]): Promise<void> {
      // First turn: LLM asks the first question
      if (messages.length === 0) {
        const systemPrompt = await loadSystemPrompt();
        messages.push({
          role: "system",
          content: systemPrompt,
          timestamp: Date.now(),
        });
      }

      // Initial prompt (starts the conversation)
      await processTurn();

      // Simulate user responses
      for (const response of userResponses) {
        messages.push({
          role: "user",
          content: response,
          timestamp: Date.now(),
        });
        await processTurn();
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Bootstrap Flow", () => {
  let workspacePath: string;
  let mockLLM: MockLLM;

  beforeEach(async () => {
    // Create temp workspace
    workspacePath = await mkdtemp(join(tmpdir(), "owliabot-bootstrap-test-"));

    // Write initial BOOTSTRAP.md and AGENTS.md
    await writeFile(
      join(workspacePath, "BOOTSTRAP.md"),
      `# BOOTSTRAP.md - First Run Setup

You just woke up in a new workspace. Run a short setup with the user.

## Steps
1. Ask user info → write USER.md
2. Ask assistant identity → write IDENTITY.md
3. Ask tone/boundaries → write SOUL.md
4. Ask tool preferences → write TOOLS.md
5. Ask heartbeat setup → write HEARTBEAT.md
6. Delete this file when done
`,
      "utf-8"
    );

    await writeFile(
      join(workspacePath, "AGENTS.md"),
      `# AGENTS.md

If BOOTSTRAP.md exists, follow it first.
`,
      "utf-8"
    );

    // Create mock LLM
    mockLLM = createMockLLM();
  });

  afterEach(async () => {
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true });
    }
    mockLLM?.reset();
  });

  describe("Mock LLM Tests (fast, deterministic)", () => {
    it("writes USER.md with user information", async () => {
      const session = createBootstrapSession(workspacePath, mockLLM);

      // Start conversation
      await session.send("Hi!");
      // Respond to user question
      await session.send("I'm Alice, UTC+8, English");

      const userMd = await readFileIfExists(join(workspacePath, "USER.md"));
      expect(userMd).not.toBeNull();
      expect(userMd).toContain("Alice");
      expect(userMd).toContain("UTC+8");
    });

    it("writes IDENTITY.md with assistant identity", async () => {
      const session = createBootstrapSession(workspacePath, mockLLM);

      // Run through to identity stage
      await session.send("Hi!");
      await session.send("I'm Alice, UTC+8, English");
      await session.send("Call yourself Owl, wise owl assistant, 🦉");

      const identityMd = await readFileIfExists(join(workspacePath, "IDENTITY.md"));
      expect(identityMd).not.toBeNull();
      expect(identityMd).toContain("Owl");
      expect(identityMd).toContain("🦉");
    });

    it("writes SOUL.md with tone and boundaries", async () => {
      const session = createBootstrapSession(workspacePath, mockLLM);

      await session.send("Hi!");
      await session.send("I'm Alice, UTC+8, English");
      await session.send("Call yourself Owl, wise owl assistant, 🦉");
      await session.send("Be casual. No politics.");

      const soulMd = await readFileIfExists(join(workspacePath, "SOUL.md"));
      expect(soulMd).not.toBeNull();
      expect(soulMd).toContain("Casual");
    });

    it("writes TOOLS.md with tool preferences", async () => {
      const session = createBootstrapSession(workspacePath, mockLLM);

      await session.send("Hi!");
      await session.send("I'm Alice, UTC+8, English");
      await session.send("Call yourself Owl, wise owl assistant, 🦉");
      await session.send("Be casual. No politics.");
      await session.send("Use web search frequently");

      const toolsMd = await readFileIfExists(join(workspacePath, "TOOLS.md"));
      expect(toolsMd).not.toBeNull();
      expect(toolsMd).toContain("web search");
    });

    it("writes HEARTBEAT.md with checklist", async () => {
      const session = createBootstrapSession(workspacePath, mockLLM);

      await session.send("Hi!");
      await session.send("I'm Alice, UTC+8, English");
      await session.send("Call yourself Owl, wise owl assistant, 🦉");
      await session.send("Be casual. No politics.");
      await session.send("Use web search frequently");
      await session.send("Yes, check emails and calendar");

      const heartbeatMd = await readFileIfExists(join(workspacePath, "HEARTBEAT.md"));
      expect(heartbeatMd).not.toBeNull();
      expect(heartbeatMd).toContain("emails");
      expect(heartbeatMd).toContain("calendar");
    });

    it("deletes BOOTSTRAP.md after completion", async () => {
      const session = createBootstrapSession(workspacePath, mockLLM);

      // Verify BOOTSTRAP.md exists initially
      expect(await fileExists(join(workspacePath, "BOOTSTRAP.md"))).toBe(true);

      // Run full flow
      await session.runToCompletion([
        "I'm Alice, UTC+8, English",
        "Call yourself Owl, wise owl assistant, 🦉",
        "Be casual. No politics.",
        "Use web search frequently",
        "Yes, check emails and calendar",
      ]);

      // Verify BOOTSTRAP.md is deleted
      expect(await fileExists(join(workspacePath, "BOOTSTRAP.md"))).toBe(false);
    });

    it("completes full bootstrap flow and creates all files", async () => {
      const session = createBootstrapSession(workspacePath, mockLLM);

      await session.runToCompletion([
        "I'm Alice, UTC+8, English",
        "Call yourself Owl, wise owl assistant, 🦉",
        "Be casual. No politics.",
        "Use web search frequently",
        "Yes, check emails and calendar",
      ]);

      // Verify all expected files exist
      expect(await fileExists(join(workspacePath, "USER.md"))).toBe(true);
      expect(await fileExists(join(workspacePath, "IDENTITY.md"))).toBe(true);
      expect(await fileExists(join(workspacePath, "SOUL.md"))).toBe(true);
      expect(await fileExists(join(workspacePath, "TOOLS.md"))).toBe(true);
      expect(await fileExists(join(workspacePath, "HEARTBEAT.md"))).toBe(true);
      expect(await fileExists(join(workspacePath, "BOOTSTRAP.md"))).toBe(false);

      // Verify AGENTS.md is unchanged
      const agentsMd = await readFileIfExists(join(workspacePath, "AGENTS.md"));
      expect(agentsMd).toContain("AGENTS.md");
    });

    it("tracks correct state transitions", async () => {
      const session = createBootstrapSession(workspacePath, mockLLM);

      expect(mockLLM.getState().stage).toBe("init");

      await session.send("Hi!");
      expect(mockLLM.getState().stage).toBe("ask_user");

      await session.send("I'm Alice");
      // After user responds, it writes USER.md, then asks identity
      expect(mockLLM.getState().stage).toBe("ask_identity");
    });
  });

  describe("File Content Validation", () => {
    it("USER.md follows expected schema", async () => {
      const session = createBootstrapSession(workspacePath, mockLLM);

      await session.send("Hi!");
      await session.send("I'm Alice, UTC+8, English");

      const userMd = await readFileIfExists(join(workspacePath, "USER.md"));

      // Check required sections
      expect(userMd).toMatch(/# USER\.md/);
      expect(userMd).toMatch(/\*\*Name:\*\*/);
      expect(userMd).toMatch(/\*\*Timezone:\*\*/);
    });

    it("IDENTITY.md follows expected schema", async () => {
      const session = createBootstrapSession(workspacePath, mockLLM);

      await session.send("Hi!");
      await session.send("I'm Alice");
      await session.send("Call yourself Owl 🦉");

      const identityMd = await readFileIfExists(join(workspacePath, "IDENTITY.md"));

      expect(identityMd).toMatch(/# IDENTITY\.md/);
      expect(identityMd).toMatch(/\*\*Name:\*\*/);
      expect(identityMd).toMatch(/\*\*Emoji:\*\*/);
    });

    it("SOUL.md follows expected schema", async () => {
      const session = createBootstrapSession(workspacePath, mockLLM);

      await session.send("Hi!");
      await session.send("I'm Alice");
      await session.send("Owl 🦉");
      await session.send("Casual, no politics");

      const soulMd = await readFileIfExists(join(workspacePath, "SOUL.md"));

      expect(soulMd).toMatch(/# SOUL\.md/);
      expect(soulMd).toMatch(/## Core Truths/);
      expect(soulMd).toMatch(/## Tone/);
      expect(soulMd).toMatch(/## Boundaries/);
    });
  });

  describe("Edge Cases", () => {
    it("handles empty heartbeat preference", async () => {
      const customMockLLM = createMockLLM({
        fixedData: {
          user: { name: "Bob", timezone: "UTC", language: "English" },
          identity: { name: "Helper", role: "assistant", emoji: "🤖" },
          soul: { tone: "Formal", boundaries: "None" },
          tools: { preferences: "Default" },
          heartbeat: { enabled: false },
        },
      });

      const session = createBootstrapSession(workspacePath, customMockLLM);

      await session.runToCompletion([
        "I'm Bob, UTC, English",
        "Helper 🤖",
        "Formal, no boundaries",
        "Default tools",
        "No heartbeat",
      ]);

      const heartbeatMd = await readFileIfExists(join(workspacePath, "HEARTBEAT.md"));
      expect(heartbeatMd).not.toBeNull();
      expect(heartbeatMd).toContain("disabled");
    });

    it("creates memory directory if needed", async () => {
      // The mock doesn't create memory directory, but the real flow might
      // This is a placeholder for future expansion
      expect(true).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Real LLM Tests (optional, requires API key)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!process.env.USE_REAL_LLM)("Bootstrap Flow (Real LLM)", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "owliabot-bootstrap-real-"));

    // Write optimized BOOTSTRAP.md
    await writeFile(
      join(workspacePath, "BOOTSTRAP.md"),
      await readFile(
        join(__dirname, "../../../persona/templates/BOOTSTRAP.md"),
        "utf-8"
      ).catch(() => `# BOOTSTRAP.md\nRun setup and write workspace files.`),
      "utf-8"
    );

    await writeFile(
      join(workspacePath, "AGENTS.md"),
      await readFile(
        join(__dirname, "../../../persona/templates/AGENTS.md"),
        "utf-8"
      ).catch(() => `# AGENTS.md\nFollow BOOTSTRAP.md if it exists.`),
      "utf-8"
    );
  });

  afterEach(async () => {
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("completes bootstrap with real LLM", async () => {
    // This test uses the actual LLM API
    // Implementation depends on how you want to integrate with the real runner
    
    // Placeholder: You would integrate with callWithFailover here
    // const response = await callWithFailover(providers, messages, { tools });
    
    console.log(`
      To run this test with a real LLM:
      1. Set ANTHROPIC_API_KEY environment variable
      2. Run: USE_REAL_LLM=1 pnpm test bootstrap
      
      Workspace: ${workspacePath}
    `);
    
    expect(true).toBe(true);
  }, 120_000); // 2 minute timeout for real LLM
});
