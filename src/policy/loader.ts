/**
 * Policy loader - loads and validates policy.yml
 * @see docs/design/tier-policy.md Section 3.1
 */

import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { policySchema, type PolicyConfig } from "./schema.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("policy-loader");

export class PolicyLoader {
  private cachedPolicy: PolicyConfig | null = null;
  private policyPath: string;

  constructor(policyPath: string = "workspace/policy.yml") {
    this.policyPath = policyPath;
  }

  async load(force = false): Promise<PolicyConfig> {
    if (this.cachedPolicy && !force) {
      return this.cachedPolicy;
    }

    try {
      log.info(`Loading policy from ${this.policyPath}`);
      const content = await readFile(this.policyPath, "utf-8");
      const rawPolicy = YAML.parse(content);

      const result = policySchema.safeParse(rawPolicy);
      if (!result.success) {
        log.error("Policy validation failed", result.error.errors);
        throw new Error(
          `Invalid policy.yml: ${result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`
        );
      }

      this.cachedPolicy = result.data;
      log.info("Policy loaded successfully", {
        toolCount: Object.keys(result.data.tools).length,
        wildcardCount: result.data.wildcards?.length ?? 0,
      });

      return this.cachedPolicy;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        log.warn(`Policy file not found: ${this.policyPath}, using defaults`);
        const defaultPolicy: PolicyConfig = {
          version: "1",
          defaults: {},
          tools: {},
          fallback: { tier: "none", requireConfirmation: false },
        };
        this.cachedPolicy = defaultPolicy;
        return this.cachedPolicy;
      }
      throw err;
    }
  }

  async reload(): Promise<PolicyConfig> {
    return this.load(true);
  }

  clearCache(): void {
    this.cachedPolicy = null;
  }
}
