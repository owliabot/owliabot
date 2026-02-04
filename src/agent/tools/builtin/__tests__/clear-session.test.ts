import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClearSessionTool } from "../clear-session.js";
import type { SessionManager, SessionKey } from "../../../session.js";
import type { ToolContext } from "../../interface.js";

describe("clear-session tool", () => {
  let mockSessionManager: SessionManager;
  let clearSessionTool: ReturnType<typeof createClearSessionTool>;

  beforeEach(() => {
    mockSessionManager = {
      get: vi.fn(),
      append: vi.fn(),
      getHistory: vi.fn(),
      clear: vi.fn(),
      list: vi.fn(),
    };

    clearSessionTool = createClearSessionTool(mockSessionManager);
  });

  it("should clear the session", async () => {
    const context: ToolContext = {
      sessionKey: "discord:123" as SessionKey,
      agentId: "agent-1",
      signer: null,
      config: {},
    };

    const result = await clearSessionTool.execute({}, context);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ message: "Session cleared" });
    expect(mockSessionManager.clear).toHaveBeenCalledWith("discord:123");
  });

  it("should have correct metadata", () => {
    expect(clearSessionTool.name).toBe("clear_session");
    expect(clearSessionTool.description).toContain("Clear the current conversation");
    expect(clearSessionTool.security.level).toBe("read");
  });

  it("should work with different session keys", async () => {
    const context: ToolContext = {
      sessionKey: "telegram:456" as SessionKey,
      agentId: "agent-1",
      signer: null,
      config: {},
    };

    await clearSessionTool.execute({}, context);

    expect(mockSessionManager.clear).toHaveBeenCalledWith("telegram:456");
  });
});
