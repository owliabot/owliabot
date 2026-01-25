/**
 * Logger utility
 */

import { Logger } from "tslog";

export const logger = new Logger({
  name: "owliabot",
  minLevel: 3, // info
  prettyLogTemplate:
    "{{yyyy}}-{{mm}}-{{dd}} {{hh}}:{{MM}}:{{ss}} {{logLevelName}} [{{name}}] ",
});

export function createLogger(name: string) {
  return logger.getSubLogger({ name });
}
