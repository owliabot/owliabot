import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSessionStore } from "../../session-store.js";
import { createSessionTranscriptStore } from "../../session-transcript.js";
import { createClearSessionTool } from "./clear-session.js";

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), "owliabot-clear-session-"));
}

describe("clear_session tool", () => {
  it("rotates sessionId and clears transcripts", async () => {
    const dir = await makeTmpDir();
    const sessionStore = createSessionStore({ sessionsDir: dir });
    const transcripts = createSessionTranscriptStore({ sessionsDir: dir });

    const tool = createClearSessionTool({ sessionStore, transcripts });

    const sessionKey = "agent:main:discord:conv:main:main";
    const entry1 = await sessionStore.getOrCreate(sessionKey);

    await transcripts.append(entry1.sessionId, {
      role: "user",
      content: "hi",
      timestamp: 1,
    });

    const result = await tool.execute({}, {
      sessionKey,
      agentId: "main",
      signer: null,
      config: {},
    });

    expect(result.success).toBe(true);

    const entry2 = await sessionStore.get(sessionKey);
    expect(entry2?.sessionId).toBeTruthy();
    expect(entry2?.sessionId).not.toBe(entry1.sessionId);

    const oldTranscript = await transcripts.readAll(entry1.sessionId);
    expect(oldTranscript).toEqual([]);

    const newTranscript = await transcripts.readAll(entry2!.sessionId);
    expect(newTranscript).toEqual([]);
  });
});
