import { describe, it, expect } from "vitest";
import type { ConfigLoader } from "../types.js";

describe("config types", () => {
  it("should allow importing ConfigLoader interface", () => {
    const mockLoader: ConfigLoader = {
      load: async (path: string) => {
        return {
          workspace: "./workspace",
          channels: {},
          agent: {
            defaultModel: "claude-sonnet-4-5",
            maxTurns: 20,
          },
          security: {},
          gateway: {
            enabled: false,
          },
        };
      },
    };

    expect(typeof mockLoader.load).toBe("function");
  });

  it("should allow ConfigLoader to be implemented", async () => {
    const loader: ConfigLoader = {
      load: async (path: string) => ({
        workspace: path,
        channels: {},
        agent: {
          defaultModel: "gpt-4o",
          maxTurns: 10,
        },
        security: {},
        gateway: {
          enabled: true,
          port: 3000,
        },
      }),
    };

    const config = await loader.load("/test/config.yaml");
    expect(config.workspace).toBe("/test/config.yaml");
  });
});
