import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGatewayToolRegistry } from "../tooling.js";

vi.mock("../../../agent/tools/registry.js", async () => {
  const { ToolRegistry: ActualToolRegistry } = await vi.importActual<typeof import("../../../agent/tools/registry.js")>(
    "../../../agent/tools/registry.js"
  );
  return { ToolRegistry: ActualToolRegistry };
});

vi.mock("../../../agent/tools/builtin/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../../agent/tools/builtin/index.js")>(
    "../../../agent/tools/builtin/index.js"
  );
  return actual;
});

// Note: Markdown-based skills don't register tools with the registry.
// Skills initialization now happens at the gateway level for system prompt injection.

vi.mock("../../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("gateway http tooling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createGatewayToolRegistry", () => {
    it("should create tool registry with builtin tools (legacy string API)", async () => {
      const registry = await createGatewayToolRegistry("/test/workspace");

      expect(registry).toBeDefined();
      expect(registry.get("echo")).toBeDefined();
      expect(registry.get("help")).toBeDefined();
      expect(registry.get("clear_session")).toBeDefined();
      expect(registry.get("memory_search")).toBeDefined();
      expect(registry.get("memory_get")).toBeDefined();
      expect(registry.get("list_files")).toBeDefined();
      // By default (no allowWrite), edit_file should NOT be available
      expect(registry.get("edit_file")).toBeUndefined();
    });

    it("should NOT include edit_file when allowWrite is false (default)", async () => {
      const registry = await createGatewayToolRegistry({
        workspace: "/test/workspace",
      });

      expect(registry.get("edit_file")).toBeUndefined();
    });

    it("should NOT include edit_file when allowWrite is explicitly false", async () => {
      const registry = await createGatewayToolRegistry({
        workspace: "/test/workspace",
        tools: { allowWrite: false },
      });

      expect(registry.get("edit_file")).toBeUndefined();
    });

    it("should include edit_file when allowWrite is true", async () => {
      const registry = await createGatewayToolRegistry({
        workspace: "/test/workspace",
        tools: { allowWrite: true },
      });

      expect(registry.get("edit_file")).toBeDefined();
    });

    it("should respect policy allowList", async () => {
      const registry = await createGatewayToolRegistry({
        workspace: "/test/workspace",
        tools: {
          allowWrite: true,
          policy: { allowList: ["echo", "help"] },
        },
      });

      expect(registry.get("echo")).toBeDefined();
      expect(registry.get("help")).toBeDefined();
      expect(registry.get("memory_search")).toBeUndefined();
      expect(registry.get("edit_file")).toBeUndefined();
    });

    it("should respect policy denyList", async () => {
      const registry = await createGatewayToolRegistry({
        workspace: "/test/workspace",
        tools: {
          allowWrite: true,
          policy: { denyList: ["edit_file", "clear_session"] },
        },
      });

      expect(registry.get("echo")).toBeDefined();
      expect(registry.get("memory_search")).toBeDefined();
      expect(registry.get("edit_file")).toBeUndefined();
      expect(registry.get("clear_session")).toBeUndefined();
    });

    it("should return all builtin tools when allowWrite is true and no policy", async () => {
      const registry = await createGatewayToolRegistry({
        workspace: "/test/workspace",
        tools: { allowWrite: true },
      });

      const allTools = registry.getAll();
      // Should have: echo, help, clear_session, memory_search, memory_get, list_files, edit_file
      expect(allTools.length).toBeGreaterThanOrEqual(7);
      expect(registry.get("edit_file")).toBeDefined();
    });

    it("should support different workspace paths", async () => {
      const registry1 = await createGatewayToolRegistry({ workspace: "/workspace1" });
      const registry2 = await createGatewayToolRegistry({ workspace: "/workspace2" });

      expect(registry1).toBeDefined();
      expect(registry2).toBeDefined();
    });

    // Note: "should initialize skills from workspace" test removed
    // Markdown-based skills are now injected into system prompts, not tool registries
  });
});
