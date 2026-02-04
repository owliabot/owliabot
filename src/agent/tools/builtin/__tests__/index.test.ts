import { describe, it, expect } from "vitest";
import {
  echoTool,
  createHelpTool,
  createClearSessionTool,
  createMemorySearchTool,
  createMemoryGetTool,
  createListFilesTool,
  createEditFileTool,
} from "../index.js";

describe("builtin tools index", () => {
  it("should export echoTool", () => {
    expect(echoTool).toBeDefined();
    expect(echoTool.name).toBe("echo");
  });

  it("should export createHelpTool", () => {
    expect(createHelpTool).toBeDefined();
    expect(typeof createHelpTool).toBe("function");
  });

  it("should export createClearSessionTool", () => {
    expect(createClearSessionTool).toBeDefined();
    expect(typeof createClearSessionTool).toBe("function");
  });

  it("should export createMemorySearchTool", () => {
    expect(createMemorySearchTool).toBeDefined();
    expect(typeof createMemorySearchTool).toBe("function");
  });

  it("should export createMemoryGetTool", () => {
    expect(createMemoryGetTool).toBeDefined();
    expect(typeof createMemoryGetTool).toBe("function");
  });

  it("should export createListFilesTool", () => {
    expect(createListFilesTool).toBeDefined();
    expect(typeof createListFilesTool).toBe("function");
  });

  it("should export createEditFileTool", () => {
    expect(createEditFileTool).toBeDefined();
    expect(typeof createEditFileTool).toBe("function");
  });
});
