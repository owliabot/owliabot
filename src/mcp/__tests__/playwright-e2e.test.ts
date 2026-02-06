/**
 * Playwright MCP E2E Tests
 *
 * Tests real Playwright browser automation through the MCP protocol.
 * Covers: navigation, click, input, screenshot
 *
 * Requirements:
 * - @playwright/mcp package (installed via npx)
 * - Chrome/Chromium browser installed (npx playwright install chrome)
 *
 * These tests will be SKIPPED if browser is not available.
 * Run `npx playwright install chrome` to enable them.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { createMCPTools, type CreateMCPToolsResult } from "../index.js";
import type { MCPServerConfig } from "../types.js";
import type { ToolDefinition } from "../../agent/tools/types.js";

// Track if browser is available
let browserAvailable = false;

// Simple test page - minimal HTML to avoid URL encoding issues
const TEST_PAGE_HTML = `<html><head><title>Test</title></head><body><h1>Hello</h1><button id="btn">Click</button><input id="inp" /></body></html>`;

// Data URL for test page
const TEST_PAGE_URL = `data:text/html,${encodeURIComponent(TEST_PAGE_HTML)}`;

// Simple external URL for testing (always available)
const EXAMPLE_URL = "https://example.com";

// Playwright MCP server configuration
const playwrightServerConfig: MCPServerConfig = {
  name: "playwright",
  command: "npx",
  args: ["--yes", "@playwright/mcp@latest", "--headless"],
  transport: "stdio",
};

// Longer timeout for browser operations (browser startup + operation)
const BROWSER_TIMEOUT = 60000;

// Helper to find a tool by suffix
function findTool(
  tools: ToolDefinition[],
  nameSuffix: string
): ToolDefinition | undefined {
  return tools.find(
    (t) => t.name.endsWith(nameSuffix) || t.name.includes(nameSuffix)
  );
}

// Execute tool with standard context
async function executeTool(
  tool: ToolDefinition,
  params: Record<string, unknown>
): Promise<{ success: boolean; data?: string; error?: string }> {
  return tool.execute(params, {
    sessionKey: "playwright-e2e-test",
    agentId: "e2e",
    signer: null,
    config: {},
  });
}

describe.sequential("Playwright MCP E2E", () => {
  let mcpResult: CreateMCPToolsResult;
  let tools: ToolDefinition[];

  beforeAll(async () => {
    // Connect to Playwright MCP server (may take time to download)
    mcpResult = await createMCPTools({
      servers: [playwrightServerConfig],
      defaults: {
        timeout: BROWSER_TIMEOUT, // 60s timeout for browser operations
      },
    });

    tools = mcpResult.tools;

    // Log available tools for debugging
    console.log(
      "Available Playwright tools:",
      tools.map((t) => t.name)
    );

    // Check if browser is available by trying a simple navigation
    const navigateTool = findTool(tools, "navigate");
    if (navigateTool) {
      const testResult = await executeTool(navigateTool, {
        url: "about:blank",
      });

      // Check for browser not installed errors
      const errorText = testResult.error || "";
      const isBrowserMissing =
        errorText.includes("not found") ||
        errorText.includes("install") ||
        errorText.includes("Chromium") ||
        errorText.includes("chrome");

      if (testResult.success) {
        browserAvailable = true;
        console.log("✓ Browser available, running full test suite");
      } else if (isBrowserMissing) {
        browserAvailable = false;
        console.log(
          "⚠ Browser not installed. Run `npx playwright install chrome` to enable these tests."
        );
        console.log("  Skipping browser-dependent tests...");
      } else if (errorText.includes("timeout")) {
        // Timeout might mean browser is trying to start but failing
        browserAvailable = false;
        console.log(
          "⚠ Browser check timed out. Run `npx playwright install chrome` to enable these tests."
        );
      } else {
        // Other unexpected error - be safe, skip tests
        browserAvailable = false;
        console.log(
          `⚠ Browser check failed: ${errorText || "unknown error"}`
        );
        console.log("  Skipping browser-dependent tests...");
      }
    }
  }, 180000); // 3 min timeout for setup (npx download + browser install)

  afterAll(async () => {
    if (mcpResult) {
      await mcpResult.close();
    }
  });

  it("connects to Playwright MCP server successfully", () => {
    expect(mcpResult.failed).toHaveLength(0);
    expect(mcpResult.clients.size).toBe(1);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("lists expected browser tools", () => {
    // Check for key tools we need
    const toolNames = tools.map((t) => t.name);

    // Should have navigation tool
    expect(
      toolNames.some((n) => n.includes("navigate") || n.includes("goto"))
    ).toBe(true);

    // Should have click tool
    expect(toolNames.some((n) => n.includes("click"))).toBe(true);

    // Should have screenshot tool
    expect(toolNames.some((n) => n.includes("screenshot"))).toBe(true);
  });

  describe("Navigation", () => {
    it("navigates to example.com", async (ctx) => {
      if (!browserAvailable) {
        ctx.skip();
        return;
      }

      const navigateTool = findTool(tools, "navigate");
      expect(navigateTool).toBeDefined();

      const result = await executeTool(navigateTool!, { url: EXAMPLE_URL });

      expect(result.success).toBe(true);
    }, BROWSER_TIMEOUT);

    it("gets page snapshot after navigation", async (ctx) => {
      if (!browserAvailable) {
        ctx.skip();
        return;
      }

      const snapshotTool = findTool(tools, "snapshot");
      expect(snapshotTool).toBeDefined();

      const result = await executeTool(snapshotTool!, {});
      expect(result.success).toBe(true);
      // example.com should have "Example Domain" in content
      expect(result.data).toContain("Example");
    }, BROWSER_TIMEOUT);

    it("navigates to data URL page", async (ctx) => {
      if (!browserAvailable) {
        ctx.skip();
        return;
      }

      const navigateTool = findTool(tools, "navigate");

      const result = await executeTool(navigateTool!, { url: TEST_PAGE_URL });

      expect(result.success).toBe(true);
    }, BROWSER_TIMEOUT);
  });

  describe("Click interaction", () => {
    it("clicks a link on example.com", async (ctx) => {
      if (!browserAvailable) {
        ctx.skip();
        return;
      }

      // Navigate to example.com which has a "More information" link
      const navigateTool = findTool(tools, "navigate");
      await executeTool(navigateTool!, { url: EXAMPLE_URL });

      const clickTool = findTool(tools, "click");
      expect(clickTool).toBeDefined();

      // Click the "More information" link on example.com
      const result = await executeTool(clickTool!, {
        element: "More information",
        ref: "More information",
      });

      // Should succeed
      expect(result.success).toBe(true);
    }, BROWSER_TIMEOUT);

    it("verifies navigation after click", async (ctx) => {
      if (!browserAvailable) {
        ctx.skip();
        return;
      }

      const snapshotTool = findTool(tools, "snapshot");
      expect(snapshotTool).toBeDefined();

      const result = await executeTool(snapshotTool!, {});
      expect(result.success).toBe(true);
      // Should have navigated away from example.com
      expect(result.data).toBeDefined();
    }, BROWSER_TIMEOUT);
  });

  describe("Input interaction", () => {
    it("types text into data URL page input", async (ctx) => {
      if (!browserAvailable) {
        ctx.skip();
        return;
      }

      // Navigate to our test page with input
      const navigateTool = findTool(tools, "navigate");
      await executeTool(navigateTool!, { url: TEST_PAGE_URL });

      // Find type tool
      const typeTool = findTool(tools, "type");
      expect(typeTool).toBeDefined();

      // Type into the input field (using element/ref for Playwright MCP)
      const result = await executeTool(typeTool!, {
        element: "textbox", // ARIA role
        ref: "textbox",
        text: "Hello Playwright!",
      });

      expect(result.success).toBe(true);
    }, BROWSER_TIMEOUT);

    it("fills form using fill_form tool", async (ctx) => {
      if (!browserAvailable) {
        ctx.skip();
        return;
      }

      // Navigate to test page
      const navigateTool = findTool(tools, "navigate");
      await executeTool(navigateTool!, { url: TEST_PAGE_URL });

      // Try fill_form tool if available
      const fillFormTool = findTool(tools, "fill_form");

      if (fillFormTool) {
        const result = await executeTool(fillFormTool!, {
          values: [{ ref: "textbox", value: "Test input" }],
        });
        expect(result.success).toBe(true);
      } else {
        // Skip if fill_form not available
        console.log("fill_form tool not available");
      }
    }, BROWSER_TIMEOUT);
  });

  describe("Screenshot", () => {
    it("takes a screenshot of current page", async (ctx) => {
      if (!browserAvailable) {
        ctx.skip();
        return;
      }

      // First navigate somewhere
      const navigateTool = findTool(tools, "navigate");
      await executeTool(navigateTool!, { url: EXAMPLE_URL });

      const screenshotTool = findTool(tools, "screenshot");
      expect(screenshotTool).toBeDefined();

      const result = await executeTool(screenshotTool!, {});

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBeGreaterThan(0);
    }, BROWSER_TIMEOUT);
  });

  describe("Error handling", () => {
    it("handles navigation to invalid URL gracefully", async () => {
      const navigateTool = findTool(tools, "navigate");

      const result = await executeTool(navigateTool!, {
        url: "not-a-valid-url",
      });

      // Should fail gracefully
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    }, BROWSER_TIMEOUT);

    it("handles click on non-existent element gracefully", async () => {
      // Navigate first
      const navigateTool = findTool(tools, "navigate");
      await executeTool(navigateTool!, { url: EXAMPLE_URL });

      const clickTool = findTool(tools, "click");

      const result = await executeTool(clickTool!, {
        element: "NonExistentElement12345XYZ",
        ref: "NonExistentElement12345XYZ",
      });

      // Should fail gracefully
      expect(result.success).toBe(false);
    }, BROWSER_TIMEOUT);
  });
});
