// src/gateway/__tests__/commands.new-summarize.test.ts
/**
 * Test: /new command should summarize DM conversation before reset
 *
 * Bug reproduction: User has long DM conversation, runs /new, but summarizer
 * reports "only 0 user message(s)" even though messages exist.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tryHandleCommand } from "../commands.js";
import { createSessionStore } from "../../agent/session-store.js";
import { createSessionTranscriptStore } from "../../agent/session-transcript.js";
import { ChannelRegistry } from "../../channels/registry.js";
import type { MsgContext } from "../../channels/interface.js";
import type { Message } from "../../agent/session.js";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock the runner module
vi.mock("../../agent/runner.js", () => ({
  runLLM: vi.fn().mockResolvedValue({
    content: "- Summary bullet point\n- Another point",
    usage: { promptTokens: 100, completionTokens: 20 },
    provider: "anthropic",
    model: "claude-sonnet-4-5",
  }),
}));

import { runLLM } from "../../agent/runner.js";
const mockRunLLM = runLLM as ReturnType<typeof vi.fn>;

describe("/new command - DM session summarization bug", () => {
  let tempDir: string;
  let sessionsDir: string;
  let workspacePath: string;
  let sessionStore: ReturnType<typeof createSessionStore>;
  let transcripts: ReturnType<typeof createSessionTranscriptStore>;
  let channels: ChannelRegistry;

  // Mock Telegram DM context
  const makeDmContext = (body: string, from = "user123"): MsgContext => ({
    channel: "telegram",
    chatType: "direct",
    from,
    body,
    messageId: `msg-${Date.now()}`,
    timestamp: Date.now(),
    senderName: "TestUser",
  });

  // Create a mock channel
  const createMockChannel = () => ({
    id: "telegram",
    send: vi.fn().mockResolvedValue({ messageId: "reply-001" }),
    probe: async () => ({ ok: true }),
    onMessage: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    tempDir = await mkdtemp(join(tmpdir(), "owlia-new-test-"));
    sessionsDir = join(tempDir, "sessions");
    workspacePath = join(tempDir, "workspace");

    // Create directories that the session store and transcripts need
    const { mkdir } = await import("node:fs/promises");
    await mkdir(sessionsDir, { recursive: true });
    await mkdir(workspacePath, { recursive: true });

    sessionStore = createSessionStore({ sessionsDir });
    transcripts = createSessionTranscriptStore({ sessionsDir });
    channels = new ChannelRegistry();
    channels.register(createMockChannel());
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper: simulate sending messages and receiving responses
   */
  async function simulateConversation(
    sessionKey: string,
    exchanges: Array<{ user: string; assistant: string }>
  ): Promise<string> {
    const entry = await sessionStore.getOrCreate(sessionKey, {
      channel: "telegram",
      chatType: "direct",
      displayName: "TestUser",
    });

    for (const exchange of exchanges) {
      // User message
      await transcripts.append(entry.sessionId, {
        role: "user",
        content: exchange.user,
        timestamp: Date.now(),
      });
      // Assistant response
      await transcripts.append(entry.sessionId, {
        role: "assistant",
        content: exchange.assistant,
        timestamp: Date.now(),
      });
    }

    return entry.sessionId;
  }

  /**
   * 🐛 BUG REPRODUCTION TEST
   *
   * Scenario:
   * 1. User has a long DM conversation (many messages)
   * 2. User sends /new
   * 3. Expected: summarizer reads all messages and calls LLM
   * 4. Actual (bug): summarizer sees 0 messages
   */
  it("should summarize messages when /new is called after DM conversation", async () => {
    // Derive the session key the same way server.ts does
    const sessionKey = "agent:main:telegram:conv:main:main";

    // Simulate a long conversation (5 exchanges = 10 messages)
    const sessionId = await simulateConversation(sessionKey, [
      { user: "Hello, can you help me?", assistant: "Of course! What do you need?" },
      { user: "I need to set up a project", assistant: "Sure, what kind of project?" },
      { user: "A TypeScript project with tests", assistant: "Great choice! Let me help." },
      { user: "Should I use vitest or jest?", assistant: "I recommend vitest for speed." },
      { user: "Thanks, I'll go with that", assistant: "You're welcome!" },
    ]);

    // Verify messages were written
    const historyBefore = await transcripts.getHistory(sessionId, 50);
    expect(historyBefore.length).toBe(10); // 5 user + 5 assistant

    const userMessagesBefore = historyBefore.filter((m) => m.role === "user");
    expect(userMessagesBefore.length).toBe(5);

    // Now execute /new command
    const result = await tryHandleCommand({
      ctx: makeDmContext("/new"),
      sessionKey,
      sessionStore,
      transcripts,
      channels,
      workspacePath,
      summaryModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
      summarizeOnReset: true,
    });

    // Verify command was handled
    expect(result.handled).toBe(true);

    // 🔑 KEY ASSERTION: LLM should have been called for summarization
    expect(mockRunLLM).toHaveBeenCalledOnce();

    // Verify the transcript passed to LLM contains our messages
    const llmMessages = mockRunLLM.mock.calls[0][1] as Message[];
    const userPrompt = llmMessages.find((m) => m.role === "user")!.content;
    expect(userPrompt).toContain("Hello, can you help me?");
    expect(userPrompt).toContain("Should I use vitest or jest?");
  });

  /**
   * Test that session rotation happens AFTER summarization
   */
  it("should rotate session only after summarization completes", async () => {
    const sessionKey = "agent:main:telegram:conv:main:main";

    const oldSessionId = await simulateConversation(sessionKey, [
      { user: "First message", assistant: "First response" },
      { user: "Second message", assistant: "Second response" },
    ]);

    // Execute /new
    await tryHandleCommand({
      ctx: makeDmContext("/new"),
      sessionKey,
      sessionStore,
      transcripts,
      channels,
      workspacePath,
      summaryModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
      summarizeOnReset: true,
    });

    // After /new, session should have a NEW sessionId
    const newEntry = await sessionStore.get(sessionKey);
    expect(newEntry).not.toBeNull();
    expect(newEntry!.sessionId).not.toBe(oldSessionId);

    // Old transcript should be cleared
    const oldHistory = await transcripts.getHistory(oldSessionId, 50);
    expect(oldHistory.length).toBe(0);
  });

  /**
   * Test: verify sessionKey consistency between message write and /new
   */
  it("should use consistent sessionKey for writes and /new command", async () => {
    // This tests that the same sessionKey derivation is used

    // Session key format from session-key.ts for DM:
    // agent:<agentId>:<channel>:conv:<conversationId>
    // For DM, conversationId = "main:main" by default
    const expectedSessionKey = "agent:main:telegram:conv:main:main";

    // Create session and write a message
    const entry = await sessionStore.getOrCreate(expectedSessionKey, {
      channel: "telegram",
      chatType: "direct",
    });

    await transcripts.append(entry.sessionId, {
      role: "user",
      content: "Test message",
      timestamp: Date.now(),
    });
    await transcripts.append(entry.sessionId, {
      role: "assistant",
      content: "Test response",
      timestamp: Date.now(),
    });

    // Now get() with same key should return same session
    const fetched = await sessionStore.get(expectedSessionKey);
    expect(fetched).not.toBeNull();
    expect(fetched!.sessionId).toBe(entry.sessionId);

    // And history should show our messages
    const history = await transcripts.getHistory(entry.sessionId);
    expect(history.length).toBe(2);
    expect(history[0].content).toBe("Test message");
  });

  /**
   * Edge case: /new with no prior session should not crash
   */
  it("should handle /new gracefully when no prior session exists", async () => {
    const sessionKey = "agent:main:telegram:conv:main:main";

    // Don't create any session - just run /new
    const result = await tryHandleCommand({
      ctx: makeDmContext("/new"),
      sessionKey,
      sessionStore,
      transcripts,
      channels,
      workspacePath,
      summaryModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
      summarizeOnReset: true,
    });

    expect(result.handled).toBe(true);
    // Should not call LLM (nothing to summarize)
    expect(mockRunLLM).not.toHaveBeenCalled();
  });

  /**
   * Edge case: session exists but has no messages
   */
  it("should skip summarization when session exists but has no messages", async () => {
    const sessionKey = "agent:main:telegram:conv:main:main";

    // Create session but don't write any messages
    await sessionStore.getOrCreate(sessionKey, {
      channel: "telegram",
      chatType: "direct",
    });

    const result = await tryHandleCommand({
      ctx: makeDmContext("/new"),
      sessionKey,
      sessionStore,
      transcripts,
      channels,
      workspacePath,
      summaryModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
      summarizeOnReset: true,
    });

    expect(result.handled).toBe(true);
    expect(mockRunLLM).not.toHaveBeenCalled();
  });

  /**
   * Diagnostic: verify transcript file contents directly
   */
  it("should write messages to the correct transcript file", async () => {
    const sessionKey = "agent:main:telegram:conv:main:main";

    const entry = await sessionStore.getOrCreate(sessionKey, {
      channel: "telegram",
      chatType: "direct",
    });

    await transcripts.append(entry.sessionId, {
      role: "user",
      content: "Direct file check",
      timestamp: Date.now(),
    });

    // Check the file directly
    const transcriptPath = join(sessionsDir, "transcripts", `${entry.sessionId}.jsonl`);
    const fileContent = await readFile(transcriptPath, "utf-8");
    
    expect(fileContent).toContain("Direct file check");
    expect(fileContent).toContain('"role":"user"');
  });

  /**
   * Test: messages with tool results should not be counted as user messages for summarization
   */
  it("should not count tool result messages when determining summarization", async () => {
    const sessionKey = "agent:main:telegram:conv:main:main";

    const entry = await sessionStore.getOrCreate(sessionKey, {
      channel: "telegram",
      chatType: "direct",
    });

    // Only one real user message
    await transcripts.append(entry.sessionId, {
      role: "user",
      content: "Hello",
      timestamp: Date.now(),
    });

    // Tool result message (role=user but empty content)
    await transcripts.append(entry.sessionId, {
      role: "user",
      content: "", // Empty - this is a tool result placeholder
      timestamp: Date.now(),
      toolResults: [{ toolCallId: "call-1", toolName: "echo", success: true, output: "test" }],
    });

    await transcripts.append(entry.sessionId, {
      role: "assistant",
      content: "Response",
      timestamp: Date.now(),
    });

    // Only 1 real user message, not enough for summary (needs 2)
    const result = await tryHandleCommand({
      ctx: makeDmContext("/new"),
      sessionKey,
      sessionStore,
      transcripts,
      channels,
      workspacePath,
      summaryModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
      summarizeOnReset: true,
    });

    expect(result.handled).toBe(true);
    expect(mockRunLLM).not.toHaveBeenCalled(); // Not enough real user messages
  });
});
