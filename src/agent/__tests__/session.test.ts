import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSessionManager } from "../session.js";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

vi.mock("node:fs/promises");
vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("session", () => {
  const sessionsDir = "/tmp/test-sessions";
  let manager: ReturnType<typeof createSessionManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createSessionManager(sessionsDir);
  });

  describe("get", () => {
    it("should return session info for existing session", async () => {
      const messages = [
        { role: "user", content: "Hello", timestamp: 1000 },
        { role: "assistant", content: "Hi", timestamp: 2000 },
      ];
      vi.mocked(readFile).mockResolvedValue(
        messages.map((m) => JSON.stringify(m)).join("\n") + "\n"
      );

      const session = await manager.get("discord:123" as any);

      expect(session.key).toBe("discord:123");
      expect(session.createdAt).toBe(1000);
      expect(session.lastActiveAt).toBe(2000);
      expect(session.messageCount).toBe(2);
    });

    it("should handle empty session", async () => {
      const error: any = new Error("ENOENT");
      error.code = "ENOENT";
      vi.mocked(readFile).mockRejectedValue(error);

      const session = await manager.get("discord:456" as any);

      expect(session.key).toBe("discord:456");
      expect(session.messageCount).toBe(0);
    });
  });

  describe("append", () => {
    it("should append message to session file", async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      const message = { role: "user" as const, content: "Test", timestamp: 1000 };
      await manager.append("discord:123" as any, message);

      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining("discord_123.jsonl"),
        JSON.stringify(message) + "\n",
        { flag: "a" }
      );
    });
  });

  describe("getHistory", () => {
    it("should return recent history with turn limit", async () => {
      const messages = [];
      for (let i = 0; i < 50; i++) {
        messages.push({ role: "user", content: `msg${i}`, timestamp: i * 1000 });
        messages.push({ role: "assistant", content: `reply${i}`, timestamp: i * 1000 + 500 });
      }
      vi.mocked(readFile).mockResolvedValue(
        messages.map((m) => JSON.stringify(m)).join("\n") + "\n"
      );

      const history = await manager.getHistory("discord:123" as any, 10);

      // 10 turns = 20 messages
      expect(history.length).toBe(20);
      expect(history[0].content).toBe("msg40");
    });

    it("should handle incomplete turns", async () => {
      const messages = [
        { role: "user", content: "Hello", timestamp: 1000 },
        { role: "assistant", content: "Hi", timestamp: 2000 },
        { role: "user", content: "How are you?", timestamp: 3000 },
      ];
      vi.mocked(readFile).mockResolvedValue(
        messages.map((m) => JSON.stringify(m)).join("\n") + "\n"
      );

      const history = await manager.getHistory("discord:123" as any, 20);

      expect(history.length).toBe(3);
    });
  });

  describe("clear", () => {
    it("should clear session file", async () => {
      vi.mocked(writeFile).mockResolvedValue();

      await manager.clear("discord:123" as any);

      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining("discord_123.jsonl"),
        ""
      );
    });
  });

  describe("list", () => {
    it("should list all session keys", async () => {
      vi.mocked(readdir).mockResolvedValue([
        "discord_123.jsonl",
        "telegram_456.jsonl",
        "other.txt",
      ] as any);

      const keys = await manager.list();

      expect(keys).toEqual(["discord:123", "telegram:456"]);
    });

    it("should return empty array if directory doesn't exist", async () => {
      const error: any = new Error("ENOENT");
      error.code = "ENOENT";
      vi.mocked(readdir).mockRejectedValue(error);

      const keys = await manager.list();

      expect(keys).toEqual([]);
    });
  });
});
