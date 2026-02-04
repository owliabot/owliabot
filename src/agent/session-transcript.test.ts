import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionTranscriptStore } from "./session-transcript.js";
import type { Message } from "./session.js";

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), "owliabot-session-transcript-"));
}

describe("SessionTranscriptStore", () => {
  it("appends and reads messages", async () => {
    const dir = await makeTmpDir();
    const store = createSessionTranscriptStore({ sessionsDir: dir });

    const m1: Message = { role: "user", content: "hi", timestamp: 1 };
    const m2: Message = { role: "assistant", content: "hello", timestamp: 2 };

    await store.append("s1", m1);
    await store.append("s1", m2);

    const all = await store.readAll("s1");
    expect(all).toEqual([m1, m2]);
  });

  it("getHistory returns last N turns", async () => {
    const dir = await makeTmpDir();
    const store = createSessionTranscriptStore({ sessionsDir: dir });

    // 3 turns: (u,a) x 3
    const msgs: Message[] = [
      { role: "user", content: "u1", timestamp: 1 },
      { role: "assistant", content: "a1", timestamp: 2 },
      { role: "user", content: "u2", timestamp: 3 },
      { role: "assistant", content: "a2", timestamp: 4 },
      { role: "user", content: "u3", timestamp: 5 },
      { role: "assistant", content: "a3", timestamp: 6 },
    ];

    for (const m of msgs) await store.append("s1", m);

    const last2 = await store.getHistory("s1", 2);
    expect(last2).toEqual(msgs.slice(2));
  });

  it("clear truncates transcript", async () => {
    const dir = await makeTmpDir();
    const store = createSessionTranscriptStore({ sessionsDir: dir });

    await store.append("s1", { role: "user", content: "x", timestamp: 1 });
    await store.clear("s1");

    const all = await store.readAll("s1");
    expect(all).toEqual([]);
  });
});
