import { describe, it, expect } from "vitest";
import {
  validateAnthropicSetupToken,
  isSetupToken,
  isStandardApiKey,
  ANTHROPIC_SETUP_TOKEN_PREFIX,
  ANTHROPIC_SETUP_TOKEN_MIN_LENGTH,
} from "../setup-token.js";

describe("setup-token", () => {
  describe("validateAnthropicSetupToken", () => {
    it("should return error for empty input", () => {
      expect(validateAnthropicSetupToken("")).toBe("Required");
      expect(validateAnthropicSetupToken("   ")).toBe("Required");
    });

    it("should return error for wrong prefix", () => {
      const error = validateAnthropicSetupToken("sk-ant-api03-abcdef");
      expect(error).toContain(ANTHROPIC_SETUP_TOKEN_PREFIX);
    });

    it("should return error for too short token", () => {
      const shortToken = ANTHROPIC_SETUP_TOKEN_PREFIX + "short";
      const error = validateAnthropicSetupToken(shortToken);
      expect(error).toContain("too short");
    });

    it("should accept valid setup-token", () => {
      // Create a valid token (prefix + enough chars to reach 80)
      const validToken = ANTHROPIC_SETUP_TOKEN_PREFIX + "a".repeat(ANTHROPIC_SETUP_TOKEN_MIN_LENGTH - ANTHROPIC_SETUP_TOKEN_PREFIX.length);
      expect(validToken.length).toBeGreaterThanOrEqual(ANTHROPIC_SETUP_TOKEN_MIN_LENGTH);
      
      const error = validateAnthropicSetupToken(validToken);
      expect(error).toBeUndefined();
    });

    it("should trim whitespace before validation", () => {
      const validToken = ANTHROPIC_SETUP_TOKEN_PREFIX + "a".repeat(ANTHROPIC_SETUP_TOKEN_MIN_LENGTH - ANTHROPIC_SETUP_TOKEN_PREFIX.length);
      const tokenWithWhitespace = `  ${validToken}  `;
      
      const error = validateAnthropicSetupToken(tokenWithWhitespace);
      expect(error).toBeUndefined();
    });
  });

  describe("isSetupToken", () => {
    it("should return true for setup-token prefix", () => {
      expect(isSetupToken("sk-ant-oat01-abcdefg")).toBe(true);
    });

    it("should return false for standard API key", () => {
      expect(isSetupToken("sk-ant-api03-abcdefg")).toBe(false);
    });

    it("should return false for other strings", () => {
      expect(isSetupToken("random-string")).toBe(false);
      expect(isSetupToken("")).toBe(false);
    });
  });

  describe("isStandardApiKey", () => {
    it("should return true for standard API key prefix", () => {
      expect(isStandardApiKey("sk-ant-api03-abcdefg")).toBe(true);
    });

    it("should return false for setup-token", () => {
      expect(isStandardApiKey("sk-ant-oat01-abcdefg")).toBe(false);
    });

    it("should return false for non-Anthropic keys", () => {
      expect(isStandardApiKey("sk-openai-abcdefg")).toBe(false);
      expect(isStandardApiKey("random-string")).toBe(false);
    });
  });

  describe("constants", () => {
    it("should have correct prefix", () => {
      expect(ANTHROPIC_SETUP_TOKEN_PREFIX).toBe("sk-ant-oat01-");
    });

    it("should have minimum length of 80", () => {
      expect(ANTHROPIC_SETUP_TOKEN_MIN_LENGTH).toBe(80);
    });
  });
});
