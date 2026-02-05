/**
 * Config type exports
 */

import type { Config, WalletConfig } from "./schema.js";

export type { Config, WalletConfig };

export interface ConfigLoader {
  load(path: string): Promise<Config>;
}
