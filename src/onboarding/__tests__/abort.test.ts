/**
 * Tests for AbortError handling during onboarding.
 */

import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { AbortError, ask } from "../shared.js";

function createMockRl() {
  const emitter = new EventEmitter();
  const rl = Object.assign(emitter, {
    question: vi.fn(),
    close: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  });
  return rl;
}

describe("AbortError", () => {
  it("is an instance of Error", () => {
    const err = new AbortError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AbortError");
  });
});

describe("ask() abort handling", () => {
  it("rejects with AbortError when readline closes mid-question (non-secret)", async () => {
    const rl = createMockRl();

    // Don't answer the question — just close the readline
    const promise = ask(rl as any, "Test? ");
    rl.emit("close");

    await expect(promise).rejects.toThrow(AbortError);
  });

  it("resolves normally and cleans up close listener", async () => {
    const rl = createMockRl();

    rl.question.mockImplementation((_q: string, cb: (ans: string) => void) => {
      cb("hello");
    });

    const result = await ask(rl as any, "Test? ");
    expect(result).toBe("hello");
    // close listener should have been removed
    expect(rl.listenerCount("close")).toBe(0);
  });
});
