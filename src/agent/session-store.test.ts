import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore } from "./session-store.js";

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), "owliabot-session-store-"));
}

describe("SessionStore", () => {
  it("getOrCreate returns stable sessionId for same key", async () => {
    const dir = await makeTmpDir();
    const store = createSessionStore({ sessionsDir: dir });

    const a = await store.getOrCreate("k1");
    const b = await store.getOrCreate("k1");

    expect(a.sessionId).toBe(b.sessionId);
    expect(typeof a.updatedAt).toBe("number");
  });

  it("rotate creates a new sessionId", async () => {
    const dir = await makeTmpDir();
    const store = createSessionStore({ sessionsDir: dir });

    const a = await store.getOrCreate("k1");
    const b = await store.rotate("k1");

    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it("breaks stale lock", async () => {
    const dir = await makeTmpDir();
    const storePath = join(dir, "sessions.json");
    const lockPath = storePath + ".lock";

    // Create an old lock file
    await writeFile(
      lockPath,
      JSON.stringify({ pid: 999999, createdAt: Date.now() - 60_000 }),
      "utf-8"
    );

    const store = createSessionStore({ sessionsDir: dir, lockTimeoutMs: 100 });
    const entry = await store.getOrCreate("k1");

    expect(entry.sessionId).toBeTruthy();
  });
});
