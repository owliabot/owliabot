import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeHeartbeat } from "../heartbeat.js";
import * as runner from "../../agent/runner.js";
import type { HeartbeatOptions } from "../heartbeat.js";

vi.mock("../../agent/runner.js");
vi.mock("../../agent/system-prompt.js", () => ({
  buildSystemPrompt: vi.fn(() => "System prompt"),
}));
vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("executeHeartbeat", () => {
    it("should execute heartbeat and report OK", async () => {
      const mockNotifications = {
        notify: vi.fn(async () => {}),
      };

      const options: HeartbeatOptions = {
        config: {
          workspace: "./workspace",
          channels: {},
          agent: {
            defaultModel: "claude-sonnet-4-5",
            maxTurns: 20,
          },
          security: {},
          gateway: { enabled: false },
          providers: [
            {
              id: "anthropic",
              model: "claude-sonnet-4-5",
              apiKey: "test",
              priority: 1,
            },
          ],
        },
        workspace: {
          heartbeat: "Check emails",
        },
        notifications: mockNotifications as any,
      };

      vi.mocked(runner.callWithFailover).mockResolvedValue({
        content: "HEARTBEAT_OK",
        usage: { promptTokens: 100, completionTokens: 5 },
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      });

      await executeHeartbeat(options);

      expect(runner.callWithFailover).toHaveBeenCalled();
      expect(mockNotifications.notify).not.toHaveBeenCalled();
    });

    it("should send notification when heartbeat has something to report", async () => {
      const mockNotifications = {
        notify: vi.fn(async () => {}),
      };

      const options: HeartbeatOptions = {
        config: {
          workspace: "./workspace",
          channels: {},
          agent: {
            defaultModel: "claude-sonnet-4-5",
            maxTurns: 20,
          },
          security: {},
          gateway: { enabled: false },
          providers: [
            {
              id: "anthropic",
              model: "claude-sonnet-4-5",
              apiKey: "test",
              priority: 1,
            },
          ],
        },
        workspace: {
          heartbeat: "Check emails",
        },
        notifications: mockNotifications as any,
      };

      vi.mocked(runner.callWithFailover).mockResolvedValue({
        content: "Urgent: You have 5 unread emails!",
        usage: { promptTokens: 100, completionTokens: 50 },
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      });

      await executeHeartbeat(options);

      expect(runner.callWithFailover).toHaveBeenCalled();
      expect(mockNotifications.notify).toHaveBeenCalledWith(
        expect.stringContaining("Urgent: You have 5 unread emails!")
      );
    });

    it("should handle LLM errors", async () => {
      const mockNotifications = {
        notify: vi.fn(async () => {}),
      };

      const options: HeartbeatOptions = {
        config: {
          workspace: "./workspace",
          channels: {},
          agent: {
            defaultModel: "claude-sonnet-4-5",
            maxTurns: 20,
          },
          security: {},
          gateway: { enabled: false },
          providers: [
            {
              id: "anthropic",
              model: "claude-sonnet-4-5",
              apiKey: "test",
              priority: 1,
            },
          ],
        },
        workspace: {},
        notifications: mockNotifications as any,
      };

      vi.mocked(runner.callWithFailover).mockRejectedValue(
        new Error("LLM error")
      );

      await expect(executeHeartbeat(options)).rejects.toThrow("LLM error");
    });
  });
});
