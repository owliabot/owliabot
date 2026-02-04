import { describe, it, expect } from "vitest";
import { echoTool } from "../echo.js";

describe("echo tool", () => {
  it("should echo back the provided message", async () => {
    const result = await echoTool.execute(
      { message: "Hello, World!" },
      {} as any
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ echoed: "Hello, World!" });
  });

  it("should have correct metadata", () => {
    expect(echoTool.name).toBe("echo");
    expect(echoTool.description).toContain("Echo back");
    expect(echoTool.security.level).toBe("read");
    expect(echoTool.parameters.required).toContain("message");
  });

  it("should echo empty strings", async () => {
    const result = await echoTool.execute({ message: "" }, {} as any);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ echoed: "" });
  });

  it("should echo multiline messages", async () => {
    const message = "Line 1\nLine 2\nLine 3";
    const result = await echoTool.execute({ message }, {} as any);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ echoed: message });
  });
});
