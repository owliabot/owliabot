// src/gateway/__tests__/session-summarizer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { summarizeAndSave } from "../session-summarizer.js";
import type { SessionTranscriptStore } from "../../agent/session-transcript.js";
import type { Message } from "../../agent/session.js";

// Mock the runner module
vi.mock("../../agent/runner.js", () => ({
  runLLM: vi.fn(),
}));

// Mock fs operations
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  appendFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { runLLM } from "../../agent/runner.js";
import { mkdir, readFile, appendFile } from "node:fs/promises";

const mockRunLLM = runLLM as ReturnType<typeof vi.fn>;
const mockReadFile = readFile as ReturnType<typeof vi.fn>;
const mockAppendFile = appendFile as ReturnType<typeof vi.fn>;
const mockMkdir = mkdir as ReturnType<typeof vi.fn>;

function createMockTranscripts(messages: Message[] = []): SessionTranscriptStore {
  return {
    async append() {},
    async readAll() { return messages; },
    async getHistory() { return messages; },
    async clear() {},
  };
}

function makeMessages(count: number): Message[] {
  const msgs: Message[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: i % 2 === 0 ? `User message ${i / 2 + 1}` : `Response ${Math.ceil(i / 2)}`,
      timestamp: Date.now() + i * 1000,
    });
  }
  return msgs;
}

describe("summarizeAndSave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue({ code: "ENOENT" }); // file doesn't exist by default
  });

  it("should skip if fewer than 2 user messages", async () => {
    const transcripts = createMockTranscripts([
      { role: "user", content: "hi", timestamp: Date.now() },
      { role: "assistant", content: "hello!", timestamp: Date.now() },
    ]);

    const result = await summarizeAndSave({
      summaryModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
      sessionId: "sess-1",
      transcripts,
      workspacePath: "/tmp/workspace",
    });

    expect(result.summarized).toBe(false);
    expect(mockRunLLM).not.toHaveBeenCalled();
  });

  it("should call LLM and save summary when enough messages", async () => {
    const messages = makeMessages(6); // 3 user + 3 assistant
    const transcripts = createMockTranscripts(messages);

    mockRunLLM.mockResolvedValue({
      content: "- Discussed project setup\n- Decided on TypeScript",
      usage: { promptTokens: 100, completionTokens: 30 },
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });

    const result = await summarizeAndSave({
      summaryModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
      sessionId: "sess-2",
      transcripts,
      workspacePath: "/tmp/workspace",
    });

    expect(result.summarized).toBe(true);
    expect(result.summary).toContain("Discussed project setup");
    expect(mockRunLLM).toHaveBeenCalledOnce();
    expect(mockMkdir).toHaveBeenCalled();
    expect(mockAppendFile).toHaveBeenCalledOnce();

    // Check the appended content contains header + summary
    const appendedContent = mockAppendFile.mock.calls[0][1] as string;
    expect(appendedContent).toContain("Daily Notes");
    expect(appendedContent).toContain("Session summary");
    expect(appendedContent).toContain("Discussed project setup");
  });

  it("should append without header when file already exists", async () => {
    const messages = makeMessages(4); // 2 user + 2 assistant
    const transcripts = createMockTranscripts(messages);

    mockReadFile.mockResolvedValue("# 2026-02-04 Daily Notes\n\nOld content\n");
    mockRunLLM.mockResolvedValue({
      content: "- New summary point",
      usage: { promptTokens: 50, completionTokens: 10 },
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });

    const result = await summarizeAndSave({
      summaryModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
      sessionId: "sess-3",
      transcripts,
      workspacePath: "/tmp/workspace",
    });

    expect(result.summarized).toBe(true);
    const appendedContent = mockAppendFile.mock.calls[0][1] as string;
    // Should NOT have the "# Daily Notes" header again
    expect(appendedContent).not.toContain("Daily Notes");
    expect(appendedContent).toContain("Session summary");
  });

  it("should handle LLM failure gracefully (non-fatal)", async () => {
    const messages = makeMessages(4);
    const transcripts = createMockTranscripts(messages);

    mockRunLLM.mockRejectedValue(new Error("API key invalid"));

    const result = await summarizeAndSave({
      summaryModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
      sessionId: "sess-4",
      transcripts,
      workspacePath: "/tmp/workspace",
    });

    // Should not throw, just return summarized: false
    expect(result.summarized).toBe(false);
  });

  it("should handle empty LLM response", async () => {
    const messages = makeMessages(4);
    const transcripts = createMockTranscripts(messages);

    mockRunLLM.mockResolvedValue({
      content: "   ",
      usage: { promptTokens: 50, completionTokens: 1 },
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });

    const result = await summarizeAndSave({
      summaryModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
      sessionId: "sess-5",
      transcripts,
      workspacePath: "/tmp/workspace",
    });

    expect(result.summarized).toBe(false);
  });

  it("should use custom model when provided", async () => {
    const messages = makeMessages(4);
    const transcripts = createMockTranscripts(messages);

    mockRunLLM.mockResolvedValue({
      content: "- Summary",
      usage: { promptTokens: 50, completionTokens: 10 },
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });

    await summarizeAndSave({
      summaryModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
      sessionId: "sess-6",
      transcripts,
      workspacePath: "/tmp/workspace",
      summaryModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
    });

    expect(mockRunLLM).toHaveBeenCalledWith(
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      expect.any(Array),
      expect.any(Object),
    );
  });

  it("should filter out system messages from transcript text", async () => {
    const messages: Message[] = [
      { role: "system", content: "You are a helpful assistant", timestamp: Date.now() },
      { role: "user", content: "Hello", timestamp: Date.now() },
      { role: "assistant", content: "Hi!", timestamp: Date.now() },
      { role: "user", content: "Help me with X", timestamp: Date.now() },
      { role: "assistant", content: "Sure, here's how...", timestamp: Date.now() },
    ];
    const transcripts = createMockTranscripts(messages);

    mockRunLLM.mockResolvedValue({
      content: "- Summary",
      usage: { promptTokens: 50, completionTokens: 10 },
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });

    await summarizeAndSave({
      summaryModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
      sessionId: "sess-7",
      transcripts,
      workspacePath: "/tmp/workspace",
    });

    // The user content sent to LLM should not include the system message
    const llmMessages = mockRunLLM.mock.calls[0][1] as Message[];
    const userPrompt = llmMessages.find((m) => m.role === "user")!.content;
    expect(userPrompt).not.toContain("You are a helpful assistant");
    expect(userPrompt).toContain("[user]: Hello");
  });
});
