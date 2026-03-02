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

  it("drops orphaned toolResult messages after truncation", async () => {
    const dir = await makeTmpDir();
    const store = createSessionTranscriptStore({ sessionsDir: dir });

    // Simulate: turn1 = user + assistant(toolCalls), turn2 = user(toolResults) + assistant
    const msgs: Message[] = [
      { role: "user", content: "hello", timestamp: 1 },
      { role: "assistant", content: "", timestamp: 2, toolCalls: [{ id: "call_A", name: "foo", arguments: "{}" }] },
      { role: "user", content: "", timestamp: 3, toolResults: [{ toolCallId: "call_A", toolName: "foo", success: true, data: "ok" }] },
      { role: "assistant", content: "done", timestamp: 4 },
    ];
    for (const m of msgs) await store.append("s1", m);

    // maxTurns=1 keeps only turn2: [user(toolResults), assistant("done")]
    // The orphaned toolResult should be dropped
    const history = await store.getHistory("s1", 1);
    expect(history).toEqual([{ role: "assistant", content: "done", timestamp: 4 }]);
  });

  it("drops assistant with unanswered toolCalls at tail", async () => {
    const dir = await makeTmpDir();
    const store = createSessionTranscriptStore({ sessionsDir: dir });

    // assistant has toolCalls but the session was interrupted before toolResults
    const msgs: Message[] = [
      { role: "user", content: "do something", timestamp: 1 },
      { role: "assistant", content: "thinking...", timestamp: 2, toolCalls: [{ id: "call_X", name: "bar", arguments: "{}" }] },
    ];
    for (const m of msgs) await store.append("s1", m);

    const history = await store.getHistory("s1");
    // assistant toolCalls have no matching toolResults → drop toolCalls, keep text
    expect(history).toEqual([
      { role: "user", content: "do something", timestamp: 1 },
      { role: "assistant", content: "thinking...", timestamp: 2 },
    ]);
  });

  it("keeps valid toolCall+toolResult pairs in the middle", async () => {
    const dir = await makeTmpDir();
    const store = createSessionTranscriptStore({ sessionsDir: dir });

    const msgs: Message[] = [
      { role: "user", content: "hi", timestamp: 1 },
      { role: "assistant", content: "", timestamp: 2, toolCalls: [{ id: "call_B", name: "baz", arguments: "{}" }] },
      { role: "user", content: "", timestamp: 3, toolResults: [{ toolCallId: "call_B", toolName: "baz", success: true, data: "result" }] },
      { role: "assistant", content: "all done", timestamp: 4 },
    ];
    for (const m of msgs) await store.append("s1", m);

    const history = await store.getHistory("s1");
    expect(history).toEqual(msgs);
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
