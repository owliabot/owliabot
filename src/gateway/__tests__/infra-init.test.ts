// src/gateway/__tests__/infra-init.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createInfraContext,
  scheduleInfraCleanup,
  cleanupInfraContext,
  type InfraContext,
} from "../infra-init.js";

// Mock dependencies
vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockStore = {
  cleanup: vi.fn(),
  close: vi.fn(),
  getIdempotency: vi.fn(),
  saveIdempotency: vi.fn(),
  checkRateLimit: vi.fn(),
  insertEvent: vi.fn(),
};

vi.mock("../../infra/index.js", () => ({
  createInfraStore: vi.fn(() => mockStore),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/test"),
}));

describe("infra-init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createInfraContext", () => {
    it("creates store when enabled", () => {
      const ctx = createInfraContext({ enabled: true });
      
      expect(ctx.store).toBe(mockStore);
      expect(ctx.cleanupInterval).toBeNull();
    });

    it("returns null store when disabled", () => {
      const ctx = createInfraContext({ enabled: false });
      
      expect(ctx.store).toBeNull();
      expect(ctx.cleanupInterval).toBeNull();
    });

    it("uses default path when not specified", async () => {
      const { createInfraStore } = await import("../../infra/index.js");
      
      createInfraContext({});
      
      expect(createInfraStore).toHaveBeenCalledWith({
        sqlitePath: "/home/test/.owliabot/infra.db",
      });
    });

    it("expands ~ in sqlitePath", async () => {
      const { createInfraStore } = await import("../../infra/index.js");
      
      createInfraContext({ sqlitePath: "~/custom/path.db" });
      
      expect(createInfraStore).toHaveBeenCalledWith({
        sqlitePath: "/home/test/custom/path.db",
      });
    });

    it("creates parent directory if missing", async () => {
      const { existsSync, mkdirSync } = await import("node:fs");
      vi.mocked(existsSync).mockReturnValue(false);
      
      createInfraContext({ sqlitePath: "/new/dir/infra.db" });
      
      expect(mkdirSync).toHaveBeenCalledWith("/new/dir", { recursive: true });
    });
  });

  describe("scheduleInfraCleanup", () => {
    it("schedules cleanup interval", () => {
      const ctx: InfraContext = { store: mockStore as any, cleanupInterval: null };
      
      const result = scheduleInfraCleanup(ctx, 1000);
      
      expect(result.cleanupInterval).not.toBeNull();
    });

    it("runs cleanup on interval", () => {
      const ctx: InfraContext = { store: mockStore as any, cleanupInterval: null };
      
      scheduleInfraCleanup(ctx, 1000);
      
      expect(mockStore.cleanup).not.toHaveBeenCalled();
      
      vi.advanceTimersByTime(1000);
      expect(mockStore.cleanup).toHaveBeenCalledTimes(1);
      
      vi.advanceTimersByTime(1000);
      expect(mockStore.cleanup).toHaveBeenCalledTimes(2);
    });

    it("clears existing interval before scheduling new one", () => {
      const existingInterval = setInterval(() => {}, 1000);
      const ctx: InfraContext = { store: mockStore as any, cleanupInterval: existingInterval };
      
      const clearSpy = vi.spyOn(global, "clearInterval");
      scheduleInfraCleanup(ctx, 500);
      
      expect(clearSpy).toHaveBeenCalledWith(existingInterval);
    });

    it("returns unchanged context when store is null", () => {
      const ctx: InfraContext = { store: null, cleanupInterval: null };
      
      const result = scheduleInfraCleanup(ctx);
      
      expect(result.cleanupInterval).toBeNull();
    });
  });

  describe("cleanupInfraContext", () => {
    it("clears interval and closes store", () => {
      const interval = setInterval(() => {}, 1000);
      const ctx: InfraContext = { store: mockStore as any, cleanupInterval: interval };
      
      const clearSpy = vi.spyOn(global, "clearInterval");
      cleanupInfraContext(ctx);
      
      expect(clearSpy).toHaveBeenCalledWith(interval);
      expect(mockStore.cleanup).toHaveBeenCalled();
      expect(mockStore.close).toHaveBeenCalled();
    });

    it("handles null store gracefully", () => {
      const ctx: InfraContext = { store: null, cleanupInterval: null };
      
      expect(() => cleanupInfraContext(ctx)).not.toThrow();
    });

    it("handles null interval gracefully", () => {
      const ctx: InfraContext = { store: mockStore as any, cleanupInterval: null };
      
      expect(() => cleanupInfraContext(ctx)).not.toThrow();
      expect(mockStore.close).toHaveBeenCalled();
    });
  });
});
