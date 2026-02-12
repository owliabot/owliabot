import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildOnboardManifestUrl,
  inferOnboardChannelFromGitHead,
  resolveOnboardBinaryCommand,
  type OnboardBinaryManifest,
} from "../go-runner.js";

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("go-runner binary resolver", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("infers preview channel from develop git HEAD", () => {
    expect(inferOnboardChannelFromGitHead("ref: refs/heads/develop\n")).toBe("preview");
  });

  it("builds stable manifest URL from channel", () => {
    expect(buildOnboardManifestUrl("stable")).toContain("/releases/download/onboard-stable/onboard-manifest.json");
  });

  it("downloads and verifies onboarding binary from manifest", async () => {
    const rootDir = await mkTmpDir("owliabot-go-runner-root-");
    const cacheRootDir = await mkTmpDir("owliabot-go-runner-cache-");
    const binaryData = Buffer.from("#!/bin/sh\necho onboard\n", "utf8");
    const digest = sha256(binaryData);
    const binaryURL = "https://example.test/owliabot-onboard-darwin-arm64";
    const manifest: OnboardBinaryManifest = {
      channel: "preview",
      assets: {
        "darwin-arm64": {
          url: binaryURL,
          sha256: digest,
          fileName: "owliabot-onboard-darwin-arm64",
        },
      },
    };

    await mkdir(join(rootDir, ".git"), { recursive: true });
    await writeFile(join(rootDir, ".git", "HEAD"), "ref: refs/heads/develop\n");

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("onboard-manifest.json")) {
        return jsonResponse(manifest);
      }
      if (url === binaryURL) {
        return new Response(binaryData, { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const resolved = await resolveOnboardBinaryCommand(
      { rootDir, platform: "darwin", arch: "arm64", cacheRootDir },
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );

    expect(resolved).not.toBeNull();
    expect(resolved).toEqual({
      cmd: join(cacheRootDir, "preview", "owliabot-onboard-darwin-arm64"),
      args: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await readFile(resolved!.cmd, "utf8")).toContain("onboard");

    await rm(rootDir, { recursive: true, force: true });
    await rm(cacheRootDir, { recursive: true, force: true });
  });
});

async function mkTmpDir(prefix: string): Promise<string> {
  const p = join(tmpdir(), `${prefix}${Math.random().toString(36).slice(2)}`);
  await mkdir(p, { recursive: true });
  return p;
}
