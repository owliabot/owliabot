import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { createMemorySearchTool } from "./memory-search.js";
import { indexMemory } from "../../../memory/index/indexer.js";

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), "owliabot-memsearch-"));
}

describe("memory_search tool (sqlite)", () => {
  it("returns results from the sqlite index (not by re-reading files)", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "# Memory\nA unicorn appears\n", "utf-8");

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({ workspaceDir: dir, dbPath });

      // Change the file after indexing; search should still return the indexed text.
      await writeFile(join(dir, "MEMORY.md"), "# Memory\nNo mythical creatures here\n", "utf-8");

      const db = new Database(dbPath, { readonly: true });
      const row = db
        .prepare(
          "SELECT path, startLine, endLine, text FROM chunks WHERE text LIKE ? LIMIT 1"
        )
        .get("%unicorn%") as
        | { path: string; startLine: number; endLine: number; text: string }
        | undefined;
      db.close();

      expect(row).toBeTruthy();

      const tool = createMemorySearchTool({ workspace: dir });
      const res = await tool.execute(
        { query: "unicorn", max_results: 5 },
        {
          sessionKey: "test",
          agentId: "main",
          config: {
            memorySearch: {
              enabled: true,
              store: { path: dbPath },
              extraPaths: [],
            },
          },
        } as any
      );

      expect(res.success).toBe(true);
      const results = (res as any).data.results as Array<any>;
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBe(row!.path);
      expect(results[0].lines).toBe(`${row!.startLine}-${row!.endLine}`);
      expect(results[0].snippet).toContain("unicorn");
      expect(results[0].snippet).toBe(row!.text.trimEnd());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prioritizes core memory sources (MEMORY.md + memory/) over extraPaths on score ties", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await mkdir(join(dir, "extra"), { recursive: true });

      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");
      await writeFile(join(dir, "extra", "note.md"), "alpha\n", "utf-8");

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({ workspaceDir: dir, dbPath, extraPaths: ["extra"] });

      const tool = createMemorySearchTool({ workspace: dir });
      const res = await tool.execute(
        { query: "alpha", max_results: 5 },
        {
          sessionKey: "test",
          agentId: "main",
          config: {
            memorySearch: {
              enabled: true,
              store: { path: dbPath },
              extraPaths: ["extra"],
            },
          },
        } as any
      );

      expect(res.success).toBe(true);
      const results = (res as any).data.results as Array<any>;
      const paths = results.map((r) => r.path);
      expect(paths).toContain("MEMORY.md");
      expect(paths).toContain("extra/note.md");
      expect(results[0].path).toBe("MEMORY.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats core sources as core even if also configured in extraPaths", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await mkdir(join(dir, "extra"), { recursive: true });

      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");
      await writeFile(join(dir, "extra", "note.md"), "alpha\n", "utf-8");

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({
        workspaceDir: dir,
        dbPath,
        extraPaths: ["extra", "MEMORY.md", "./MEMORY.md"],
      });

      const tool = createMemorySearchTool({ workspace: dir });
      const res = await tool.execute(
        { query: "alpha", max_results: 5 },
        {
          sessionKey: "test",
          agentId: "main",
          config: {
            memorySearch: {
              enabled: true,
              store: { path: dbPath },
              extraPaths: ["extra", "MEMORY.md"],
            },
          },
        } as any
      );

      expect(res.success).toBe(true);
      const results = (res as any).data.results as Array<any>;
      const paths = results.map((r) => r.path);
      expect(paths).toContain("MEMORY.md");
      expect(paths).toContain("extra/note.md");
      expect(results[0].path).toBe("MEMORY.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("filters results to the allowlisted paths even if the DB contains other rows", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({ workspaceDir: dir, dbPath });

      // Inject a non-allowlisted path directly into sqlite.
      const db = new Database(dbPath);
      db.pragma("foreign_keys = ON");
      db.prepare("INSERT OR REPLACE INTO files (path, hash, updatedAt) VALUES (?, ?, ?)").run(
        "secrets/secret.md",
        "deadbeef",
        Date.now()
      );
      db.prepare(
        "INSERT OR REPLACE INTO chunks (id, path, startLine, endLine, text) VALUES (?, ?, ?, ?, ?)"
      ).run("bad-chunk", "secrets/secret.md", 1, 1, "alpha\n");
      db.close();

      const tool = createMemorySearchTool({ workspace: dir });
      const res = await tool.execute(
        { query: "alpha", max_results: 10 },
        {
          sessionKey: "test",
          agentId: "main",
          config: {
            memorySearch: {
              enabled: true,
              store: { path: dbPath },
              extraPaths: [],
            },
          },
        } as any
      );

      expect(res.success).toBe(true);
      const results = (res as any).data.results as Array<any>;
      const paths = results.map((r) => r.path);
      expect(paths).toContain("MEMORY.md");
      expect(paths).not.toContain("secrets/secret.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("selects top-N deterministically by score (ORDER BY before LIMIT)", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "stub\n", "utf-8");

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({ workspaceDir: dir, dbPath });

      // Overwrite the chunks table with controlled rows:
      // - many low-score matches first
      // - one high-score match last
      const db = new Database(dbPath);
      db.pragma("foreign_keys = ON");
      db.prepare(
        "INSERT OR REPLACE INTO files (path, hash, updatedAt) VALUES (?, ?, ?)"
      ).run("MEMORY.md", "hash", Date.now());
      db.prepare("DELETE FROM chunks").run();

      const insertChunk = db.prepare(
        "INSERT OR REPLACE INTO chunks (id, path, startLine, endLine, text) VALUES (?, ?, ?, ?, ?)"
      );

      for (let i = 1; i <= 200; i++) {
        insertChunk.run(`low-${i}`, "MEMORY.md", i, i, "alpha\n");
      }
      // Best match inserted last; without ORDER BY before LIMIT this can be missed.
      insertChunk.run("best", "MEMORY.md", 500, 500, "alpha beta\n");

      db.close();

      const tool = createMemorySearchTool({ workspace: dir });
      const res = await tool.execute(
        { query: "alpha beta", max_results: 1 },
        {
          sessionKey: "test",
          agentId: "main",
          config: {
            memorySearch: {
              enabled: true,
              store: { path: dbPath },
              extraPaths: [],
            },
          },
        } as any
      );

      expect(res.success).toBe(true);
      const results = (res as any).data.results as Array<any>;
      expect(results).toHaveLength(1);
      expect(results[0].snippet).toContain("alpha beta");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("handles large allowlists without hitting SQLite variable limits", async () => {
    const dir = await makeTmpDir();
    try {
      const memoryDir = join(dir, "memory");
      await mkdir(memoryDir, { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({ workspaceDir: dir, dbPath });

      // Create a large number of additional allowlisted files *after* indexing.
      // This stresses the allowlist filter without bloating the sqlite DB.
      const many = 1200;
      for (let i = 0; i < many; i++) {
        await writeFile(join(memoryDir, `f-${i}.md`), "(unused)\n", "utf-8");
      }

      const tool = createMemorySearchTool({ workspace: dir });
      const res = await tool.execute(
        { query: "alpha", max_results: 5 },
        {
          sessionKey: "test",
          agentId: "main",
          config: {
            memorySearch: {
              enabled: true,
              store: { path: dbPath },
              extraPaths: [],
            },
          },
        } as any
      );

      expect(res.success).toBe(true);
      const results = (res as any).data.results as Array<any>;
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBe("MEMORY.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("memory_search tool (sqlite, transcripts source)", () => {
  it("indexes transcript jsonl lines and returns them when sources includes transcripts", async () => {
    const dir = await makeTmpDir();
    const prevHome = process.env.HOME;
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "# Memory\n", "utf-8");

      // Put sessions under a controlled HOME directory (aligned with src/entry.ts).
      const home = join(dir, "home");
      process.env.HOME = home;

      const sessionsDir = join(home, ".owliabot", "sessions");
      const transcriptsDir = join(sessionsDir, "transcripts");
      await mkdir(transcriptsDir, { recursive: true });

      const sessionId = "11111111-1111-1111-1111-111111111111";
      const transcriptPath = join(transcriptsDir, `${sessionId}.jsonl`);
      await writeFile(
        transcriptPath,
        [
          JSON.stringify({ role: "user", content: "I saw a unicorn today", timestamp: 1 }),
          JSON.stringify({ role: "assistant", content: "Noted", timestamp: 2 }),
        ].join("\n") + "\n",
        "utf-8"
      );

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({ workspaceDir: dir, dbPath, sources: ["files", "transcripts"] });

      const tool = createMemorySearchTool({ workspace: dir });
      const res = await tool.execute(
        { query: "unicorn", max_results: 5 },
        {
          sessionKey: "test",
          agentId: "main",
          config: {
            memorySearch: {
              enabled: true,
              store: { path: dbPath },
              extraPaths: [],
              sources: ["files", "transcripts"],
            },
          },
        } as any
      );

      expect(res.success).toBe(true);
      const results = (res as any).data.results as Array<any>;
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => String(r.path).startsWith("transcript:"))).toBe(true);
      expect(results.map((r) => r.snippet).join("\n")).toContain("unicorn");
    } finally {
      process.env.HOME = prevHome;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails closed: does not follow symlinks inside transcriptsDir", async () => {
    const dir = await makeTmpDir();
    const prevHome = process.env.HOME;
    try {
      const home = join(dir, "home");
      process.env.HOME = home;

      const sessionsDir = join(home, ".owliabot", "sessions");
      const transcriptsDir = join(sessionsDir, "transcripts");
      await mkdir(transcriptsDir, { recursive: true });

      const outside = join(dir, "outside.jsonl");
      await writeFile(
        outside,
        JSON.stringify({ role: "user", content: "alpha secret", timestamp: 1 }) + "\n",
        "utf-8"
      );

      // Symlink inside transcriptsDir pointing outside.
      await symlink(outside, join(transcriptsDir, "linked.jsonl"));

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({ workspaceDir: dir, dbPath, sources: ["transcripts"] });

      const tool = createMemorySearchTool({ workspace: dir });
      const res = await tool.execute(
        { query: "alpha", max_results: 10 },
        {
          sessionKey: "test",
          agentId: "main",
          config: {
            memorySearch: {
              enabled: true,
              store: { path: dbPath },
              extraPaths: [],
              sources: ["transcripts"],
            },
          },
        } as any
      );

      expect(res.success).toBe(true);
      const results = (res as any).data.results as Array<any>;
      expect(results).toEqual([]);
    } finally {
      process.env.HOME = prevHome;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails closed: does not follow a symlinked transcripts directory", async () => {
    const dir = await makeTmpDir();
    const prevHome = process.env.HOME;
    try {
      const home = join(dir, "home");
      process.env.HOME = home;

      const sessionsDir = join(home, ".owliabot", "sessions");
      const transcriptsDir = join(sessionsDir, "transcripts");

      const outsideDir = join(dir, "outside");
      const outsideTranscripts = join(outsideDir, "transcripts");
      await mkdir(outsideTranscripts, { recursive: true });

      const sessionId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      await writeFile(
        join(outsideTranscripts, `${sessionId}.jsonl`),
        JSON.stringify({ role: "user", content: "alpha secret", timestamp: 1 }) +
          "\n",
        "utf-8"
      );

      // Create sessionsDir but make transcripts/ a symlink to an outside directory.
      await mkdir(sessionsDir, { recursive: true });
      await symlink(outsideTranscripts, transcriptsDir);

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({ workspaceDir: dir, dbPath, sources: ["transcripts"] });

      const tool = createMemorySearchTool({ workspace: dir });
      const res = await tool.execute(
        { query: "alpha", max_results: 10 },
        {
          sessionKey: "test",
          agentId: "main",
          config: {
            memorySearch: {
              enabled: true,
              store: { path: dbPath },
              extraPaths: [],
              sources: ["transcripts"],
            },
          },
        } as any
      );

      expect(res.success).toBe(true);
      const results = (res as any).data.results as Array<any>;
      expect(results).toEqual([]);
    } finally {
      process.env.HOME = prevHome;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("back-compat: sqlite search still works for files if transcript tables are missing", async () => {
    const dir = await makeTmpDir();
    const prevHome = process.env.HOME;
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");

      // Ensure transcripts exist so the allowlist includes at least one sessionId.
      const home = join(dir, "home");
      process.env.HOME = home;

      const transcriptsDir = join(home, ".owliabot", "sessions", "transcripts");
      await mkdir(transcriptsDir, { recursive: true });

      const sessionId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
      await writeFile(
        join(transcriptsDir, `${sessionId}.jsonl`),
        JSON.stringify({ role: "user", content: "alpha", timestamp: 1 }) + "\n",
        "utf-8"
      );

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({ workspaceDir: dir, dbPath, sources: ["files"] });

      // Simulate an older DB that predates transcript tables.
      const db = new Database(dbPath);
      db.prepare("DROP TABLE IF EXISTS transcript_chunks").run();
      db.prepare("DROP TABLE IF EXISTS transcripts").run();
      db.close();

      const tool = createMemorySearchTool({ workspace: dir });
      const res = await tool.execute(
        { query: "alpha", max_results: 10 },
        {
          sessionKey: "test",
          agentId: "main",
          config: {
            memorySearch: {
              enabled: true,
              store: { path: dbPath },
              extraPaths: [],
              sources: ["files", "transcripts"],
            },
          },
        } as any
      );

      expect(res.success).toBe(true);
      const results = (res as any).data.results as Array<any>;
      expect(results.length).toBeGreaterThan(0);
      expect(results.map((r) => r.path)).toContain("MEMORY.md");
    } finally {
      process.env.HOME = prevHome;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns top-N transcript matches deterministically (ORDER BY before LIMIT)", async () => {
    const dir = await makeTmpDir();
    const prevHome = process.env.HOME;
    try {
      const home = join(dir, "home");
      process.env.HOME = home;

      const sessionsDir = join(home, ".owliabot", "sessions");
      const transcriptsDir = join(sessionsDir, "transcripts");
      await mkdir(transcriptsDir, { recursive: true });

      // Two transcripts with many equal-score lines.
      const aId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      const bId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
      await writeFile(
        join(transcriptsDir, `${aId}.jsonl`),
        [
          JSON.stringify({ role: "user", content: "alpha", timestamp: 1 }),
          JSON.stringify({ role: "user", content: "alpha", timestamp: 2 }),
          JSON.stringify({ role: "user", content: "alpha", timestamp: 3 }),
        ].join("\n") + "\n",
        "utf-8"
      );
      await writeFile(
        join(transcriptsDir, `${bId}.jsonl`),
        [
          JSON.stringify({ role: "user", content: "alpha", timestamp: 1 }),
          JSON.stringify({ role: "user", content: "alpha", timestamp: 2 }),
        ].join("\n") + "\n",
        "utf-8"
      );

      const dbPath = join(dir, "memory.sqlite");
      await indexMemory({ workspaceDir: dir, dbPath, sources: ["transcripts"] });

      const tool = createMemorySearchTool({ workspace: dir });
      const res = await tool.execute(
        { query: "alpha", max_results: 3 },
        {
          sessionKey: "test",
          agentId: "main",
          config: {
            memorySearch: {
              enabled: true,
              store: { path: dbPath },
              extraPaths: [],
              sources: ["transcripts"],
            },
          },
        } as any
      );

      expect(res.success).toBe(true);
      const results = (res as any).data.results as Array<any>;
      expect(results).toHaveLength(3);
      // Deterministic: transcript aId comes before bId, and startLine asc.
      expect(results[0].path).toBe(`transcript:${aId}`);
      expect(results[0].lines).toBe("1-1");
      expect(results[1].path).toBe(`transcript:${aId}`);
      expect(results[1].lines).toBe("2-2");
      expect(results[2].path).toBe(`transcript:${aId}`);
      expect(results[2].lines).toBe("3-3");
    } finally {
      process.env.HOME = prevHome;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("memory_search tool (provider fallback)", () => {
  it("uses the configured fallback provider when sqlite is unavailable", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");

      const missingDbPath = join(dir, "missing.sqlite");

      const tool = createMemorySearchTool({ workspace: dir });
      const res = await tool.execute(
        { query: "alpha", max_results: 5 },
        {
          sessionKey: "test",
          agentId: "main",
          config: {
            memorySearch: {
              enabled: true,
              provider: "sqlite",
              fallback: "naive",
              store: { path: missingDbPath },
              extraPaths: [],
            },
          },
        } as any
      );

      expect(res.success).toBe(true);
      const results = (res as any).data.results as Array<any>;
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBe("MEMORY.md");
      expect(results[0].snippet).toContain("alpha");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails closed (empty results) when both primary and fallback providers are unavailable", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "MEMORY.md"), "alpha\n", "utf-8");

      const missingDbPath = join(dir, "missing.sqlite");

      const tool = createMemorySearchTool({ workspace: dir });
      const res = await tool.execute(
        { query: "alpha", max_results: 5 },
        {
          sessionKey: "test",
          agentId: "main",
          config: {
            memorySearch: {
              enabled: true,
              provider: "sqlite",
              fallback: "sqlite",
              store: { path: missingDbPath },
              extraPaths: [],
            },
          },
        } as any
      );

      expect(res.success).toBe(true);
      const results = (res as any).data.results as Array<any>;
      expect(results).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ensures naive fallback respects the allowlist and does not leak other workspace files", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await mkdir(join(dir, "secrets"), { recursive: true });

      await writeFile(join(dir, "MEMORY.md"), "beta\n", "utf-8");
      await writeFile(join(dir, "secrets", "secret.md"), "alpha\n", "utf-8");

      const missingDbPath = join(dir, "missing.sqlite");

      const tool = createMemorySearchTool({ workspace: dir });
      const res = await tool.execute(
        { query: "alpha", max_results: 10 },
        {
          sessionKey: "test",
          agentId: "main",
          config: {
            memorySearch: {
              enabled: true,
              provider: "sqlite",
              fallback: "naive",
              store: { path: missingDbPath },
              extraPaths: [],
            },
          },
        } as any
      );

      expect(res.success).toBe(true);
      const results = (res as any).data.results as Array<any>;
      expect(results).toEqual([]);
      expect(results.map((r) => r.path)).not.toContain("secrets/secret.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
