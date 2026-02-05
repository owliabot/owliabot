// src/agent/tools/builtin/__tests__/factory.test.ts
import { describe, it, expect, vi } from "vitest";
import { createBuiltinTools } from "../factory.js";
import type { SessionStore } from "../../../session-store.js";
import type { SessionTranscriptStore } from "../../../session-transcript.js";

describe("createBuiltinTools", () => {
  const mockSessionStore = {
    get: vi.fn(),
    getOrCreate: vi.fn(),
    rotate: vi.fn(),
  } as unknown as SessionStore;

  const mockTranscripts = {
    append: vi.fn(),
    clear: vi.fn(),
    getHistory: vi.fn(),
  } as unknown as SessionTranscriptStore;

  it("returns core tools by default", () => {
    const tools = createBuiltinTools({
      workspace: "/tmp/workspace",
      sessionStore: mockSessionStore,
      transcripts: mockTranscripts,
    });

    const names = tools.map((t) => t.name);
    expect(names).toContain("echo");
    expect(names).toContain("clear_session");
    expect(names).toContain("memory_search");
    expect(names).toContain("memory_get");
    expect(names).toContain("list_files");
    // Write tools should be excluded by default
    expect(names).not.toContain("edit_file");
  });

  it("excludes write tools when allowWrite is false", () => {
    const tools = createBuiltinTools({
      workspace: "/tmp/workspace",
      sessionStore: mockSessionStore,
      transcripts: mockTranscripts,
      tools: { allowWrite: false },
    });

    const names = tools.map((t) => t.name);
    expect(names).not.toContain("edit_file");
  });

  it("includes write tools when allowWrite is true", () => {
    const tools = createBuiltinTools({
      workspace: "/tmp/workspace",
      sessionStore: mockSessionStore,
      transcripts: mockTranscripts,
      tools: { allowWrite: true },
    });

    const names = tools.map((t) => t.name);
    expect(names).toContain("edit_file");
  });

  it("does not include help or cron tools (registered separately)", () => {
    const tools = createBuiltinTools({
      workspace: "/tmp/workspace",
      sessionStore: mockSessionStore,
      transcripts: mockTranscripts,
      tools: { allowWrite: true },
    });

    const names = tools.map((t) => t.name);
    expect(names).not.toContain("help");
    expect(names).not.toContain("cron");
  });

  it("returns valid tool definitions", () => {
    const tools = createBuiltinTools({
      workspace: "/tmp/workspace",
      sessionStore: mockSessionStore,
      transcripts: mockTranscripts,
    });

    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });
});
