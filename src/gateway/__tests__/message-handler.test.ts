// src/gateway/__tests__/message-handler.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkIdempotency,
  checkRateLimit,
  sendRateLimitWarning,
  logMessageEvent,
  handleMessage,
} from "../message-handler.js";
import { ChannelRegistry } from "../../channels/registry.js";
import type { MsgContext } from "../../channels/interface.js";

// Mock logger
vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock dependencies
vi.mock("../../infra/index.js", () => ({
  hashMessage: vi.fn((channel, id, body) => `hash:${channel}:${id}:${body.slice(0, 10)}`),
}));

vi.mock("../activation.js", () => ({
  shouldHandleMessage: vi.fn(() => true),
}));

vi.mock("./commands.js", () => ({
  tryHandleCommand: vi.fn(async () => ({ handled: false })),
  tryHandleStatusCommand: vi.fn(async () => ({ handled: false })),
}));

vi.mock("../../agent/session-key.js", () => ({
  resolveAgentId: vi.fn(() => "main"),
  resolveSessionKey: vi.fn(() => "session:123"),
}));

vi.mock("../../agent/system-prompt.js", () => ({
  buildSystemPrompt: vi.fn(() => "System prompt"),
}));

vi.mock("../agentic-loop.js", () => ({
  runAgenticLoop: vi.fn(async () => ({
    content: "Response",
    iterations: 1,
    toolCallsCount: 0,
    messages: [],
    maxIterationsReached: false,
  })),
  createConversation: vi.fn((systemPrompt, history) => [
    { role: "system", content: systemPrompt },
    ...history,
  ]),
}));

// Mock InfraStore
const mockInfraStore = {
  getIdempotency: vi.fn(),
  saveIdempotency: vi.fn(),
  checkRateLimit: vi.fn(() => ({ allowed: true, resetAt: 0, remaining: 10 })),
  insertEvent: vi.fn(),
};

describe("message-handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkIdempotency", () => {
    const makeCtx = (overrides = {}): MsgContext => ({
      channel: "telegram",
      messageId: "msg123",
      body: "Hello",
      from: "user1",
      timestamp: Date.now(),
      chatType: "direct",
      ...overrides,
    } as MsgContext);

    it("returns skip=false when infraStore is null", () => {
      const result = checkIdempotency(
        makeCtx(),
        null,
        { idempotency: { enabled: true } },
        Date.now()
      );

      expect(result.skip).toBe(false);
    });

    it("returns skip=false when idempotency is disabled", () => {
      const result = checkIdempotency(
        makeCtx(),
        mockInfraStore as any,
        { idempotency: { enabled: false } },
        Date.now()
      );

      expect(result.skip).toBe(false);
    });

    it("returns skip=false when messageId is missing", () => {
      const result = checkIdempotency(
        makeCtx({ messageId: undefined }),
        mockInfraStore as any,
        { idempotency: { enabled: true } },
        Date.now()
      );

      expect(result.skip).toBe(false);
    });

    it("returns skip=true when cached and hash matches", () => {
      const now = Date.now();
      mockInfraStore.getIdempotency.mockReturnValue({
        requestHash: "hash:telegram:msg123:Hello",
        expiresAt: now + 1000,
      });

      const result = checkIdempotency(
        makeCtx(),
        mockInfraStore as any,
        { idempotency: { enabled: true } },
        now
      );

      expect(result.skip).toBe(true);
    });

    it("returns skip=false when cached but expired", () => {
      const now = Date.now();
      mockInfraStore.getIdempotency.mockReturnValue({
        requestHash: "hash:telegram:msg123:Hello",
        expiresAt: now - 1000, // Expired
      });

      const result = checkIdempotency(
        makeCtx(),
        mockInfraStore as any,
        { idempotency: { enabled: true } },
        now
      );

      expect(result.skip).toBe(false);
    });

    it("saves new idempotency record", () => {
      mockInfraStore.getIdempotency.mockReturnValue(null);
      const now = Date.now();

      checkIdempotency(
        makeCtx(),
        mockInfraStore as any,
        { idempotency: { enabled: true, ttlMs: 10000 } },
        now
      );

      expect(mockInfraStore.saveIdempotency).toHaveBeenCalledWith(
        "msg:telegram:msg123",
        "hash:telegram:msg123:Hello",
        { processing: true },
        now + 10000
      );
    });
  });

  describe("checkRateLimit", () => {
    const makeCtx = (): MsgContext => ({
      channel: "telegram",
      from: "user1",
      body: "Hello",
      timestamp: Date.now(),
      chatType: "direct",
    } as MsgContext);

    it("returns allowed=true when infraStore is null", () => {
      const result = checkRateLimit(makeCtx(), null, {}, Date.now());

      expect(result.allowed).toBe(true);
    });

    it("returns allowed=true when rate limit is disabled", () => {
      const result = checkRateLimit(
        makeCtx(),
        mockInfraStore as any,
        { rateLimit: { enabled: false } },
        Date.now()
      );

      expect(result.allowed).toBe(true);
    });

    it("returns allowed=true when under limit", () => {
      mockInfraStore.checkRateLimit.mockReturnValue({
        allowed: true,
        resetAt: Date.now() + 60000,
        remaining: 10,
      });

      const result = checkRateLimit(
        makeCtx(),
        mockInfraStore as any,
        { rateLimit: { enabled: true } },
        Date.now()
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10);
    });

    it("returns allowed=false when over limit", () => {
      const now = Date.now();
      mockInfraStore.checkRateLimit.mockReturnValue({
        allowed: false,
        resetAt: now + 30000,
        remaining: 0,
      });

      const result = checkRateLimit(
        makeCtx(),
        mockInfraStore as any,
        { rateLimit: { enabled: true } },
        now
      );

      expect(result.allowed).toBe(false);
      expect(result.waitSeconds).toBe(30);
    });

    it("logs rate limit event when blocked", () => {
      const now = Date.now();
      mockInfraStore.checkRateLimit.mockReturnValue({
        allowed: false,
        resetAt: now + 30000,
        remaining: 0,
      });

      checkRateLimit(
        makeCtx(),
        mockInfraStore as any,
        { rateLimit: { enabled: true }, eventStore: { enabled: true } },
        now
      );

      expect(mockInfraStore.insertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "rate_limit",
          status: "blocked",
        })
      );
    });

    it("uses configured window and max messages", () => {
      checkRateLimit(
        makeCtx(),
        mockInfraStore as any,
        { rateLimit: { enabled: true, windowMs: 30000, maxMessages: 10 } },
        Date.now()
      );

      expect(mockInfraStore.checkRateLimit).toHaveBeenCalledWith(
        "user:telegram:user1",
        30000,
        10,
        expect.any(Number)
      );
    });
  });

  describe("sendRateLimitWarning", () => {
    it("sends warning message to user", async () => {
      const mockChannel = { send: vi.fn() };
      const registry = new ChannelRegistry();
      registry.register({ id: "telegram", ...mockChannel } as any);

      const ctx: MsgContext = {
        channel: "telegram",
        from: "user1",
        messageId: "msg123",
        chatType: "direct",
        body: "",
        timestamp: Date.now(),
      } as MsgContext;

      await sendRateLimitWarning(ctx, registry, 30);

      expect(mockChannel.send).toHaveBeenCalledWith("user1", {
        text: expect.stringContaining("30"),
        replyToId: "msg123",
      });
    });

    it("sends to groupId for group chats", async () => {
      const mockChannel = { send: vi.fn() };
      const registry = new ChannelRegistry();
      registry.register({ id: "telegram", ...mockChannel } as any);

      const ctx: MsgContext = {
        channel: "telegram",
        from: "user1",
        groupId: "group123",
        messageId: "msg123",
        chatType: "group",
        body: "",
        timestamp: Date.now(),
      } as MsgContext;

      await sendRateLimitWarning(ctx, registry, 30);

      expect(mockChannel.send).toHaveBeenCalledWith("group123", expect.any(Object));
    });
  });

  describe("logMessageEvent", () => {
    it("does nothing when infraStore is null", () => {
      logMessageEvent(null, {}, {} as any, "session", 1, 100, Date.now(), false);
      // No error should be thrown
    });

    it("does nothing when eventStore is disabled", () => {
      logMessageEvent(
        mockInfraStore as any,
        { eventStore: { enabled: false } },
        {} as any,
        "session",
        1,
        100,
        Date.now(),
        false
      );

      expect(mockInfraStore.insertEvent).not.toHaveBeenCalled();
    });

    it("inserts success event for normal response", () => {
      const startTime = Date.now() - 1000;
      
      logMessageEvent(
        mockInfraStore as any,
        { eventStore: { enabled: true } },
        { channel: "telegram", from: "user1", messageId: "msg123" } as any,
        "session:123",
        2,
        500,
        startTime,
        false
      );

      expect(mockInfraStore.insertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "message.processed",
          status: "success",
          source: "telegram:user1",
        })
      );
    });

    it("inserts error event for error response", () => {
      logMessageEvent(
        mockInfraStore as any,
        { eventStore: { enabled: true } },
        { channel: "telegram", from: "user1" } as any,
        "session:123",
        1,
        100,
        Date.now(),
        true
      );

      expect(mockInfraStore.insertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
        })
      );
    });
  });

  describe("handleMessage", () => {
    const makeDeps = () => ({
      config: {
        providers: [{ id: "test", model: "test-model", apiKey: "key" }],
        workspace: "/workspace",
      } as any,
      workspace: {},
      sessionStore: {
        getOrCreate: vi.fn(async () => ({ sessionId: "sid123" })),
      } as any,
      transcripts: {
        append: vi.fn(),
        getHistory: vi.fn(async () => []),
      } as any,
      channels: new ChannelRegistry(),
      tools: { getAll: vi.fn(() => []) } as any,
      writeGateChannels: new Map(),
      skillsResult: null,
      infraStore: null,
    });

    const makeCtx = (): MsgContext => ({
      channel: "telegram",
      from: "user1",
      messageId: "msg123",
      body: "Hello",
      timestamp: Date.now(),
      chatType: "direct",
    } as MsgContext);

    it("skips message when shouldHandleMessage returns false", async () => {
      const { shouldHandleMessage } = await import("../activation.js");
      vi.mocked(shouldHandleMessage).mockReturnValue(false);

      const deps = makeDeps();
      await handleMessage(makeCtx(), deps);

      expect(deps.sessionStore.getOrCreate).not.toHaveBeenCalled();
    });

    it("skips message when idempotency check fails", async () => {
      const { shouldHandleMessage } = await import("../activation.js");
      vi.mocked(shouldHandleMessage).mockReturnValue(true);

      const deps = makeDeps();
      deps.infraStore = {
        getIdempotency: vi.fn(() => ({
          requestHash: "hash:telegram:msg123:Hello",
          expiresAt: Date.now() + 10000,
        })),
        saveIdempotency: vi.fn(),
      } as any;
      deps.config.infra = { idempotency: { enabled: true } };

      await handleMessage(makeCtx(), deps);

      expect(deps.sessionStore.getOrCreate).not.toHaveBeenCalled();
    });

    it("sends rate limit warning when rate limit exceeded", async () => {
      const { shouldHandleMessage } = await import("../activation.js");
      vi.mocked(shouldHandleMessage).mockReturnValue(true);

      const mockChannel = { id: "telegram", send: vi.fn() };
      const deps = makeDeps();
      deps.channels.register(mockChannel as any);
      deps.infraStore = {
        getIdempotency: vi.fn(() => null),
        saveIdempotency: vi.fn(),
        checkRateLimit: vi.fn(() => ({
          allowed: false,
          resetAt: Date.now() + 30000,
          remaining: 0,
        })),
        insertEvent: vi.fn(),
      } as any;
      deps.config.infra = { rateLimit: { enabled: true } };

      await handleMessage(makeCtx(), deps);

      expect(mockChannel.send).toHaveBeenCalledWith(
        "user1",
        expect.objectContaining({
          text: expect.stringContaining("30"),
        })
      );
    });

    it("calls agentic loop and sends response", async () => {
      const { shouldHandleMessage } = await import("../activation.js");
      vi.mocked(shouldHandleMessage).mockReturnValue(true);

      const { runAgenticLoop } = await import("../agentic-loop.js");

      const mockChannel = { id: "telegram", send: vi.fn() };
      const deps = makeDeps();
      deps.channels.register(mockChannel as any);

      await handleMessage(makeCtx(), deps);

      expect(runAgenticLoop).toHaveBeenCalled();
      expect(mockChannel.send).toHaveBeenCalledWith(
        "user1",
        expect.objectContaining({
          text: "Response",
        })
      );
    });

    it("appends messages to transcript", async () => {
      const { shouldHandleMessage } = await import("../activation.js");
      vi.mocked(shouldHandleMessage).mockReturnValue(true);

      const mockChannel = { id: "telegram", send: vi.fn() };
      const deps = makeDeps();
      deps.channels.register(mockChannel as any);

      await handleMessage(makeCtx(), deps);

      // User message + assistant response
      expect(deps.transcripts.append).toHaveBeenCalledTimes(2);
      expect(deps.transcripts.append).toHaveBeenCalledWith(
        "sid123",
        expect.objectContaining({ role: "user", content: "Hello" })
      );
      expect(deps.transcripts.append).toHaveBeenCalledWith(
        "sid123",
        expect.objectContaining({ role: "assistant", content: "Response" })
      );
    });
  });
});
