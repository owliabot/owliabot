import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn as nodeSpawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolveOwliabotHome } from "../utils/paths.js";

export interface GoOnboardOptions {
  configDir?: string;
  outputDir?: string;
  image?: string;
  channel?: string;
}

export interface ResolvedGoOnboardCommand {
  cmd: string;
  args: string[];
}

export type OnboardChannel = "stable" | "preview";

export interface OnboardBinaryAsset {
  url: string;
  sha256: string;
  fileName?: string;
}

export interface OnboardBinaryManifest {
  channel?: string;
  assets: Record<string, OnboardBinaryAsset>;
}

const MANIFEST_FETCH_TIMEOUT_MS = 15000;
const BINARY_FETCH_TIMEOUT_MS = 30000;
const FETCH_RETRY_COUNT = 2;
const FETCH_BASE_DELAY_MS = 250;
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

interface ResolveCommandOptions {
  rootDir: string;
}

interface ResolveBinaryCommandOptions {
  rootDir: string;
  platform: NodeJS.Platform;
  arch: string;
  channel?: string;
  cacheRootDir?: string;
  repository?: string;
}

interface ResolveBinaryDeps {
  fetchImpl: typeof fetch;
}

interface RunnerDeps {
  spawn: typeof nodeSpawn;
  platform: NodeJS.Platform;
  arch: string;
  rootDir: string;
  resolveBinaryCommand: (
    options: ResolveBinaryCommandOptions,
    deps: ResolveBinaryDeps,
  ) => Promise<ResolvedGoOnboardCommand | null>;
  fetchImpl: typeof fetch;
  repository?: string;
  cacheRootDir?: string;
  allowSourceFallback: boolean;
}

function trimValue(value: string | undefined): string {
  return (value ?? "").trim();
}

export function buildGoOnboardArgs(options: GoOnboardOptions): string[] {
  const args: string[] = [];
  const configDir = trimValue(options.configDir);
  const outputDir = trimValue(options.outputDir);
  const image = trimValue(options.image);

  if (configDir) {
    args.push("--config-dir", configDir);
  }
  if (outputDir) {
    args.push("--output-dir", outputDir);
  }
  if (image) {
    args.push("--image", image);
  }
  return args;
}

export function resolveGoOnboardCommand(options: ResolveCommandOptions): ResolvedGoOnboardCommand {
  return {
    cmd: "go",
    args: ["-C", join(options.rootDir, "client"), "run", "."],
  };
}

function defaultRootDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..");
}

export function inferOnboardChannelFromGitHead(headContent: string): OnboardChannel | null {
  const normalized = headContent.trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized.includes("refs/heads/develop") ||
    normalized.includes("refs/remotes/origin/develop")
  ) {
    return "preview";
  }
  if (
    normalized.includes("refs/heads/main") ||
    normalized.includes("refs/remotes/origin/main")
  ) {
    return "stable";
  }
  return null;
}

export function normalizeOnboardChannel(channel: string | undefined): OnboardChannel | null {
  const normalized = trimValue(channel).toLowerCase();
  if (!normalized) return null;
  if (normalized === "stable") return "stable";
  if (normalized === "preview") return "preview";
  return null;
}

export function buildOnboardManifestUrl(
  channel: OnboardChannel,
  repository = "owliabot/owliabot",
): string {
  return `https://github.com/${repository}/releases/download/onboard-${channel}/onboard-manifest.json`;
}

function onboardRuntimeKey(platform: NodeJS.Platform, arch: string): string | null {
  if ((platform !== "darwin" && platform !== "linux" && platform !== "win32")) {
    return null;
  }
  const normalizedArch = trimValue(arch).toLowerCase();
  if (normalizedArch !== "x64" && normalizedArch !== "arm64") {
    return null;
  }
  return `${platform}-${normalizedArch}`;
}

function defaultBinaryFileName(platform: NodeJS.Platform, arch: string): string {
  const extension = platform === "win32" ? ".exe" : "";
  return `owliabot-onboard-${platform}-${arch}${extension}`;
}

async function readGitHeadForChannel(rootDir: string): Promise<OnboardChannel | null> {
  const dotGitPath = join(rootDir, ".git");
  let headPath = join(dotGitPath, "HEAD");
  try {
    const dotGitRaw = await readFile(dotGitPath, "utf8");
    if (dotGitRaw.startsWith("gitdir:")) {
      const gitDir = dotGitRaw.slice("gitdir:".length).trim();
      headPath = join(rootDir, gitDir, "HEAD");
    }
  } catch {
    // ignore; .git may be a directory
  }
  try {
    const head = await readFile(headPath, "utf8");
    return inferOnboardChannelFromGitHead(head);
  } catch {
    return null;
  }
}

async function resolveOnboardChannel(
  rootDir: string,
  explicit?: string,
): Promise<OnboardChannel> {
  const explicitChannel = normalizeOnboardChannel(explicit);
  if (explicitChannel) return explicitChannel;
  const envChannel = normalizeOnboardChannel(process.env.OWLIABOT_ONBOARD_CHANNEL);
  if (envChannel) return envChannel;
  const gitChannel = await readGitHeadForChannel(rootDir);
  return gitChannel ?? "stable";
}

function sha256Hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function parseOnboardManifest(raw: unknown): OnboardBinaryManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("invalid onboard manifest format");
  }
  const parsed = raw as OnboardBinaryManifest;
  if (!parsed.assets || typeof parsed.assets !== "object") {
    throw new Error("invalid onboard manifest format");
  }
  return parsed;
}

async function fileExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function binaryMatchesChecksum(binaryPath: string, expectedSha256: string): Promise<boolean> {
  try {
    const content = await readFile(binaryPath);
    return sha256Hex(content) === trimValue(expectedSha256).toLowerCase();
  } catch {
    return false;
  }
}

async function fetchManifest(
  manifestURL: string,
  fetchImpl: typeof fetch,
): Promise<OnboardBinaryManifest> {
  const response = await fetchWithTimeoutAndRetry(manifestURL, fetchImpl, {
    timeoutMs: MANIFEST_FETCH_TIMEOUT_MS,
    retries: FETCH_RETRY_COUNT,
  });
  if (!response.ok) {
    throw new Error(`failed to fetch onboard manifest (${response.status})`);
  }
  return parseOnboardManifest(await response.json());
}

async function readCachedManifest(manifestPath: string): Promise<OnboardBinaryManifest | null> {
  try {
    const raw = await readFile(manifestPath, "utf8");
    return parseOnboardManifest(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writeCachedManifest(
  manifestPath: string,
  manifest: OnboardBinaryManifest,
): Promise<void> {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
}

function messageFromError(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "unknown error");
}

async function downloadBinaryAsset(
  asset: OnboardBinaryAsset,
  binaryPath: string,
  platform: NodeJS.Platform,
  fetchImpl: typeof fetch,
): Promise<void> {
  const response = await fetchWithTimeoutAndRetry(asset.url, fetchImpl, {
    timeoutMs: BINARY_FETCH_TIMEOUT_MS,
    retries: FETCH_RETRY_COUNT,
  });
  if (!response.ok) {
    throw new Error(`failed to download onboard binary (${response.status})`);
  }
  const raw = Buffer.from(await response.arrayBuffer());
  const actual = sha256Hex(raw);
  const expected = trimValue(asset.sha256).toLowerCase();
  if (!expected || actual !== expected) {
    throw new Error("onboard binary checksum mismatch");
  }
  await mkdir(dirname(binaryPath), { recursive: true });
  const tempPath = `${binaryPath}.tmp-${Date.now()}`;
  await writeFile(tempPath, raw, { mode: platform === "win32" ? 0o666 : 0o755 });
  if (platform !== "win32") {
    await chmod(tempPath, 0o755);
  }
  await rename(tempPath, binaryPath);
}

interface FetchRetryOptions {
  timeoutMs: number;
  retries: number;
}

async function fetchWithTimeoutAndRetry(
  url: string,
  fetchImpl: typeof fetch,
  options: FetchRetryOptions,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (
        !response.ok &&
        attempt < options.retries &&
        RETRYABLE_HTTP_STATUS.has(response.status)
      ) {
        await delay(FETCH_BASE_DELAY_MS * (attempt + 1));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt >= options.retries) {
        break;
      }
      await delay(FETCH_BASE_DELAY_MS * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
  throw new Error(`failed to fetch ${url}: ${message}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveOnboardBinaryCommand(
  options: ResolveBinaryCommandOptions,
  deps: Partial<ResolveBinaryDeps> = {},
): Promise<ResolvedGoOnboardCommand | null> {
  const runtimeKey = onboardRuntimeKey(options.platform, options.arch);
  if (!runtimeKey) return null;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const channel = await resolveOnboardChannel(options.rootDir, options.channel);
  const repository = trimValue(options.repository) || "owliabot/owliabot";
  const cacheRootDir = trimValue(options.cacheRootDir) ||
    join(resolveOwliabotHome(), "bin", "onboard");
  const manifestURL = buildOnboardManifestUrl(channel, repository);
  const channelDir = join(cacheRootDir, channel);
  const fallbackPath = join(
    channelDir,
    defaultBinaryFileName(options.platform, options.arch),
  );
  const manifestCachePath = join(channelDir, "onboard-manifest.json");

  let manifest: OnboardBinaryManifest | null = null;
  try {
    manifest = await fetchManifest(manifestURL, fetchImpl);
    await writeCachedManifest(manifestCachePath, manifest).catch(() => undefined);
  } catch (err) {
    const cachedManifest = await readCachedManifest(manifestCachePath);
    const cachedAsset = cachedManifest?.assets?.[runtimeKey];
    if (cachedAsset) {
      const safeName = trimValue(cachedAsset.fileName) || defaultBinaryFileName(options.platform, options.arch);
      const cachedPath = join(channelDir, safeName.replace(/[\\/]/g, ""));
      const candidates = new Set([cachedPath, fallbackPath]);
      for (const candidate of candidates) {
        if (!(await fileExists(candidate))) continue;
        if (await binaryMatchesChecksum(candidate, cachedAsset.sha256)) {
          if (options.platform !== "win32") {
            await chmod(candidate, 0o755).catch(() => undefined);
          }
          return { cmd: candidate, args: [] };
        }
      }
      throw new Error(
        `failed to fetch onboard manifest (${messageFromError(err)}); cached binary verification failed`,
      );
    }
    throw err;
  }

  const asset = manifest.assets[runtimeKey];
  if (!asset) {
    return null;
  }

  const safeName = trimValue(asset.fileName) || defaultBinaryFileName(options.platform, options.arch);
  const binaryPath = join(channelDir, safeName.replace(/[\\/]/g, ""));

  const matches = await binaryMatchesChecksum(binaryPath, asset.sha256);
  if (!matches) {
    await rm(binaryPath, { force: true });
    await downloadBinaryAsset(asset, binaryPath, options.platform, fetchImpl);
  }
  if (options.platform !== "win32") {
    await chmod(binaryPath, 0o755).catch(() => undefined);
  }
  return { cmd: binaryPath, args: [] };
}

function canUseGoToolchain(): boolean {
  const result = spawnSync("go", ["version"], { stdio: "ignore" });
  return result.status === 0;
}

function defaultDeps(): RunnerDeps {
  const rootDir = defaultRootDir();
  return {
    spawn: nodeSpawn,
    platform: process.platform,
    arch: process.arch,
    rootDir,
    resolveBinaryCommand: resolveOnboardBinaryCommand,
    fetchImpl: fetch,
    repository: process.env.OWLIABOT_ONBOARD_REPOSITORY,
    cacheRootDir: process.env.OWLIABOT_ONBOARD_CACHE_DIR,
    allowSourceFallback: canUseGoToolchain(),
  };
}

export async function runGoOnboarding(
  options: GoOnboardOptions,
  overrides: Partial<RunnerDeps> = {},
): Promise<void> {
  const deps: RunnerDeps = {
    ...defaultDeps(),
    ...overrides,
  };

  let resolved: ResolvedGoOnboardCommand | null = null;
  let usedSourceFallback = false;
  let binaryResolveError: unknown;
  try {
    resolved = await deps.resolveBinaryCommand(
      {
        rootDir: deps.rootDir,
        platform: deps.platform,
        arch: deps.arch,
        channel: options.channel,
        repository: deps.repository,
        cacheRootDir: deps.cacheRootDir,
      },
      { fetchImpl: deps.fetchImpl },
    );
  } catch (err) {
    binaryResolveError = err;
  }

  if (!resolved) {
    if (!deps.allowSourceFallback) {
      const reason = binaryResolveError instanceof Error ? binaryResolveError.message : "no binary available";
      throw new Error(
        `failed to resolve onboard binary (${reason}). ` +
          "Install Go 1.21+ and retry, or set OWLIABOT_ONBOARD_CHANNEL/OWLIABOT_ONBOARD_REPOSITORY.",
      );
    }
    resolved = resolveGoOnboardCommand({
      rootDir: deps.rootDir,
    });
    usedSourceFallback = true;
  }

  const args = [...resolved.args, ...buildGoOnboardArgs(options)];
  const env =
    usedSourceFallback && deps.platform === "darwin" && !trimValue(process.env.CGO_ENABLED)
      ? { ...process.env, CGO_ENABLED: "0" }
      : process.env;

  await new Promise<void>((resolve, reject) => {
    const child = deps.spawn(resolved.cmd, args, {
      cwd: deps.rootDir,
      stdio: "inherit",
      env,
    }) as ChildProcessWithoutNullStreams;

    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`go onboard exited with code ${code ?? "unknown"}`));
    });
  });
}
