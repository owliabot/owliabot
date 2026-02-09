import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";
import { testConfig, createMockResources } from "./test-helpers.js";

describe("health", () => {
  it("returns ok from /health", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });
    const res = await fetch(server.baseUrl + "/health");
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.version).toBe("0.2.0");
    await server.stop();
  });
});
