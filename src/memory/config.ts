import type { Config } from "../config/schema.js";
import type { MemorySearchConfig } from "./types.js";

export function resolveMemorySearchConfig(config: Config): MemorySearchConfig {
  // Config schema ensures defaults.
  return (config as any).memorySearch as MemorySearchConfig;
}

export function resolveMemoryStorePath(params: {
  config: MemorySearchConfig;
  agentId: string;
}): string {
  const raw = params.config.store.path;
  return raw.replaceAll("{agentId}", params.agentId);
}
