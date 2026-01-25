/**
 * LLM Provider Registry
 * @see design.md DR-008
 */

import { createLogger } from "../../utils/logger.js";
import type { Message } from "../session.js";
import type { LLMResponse, CallOptions, LLMProvider } from "../runner.js";

const log = createLogger("provider-registry");

export type ProviderCallFn = (
  config: LLMProvider,
  messages: Message[],
  options?: CallOptions
) => Promise<LLMResponse>;

export class ProviderRegistry {
  private providers = new Map<string, ProviderCallFn>();

  register(id: string, fn: ProviderCallFn): void {
    if (this.providers.has(id)) {
      log.warn(`Provider ${id} already registered, replacing...`);
    }
    this.providers.set(id, fn);
    log.info(`Registered provider: ${id}`);
  }

  get(id: string): ProviderCallFn | undefined {
    return this.providers.get(id);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }
}

// Global singleton
export const providerRegistry = new ProviderRegistry();
