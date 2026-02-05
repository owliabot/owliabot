/**
 * Logger utility
 */

import { Logger } from "tslog";

export const logger = new Logger({
  name: "owliabot",
  minLevel: process.env.LOG_LEVEL === "debug" ? 2 : 3, // debug=2, info=3
  prettyLogTemplate:
    "{{yyyy}}-{{mm}}-{{dd}} {{hh}}:{{MM}}:{{ss}} {{logLevelName}} [{{name}}] ",
});

export function createLogger(name: string) {
  return logger.getSubLogger({ name });
}
