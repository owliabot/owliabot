import { describe, it, expect } from "vitest";
import {
  scanForSecrets,
  formatBlockReason,
  getSecretPatternDescriptions,
} from "../security/secret-scanner.js";

describe("system/security/secret-scanner", () => {
  describe("high confidence patterns", () => {
    it("detects PEM private keys", () => {
      const body = `-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----`;
      const r = scanForSecrets(body);
      expect(r.hasHighConfidence).toBe(true);
      expect(r.findings.some((f) => f.type === "private_key_pem")).toBe(true);
    });

    it("detects OpenAI-style keys", () => {
      const body = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
      const r = scanForSecrets(body);
      expect(r.hasHighConfidence).toBe(true);
      expect(r.findings.some((f) => f.type === "openai_api_key")).toBe(true);
    });

    it("detects Anthropic API keys", () => {
      const body = "sk-ant-abcdefghijklmnopqrstuvwxyz";
      const r = scanForSecrets(body);
      expect(r.hasHighConfidence).toBe(true);
      expect(r.findings.some((f) => f.type === "anthropic_api_key")).toBe(true);
    });

    it("detects GitHub tokens", () => {
      const body = "ghp_abcdefghijklmnopqrstuvwxyz1234";
      const r = scanForSecrets(body);
      expect(r.hasHighConfidence).toBe(true);
      expect(r.findings.some((f) => f.type === "github_token")).toBe(true);
    });

    it("detects Stripe keys", () => {
      // Build pattern dynamically to avoid GitHub push protection
      const prefix = "sk_" + "test_";
      const suffix = "0".repeat(24);
      const body = prefix + suffix;
      const r = scanForSecrets(body);
      expect(r.hasHighConfidence).toBe(true);
      expect(r.findings.some((f) => f.type === "stripe_key")).toBe(true);
    });

    it("detects Slack tokens", () => {
      // Build pattern dynamically to avoid GitHub push protection
      const body = ["xoxb", "0".repeat(13), "0".repeat(24)].join("-");
      const r = scanForSecrets(body);
      expect(r.hasHighConfidence).toBe(true);
      expect(r.findings.some((f) => f.type === "slack_token")).toBe(true);
    });
  });

  describe("false positive avoidance", () => {
    it("does NOT flag JSON with 'token' as a key name", () => {
      const body = JSON.stringify({ token: "some_short_value", user: "test" });
      const r = scanForSecrets(body);
      expect(r.hasHighConfidence).toBe(false);
      // Should not match generic_secret_assignment because JSON uses : not =
      expect(r.findings.filter((f) => f.type === "generic_secret_assignment")).toHaveLength(0);
    });

    it("does NOT flag JSON with 'api_key' as a key name", () => {
      const body = JSON.stringify({ api_key: "short", secret: "also_short" });
      const r = scanForSecrets(body);
      expect(r.hasHighConfidence).toBe(false);
    });

    it("does NOT flag plain text containing 'token' or 'secret' words", () => {
      const body = "The token was invalid. Please check your secret settings.";
      const r = scanForSecrets(body);
      expect(r.hasHighConfidence).toBe(false);
      expect(r.findings).toHaveLength(0);
    });

    it("does NOT flag short values even with sensitive key names", () => {
      // Values under 20 chars should not trigger generic_secret_assignment
      const body = 'api_key = "abc123"';
      const r = scanForSecrets(body);
      expect(r.findings.filter((f) => f.type === "generic_secret_assignment")).toHaveLength(0);
    });
  });

  describe("benign content", () => {
    it("returns no findings on plain text", () => {
      const r = scanForSecrets("hello world");
      expect(r.findings.length).toBe(0);
      expect(r.hasHighConfidence).toBe(false);
    });

    it("returns no findings on typical JSON payloads", () => {
      const body = JSON.stringify({
        name: "John Doe",
        email: "john@example.com",
        preferences: { theme: "dark", notifications: true },
      });
      const r = scanForSecrets(body);
      expect(r.findings).toHaveLength(0);
      expect(r.hasHighConfidence).toBe(false);
    });
  });

  describe("formatBlockReason", () => {
    it("returns structured reason without leaking secrets", () => {
      const body = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
      const scan = scanForSecrets(body);
      const reason = formatBlockReason(scan);

      expect(reason.blocked).toBe(true);
      expect(reason.types).toContain("openai_api_key");
      expect(reason.summary).toContain("high-severity");
      // Should NOT contain the actual secret
      expect(reason.summary).not.toContain("sk-abcdef");
    });

    it("summarizes no findings correctly", () => {
      const scan = scanForSecrets("hello");
      const reason = formatBlockReason(scan);

      expect(reason.blocked).toBe(false);
      expect(reason.findingCount).toBe(0);
      expect(reason.summary).toBe("No secrets detected");
    });
  });

  describe("getSecretPatternDescriptions", () => {
    it("returns descriptions for all patterns", () => {
      const descriptions = getSecretPatternDescriptions();
      expect(descriptions.length).toBeGreaterThan(0);
      expect(descriptions.every((d) => d.type && d.severity && d.description)).toBe(true);
    });
  });
});
