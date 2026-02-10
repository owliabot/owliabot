import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PolicyLoader } from "../loader.js";

describe("PolicyLoader", () => {
  it("bootstraps missing workspace/policy.yml from templates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "owliabot-policy-"));
    const workspaceDir = join(dir, "workspace");
    const policyPath = join(workspaceDir, "policy.yml");

    try {
      const loader = new PolicyLoader(policyPath);
      const policy = await loader.load();

      expect(policy.version).toBe("1");
      // Sanity: template contains tools section.
      expect(Object.keys(policy.tools).length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

