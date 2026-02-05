// src/infra/__tests__/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createInfraStore, hashMessage, type InfraStore } from "../store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("InfraStore", () => {
  let store: InfraStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "infra-test-"));
    store = createInfraStore({
      sqlitePath: join(tempDir, "test.db"),
    });
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Rate Limiting", () => {
    it("allows requests within limit", () => {
      const bucket = "user:test";
      const windowMs = 60_000;
      const max = 5;
      const now = Date.now();

      // First request should be allowed
      const result1 = store.checkRateLimit(bucket, windowMs, max, now);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(4);

      // Next few requests should be allowed
      for (let i = 0; i < 4; i++) {
        const result = store.checkRateLimit(bucket, windowMs, max, now);
        expect(result.allowed).toBe(true);
      }
    });

    it("blocks requests exceeding limit", () => {
      const bucket = "user:test";
      const windowMs = 60_000;
      const max = 3;
      const now = Date.now();

      // Use up all allowed requests
      for (let i = 0; i < 3; i++) {
        store.checkRateLimit(bucket, windowMs, max, now);
      }

      // Next request should be blocked
      const result = store.checkRateLimit(bucket, windowMs, max, now);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("resets after window expires", () => {
      const bucket = "user:test";
      const windowMs = 1000; // 1 second
      const max = 2;
      const now = Date.now();

      // Use up all requests
      store.checkRateLimit(bucket, windowMs, max, now);
      store.checkRateLimit(bucket, windowMs, max, now);

      // Should be blocked
      const blocked = store.checkRateLimit(bucket, windowMs, max, now);
      expect(blocked.allowed).toBe(false);

      // After window expires, should be allowed again
      const future = now + windowMs + 1;
      const allowed = store.checkRateLimit(bucket, windowMs, max, future);
      expect(allowed.allowed).toBe(true);
      expect(allowed.remaining).toBe(1);
    });
  });

  describe("Idempotency", () => {
    it("saves and retrieves idempotency records", () => {
      const key = "msg:telegram:12345";
      const hash = "abc123";
      const response = { ok: true, data: "test" };
      const expiresAt = Date.now() + 60_000;

      store.saveIdempotency(key, hash, response, expiresAt);

      const cached = store.getIdempotency(key);
      expect(cached).not.toBeNull();
      expect(cached?.key).toBe(key);
      expect(cached?.requestHash).toBe(hash);
      expect(JSON.parse(cached?.responseJson ?? "{}")).toEqual(response);
    });

    it("returns null for non-existent key", () => {
      const cached = store.getIdempotency("nonexistent");
      expect(cached).toBeNull();
    });

    it("cleans up expired records", () => {
      const key = "msg:telegram:expired";
      const hash = "def456";
      const response = { ok: true };
      const now = Date.now();

      // Save with past expiration
      store.saveIdempotency(key, hash, response, now - 1000);

      // Should still exist before cleanup
      expect(store.getIdempotency(key)).not.toBeNull();

      // After cleanup, should be gone
      store.cleanup(now);
      expect(store.getIdempotency(key)).toBeNull();
    });
  });

  describe("Event Store", () => {
    it("inserts and retrieves events", () => {
      const now = Date.now();

      store.insertEvent({
        type: "message.processed",
        time: now,
        status: "success",
        source: "telegram:user123",
        message: "Test message",
        metadataJson: JSON.stringify({ test: true }),
        expiresAt: now + 86400_000,
      });

      const events = store.getRecentEvents(10);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("message.processed");
      expect(events[0].status).toBe("success");
    });

    it("polls events with cursor", () => {
      const now = Date.now();

      // Insert multiple events
      for (let i = 0; i < 5; i++) {
        store.insertEvent({
          type: "test.event",
          time: now + i,
          status: "success",
          source: `source${i}`,
          message: `Event ${i}`,
          metadataJson: null,
          expiresAt: now + 86400_000,
        });
      }

      // Poll without cursor (gets recent 3, in DESC order then reversed)
      const { cursor, events } = store.pollEvents(null, 3, now);
      expect(events).toHaveLength(3);
      // Cursor should be the last (highest) id in the batch
      expect(cursor).toBeGreaterThan(0);

      // Poll all events to verify total count
      const { events: allEvents } = store.pollEvents(null, 10, now);
      expect(allEvents).toHaveLength(5);
    });
  });

  describe("Stats", () => {
    it("returns correct statistics", () => {
      const now = Date.now();

      // Add some data
      store.saveIdempotency("key1", "hash1", {}, now + 60_000);
      store.saveIdempotency("key2", "hash2", {}, now + 60_000);
      store.insertEvent({
        type: "test",
        time: now,
        status: "success",
        source: "test",
        message: "test",
        metadataJson: null,
        expiresAt: now + 86400_000,
      });
      store.checkRateLimit("bucket1", 60_000, 10, now);
      store.checkRateLimit("bucket2", 60_000, 10, now);

      const stats = store.getStats();
      expect(stats.idempotencyCount).toBe(2);
      expect(stats.eventCount).toBe(1);
      expect(stats.rateLimitBuckets).toBe(2);
      expect(stats.uptime).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("hashMessage", () => {
  it("produces consistent hashes", () => {
    const hash1 = hashMessage("telegram", "123", "hello");
    const hash2 = hashMessage("telegram", "123", "hello");
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different inputs", () => {
    const hash1 = hashMessage("telegram", "123", "hello");
    const hash2 = hashMessage("telegram", "123", "world");
    const hash3 = hashMessage("discord", "123", "hello");
    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });
});
