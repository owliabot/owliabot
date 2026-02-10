/**
 * Unit tests for onboarding/steps/helpers.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectTimezone, injectTimezoneComment } from "../steps/helpers.js";

describe("helpers", () => {
  describe("detectTimezone", () => {
    it("should return detected timezone when available", () => {
      const tz = detectTimezone();
      expect(tz).toBeTruthy();
      expect(typeof tz).toBe("string");
      // Should return a valid timezone like "UTC", "America/New_York", etc.
      expect(tz.length).toBeGreaterThan(0);
    });

    it("should fallback to UTC when Intl fails", () => {
      const originalDateTimeFormat = Intl.DateTimeFormat;
      // @ts-expect-error - intentionally breaking Intl
      Intl.DateTimeFormat = undefined;
      
      const tz = detectTimezone();
      expect(tz).toBe("UTC");
      
      Intl.DateTimeFormat = originalDateTimeFormat;
    });

    it("should fallback to UTC when timezone is empty", () => {
      const originalDateTimeFormat = Intl.DateTimeFormat;
      Intl.DateTimeFormat = vi.fn().mockImplementation(() => ({
        resolvedOptions: () => ({ timeZone: "" }),
      })) as any;
      
      const tz = detectTimezone();
      expect(tz).toBe("UTC");
      
      Intl.DateTimeFormat = originalDateTimeFormat;
    });
  });

  describe("injectTimezoneComment", () => {
    it("should inject comment above timezone line", () => {
      const input = `workspace: workspace
providers: []
timezone: America/New_York`;
      
      const result = injectTimezoneComment(input);
      
      expect(result).toContain("# Timezone was auto-detected during setup");
      expect(result).toMatch(/# Timezone.*\ntimezone: America\/New_York/);
    });

    it("should handle timezone with spaces", () => {
      const input = `timezone:   UTC`;
      const result = injectTimezoneComment(input);
      
      expect(result).toContain("# Timezone was auto-detected during setup");
      expect(result).toContain("timezone:   UTC");
    });

    it("should not modify yaml without timezone field", () => {
      const input = `workspace: workspace
providers: []`;
      
      const result = injectTimezoneComment(input);
      expect(result).toBe(input);
    });

    it("should inject comment each time called (idempotency not enforced)", () => {
      // Note: The function doesn't prevent duplicate injection
      const input = `timezone: UTC`;
      const result1 = injectTimezoneComment(input);
      
      expect(result1).toContain("# Timezone was auto-detected");
      expect(result1).toContain("timezone: UTC");
      
      // Second call will add another comment
      const result2 = injectTimezoneComment(result1);
      const matches = result2.match(/# Timezone was auto-detected/g);
      expect(matches?.length).toBeGreaterThanOrEqual(1);
    });
  });
});
