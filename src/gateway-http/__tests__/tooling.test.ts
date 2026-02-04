import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGatewayToolRegistry } from "../tooling.js";

vi.mock("../../agent/tools/registry.js", async () => {
  const { ToolRegistry: ActualToolRegistry } = await vi.importActual<typeof import("../../agent/tools/registry.js")>(
    "../../agent/tools/registry.js"
  );
  return { ToolRegistry: ActualToolRegistry };
});

vi.mock("../../agent/tools/builtin/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../agent/tools/builtin/index.js")>(
    "../../agent/tools/builtin/index.js"
  );
  return actual;
});

vi.mock("../../skills/index.js", () => ({
  initializeSkills: vi.fn(async () => {}),
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("gateway-http tooling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createGatewayToolRegistry", () => {
    it("should create tool registry with builtin tools", async () => {
      const registry = await createGatewayToolRegistry("/test/workspace");

      expect(registry).toBeDefined();
      expect(registry.get("echo")).toBeDefined();
      expect(registry.get("help")).toBeDefined();
      expect(registry.get("clear_session")).toBeDefined();
      expect(registry.get("memory_search")).toBeDefined();
      expect(registry.get("memory_get")).toBeDefined();
      expect(registry.get("list_files")).toBeDefined();
      expect(registry.get("edit_file")).toBeDefined();
    });

    it("should return all builtin tools", async () => {
      const registry = await createGatewayToolRegistry("/test/workspace");

      const allTools = registry.getAll();
      expect(allTools.length).toBeGreaterThanOrEqual(7);
    });

    it("should support different workspace paths", async () => {
      const registry1 = await createGatewayToolRegistry("/workspace1");
      const registry2 = await createGatewayToolRegistry("/workspace2");

      expect(registry1).toBeDefined();
      expect(registry2).toBeDefined();
    });

    it("should initialize skills from workspace", async () => {
      const { initializeSkills } = await import("../../skills/index.js");

      await createGatewayToolRegistry("/test/workspace");

      expect(initializeSkills).toHaveBeenCalledWith(
        expect.stringContaining("skills"),
        expect.anything()
      );
    });
  });
});
