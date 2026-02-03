import os from "node:os";
import path from "node:path";

import type { Config } from "../config/schema.js";
import type { MemorySearchConfig } from "./types.js";

export function resolveMemorySearchConfig(config: Config): MemorySearchConfig {
  return config.memorySearch as unknown as MemorySearchConfig;
}

function expandTilde(p: string): string {
  const home = os.homedir();
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

function safeFileToken(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "default";
  return trimmed
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

export function resolveMemoryStorePath(params: {
  config: MemorySearchConfig;
  agentId: string;
}): string {
  const raw = params.config.store.path;
  const safeAgentId = safeFileToken(params.agentId);
  const withToken = raw.replaceAll("{agentId}", safeAgentId);
  return path.resolve(expandTilde(withToken));
}
