import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClearSessionTool } from "../clear-session.js";

describe("clear-session tool", () => {
  let mockSessionStore: any;
  let mockTranscripts: any;
  let clearSessionTool: ReturnType<typeof createClearSessionTool>;

  beforeEach(() => {
    mockSessionStore = {
      get: vi.fn().mockResolvedValue({ sessionId: "old-session-id" }),
      rotate: vi.fn().mockResolvedValue({ sessionId: "new-session-id" }),
    };
    mockTranscripts = {
      clear: vi.fn().mockResolvedValue(undefined),
    };

    clearSessionTool = createClearSessionTool({
      sessionStore: mockSessionStore,
      transcripts: mockTranscripts,
    });
  });

  it("should clear the session", async () => {
    const context: any = {
      sessionKey: "discord:123",
      agentId: "agent-1",
    };

    const result = await clearSessionTool.execute({}, context);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      message: "Session cleared",
      sessionId: "new-session-id",
    });
    expect(mockSessionStore.get).toHaveBeenCalledWith("discord:123");
    expect(mockSessionStore.rotate).toHaveBeenCalledWith("discord:123");
    expect(mockTranscripts.clear).toHaveBeenCalledWith("old-session-id");
    expect(mockTranscripts.clear).toHaveBeenCalledWith("new-session-id");
  });

  it("should have correct metadata", () => {
    expect(clearSessionTool.name).toBe("clear_session");
    expect(clearSessionTool.description).toContain("Clear the current conversation");
    expect(clearSessionTool.security.level).toBe("read");
  });

  it("should work with different session keys", async () => {
    const context: any = {
      sessionKey: "telegram:456",
      agentId: "agent-1",
    };

    await clearSessionTool.execute({}, context);

    expect(mockSessionStore.rotate).toHaveBeenCalledWith("telegram:456");
  });

  it("should handle missing existing session", async () => {
    mockSessionStore.get.mockResolvedValue(null);

    const context: any = {
      sessionKey: "discord:789",
      agentId: "agent-1",
    };

    const result = await clearSessionTool.execute({}, context);

    expect(result.success).toBe(true);
    // Should only clear the new session transcript, not the old one
    expect(mockTranscripts.clear).toHaveBeenCalledTimes(1);
    expect(mockTranscripts.clear).toHaveBeenCalledWith("new-session-id");
  });
});
