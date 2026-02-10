/**
 * Shared utilities for onboarding flows (dev + docker)
 */

import { createInterface } from "node:readline";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LLMProviderId } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Colors
// ─────────────────────────────────────────────────────────────────────────────

export const COLORS = {
  RED: "\x1b[0;31m",
  GREEN: "\x1b[0;32m",
  YELLOW: "\x1b[1;33m",
  BLUE: "\x1b[0;34m",
  CYAN: "\x1b[0;36m",
  NC: "\x1b[0m", // No Color
};

// ─────────────────────────────────────────────────────────────────────────────
// Console helpers
// ─────────────────────────────────────────────────────────────────────────────

export function info(msg: string) { console.log(`${COLORS.BLUE}ℹ${COLORS.NC} ${msg}`); }
export function success(msg: string) { console.log(`${COLORS.GREEN}✓${COLORS.NC} ${msg}`); }
export function warn(msg: string) { console.log(`${COLORS.YELLOW}!${COLORS.NC} ${msg}`); }
export function error(msg: string) { console.log(`${COLORS.RED}✗${COLORS.NC} ${msg}`); }

export function header(title: string) {
  console.log("");
  console.log(`${COLORS.CYAN}━━━ ${title} ━━━${COLORS.NC}`);
  console.log("");
}

export function printBanner(subtitle = "") {
  const { CYAN, NC } = COLORS;
  console.log("");
  console.log(`${CYAN}   ____          ___       ____        _   ${NC}`);
  console.log(`${CYAN}  / __ \\        / (_)     |  _ \\      | |  ${NC}`);
  console.log(`${CYAN} | |  | |_      _| |_  __ _| |_) | ___ | |_ ${NC}`);
  console.log(`${CYAN} | |  | \\ \\ /\\ / / | |/ _\` |  _ < / _ \\| __|${NC}`);
  console.log(`${CYAN} | |__| |\\ V  V /| | | (_| | |_) | (_) | |_ ${NC}`);
  console.log(`${CYAN}  \\____/  \\_/\\_/ |_|_|\\__,_|____/ \\___/ \\__|${NC}`);
  console.log("");
  const sub = subtitle ? ` ${subtitle}` : "";
  console.log(`  Let's set up OwliaBot${sub}`);
  console.log("");
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────────────────────

type RL = ReturnType<typeof createInterface>;

/**
 * Ask a question. If secret=true, hide input (for tokens/passwords).
 * 
 * Note: Secret input only accepts printable ASCII (32-126) to filter out
 * arrow keys, escape sequences, and other control characters. API tokens
 * and passwords are typically ASCII-only, so this is safe for most cases.
 */
export function ask(rl: RL, q: string, secret = false): Promise<string> {
  return new Promise((resolve) => {
    if (secret) {
      // In non-interactive environments (CI/tests, piped input), stdin isn't a TTY.
      // Raw-mode secret input would hang there, so fall back to readline question.
      if (!process.stdin.isTTY) {
        rl.question(q, (ans) => resolve(ans.trim()));
        return;
      }

      // Hide input for secrets with proper cleanup
      process.stdout.write(q);
      const stdin = process.stdin;
      const oldRawMode = stdin.isRaw;
      
      const restoreMode = () => {
        try {
          if (stdin.isTTY) stdin.setRawMode(oldRawMode ?? false);
        } catch {
          // Ignore errors during cleanup
        }
      };
      
      if (stdin.isTTY) {
        try {
          stdin.setRawMode(true);
        } catch {
          // Fall back to non-secret mode if raw mode fails
          rl.question("", (ans) => resolve(ans.trim()));
          return;
        }
      }
      
      let input = "";
      const onData = (char: Buffer) => {
        const c = char.toString();
        if (c === "\n" || c === "\r") {
          stdin.removeListener("data", onData);
          restoreMode();
          console.log("");
          resolve(input.trim());
        } else if (c === "\x03") { // Ctrl+C
          stdin.removeListener("data", onData);
          restoreMode();
          console.log("");
          process.exit(130); // Standard exit code for Ctrl+C
        } else if (c === "\x7f" || c === "\b") { // Backspace
          input = input.slice(0, -1);
        } else if (c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127) {
          // Only accept printable ASCII (filter out arrow keys, escape sequences, etc.)
          input += c;
        }
        // Silently ignore non-printable characters
      };
      stdin.on("data", onData);
    } else {
      rl.question(q, (ans) => resolve(ans.trim()));
    }
  });
}

/**
 * Yes/No prompt with default.
 */
export async function askYN(rl: RL, q: string, defaultYes = false): Promise<boolean> {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const ans = await ask(rl, `${q} ${suffix}: `);
  if (!ans) return defaultYes;
  return ans.toLowerCase().startsWith("y");
}

/**
 * Select from numbered options.
 */
export async function selectOption(rl: RL, prompt: string, options: string[]): Promise<number> {
  console.log(prompt);
  options.forEach((opt, i) => console.log(`  ${i + 1}) ${opt}`));
  while (true) {
    const ans = await ask(rl, `Your choice [1-${options.length}]: `);
    const num = parseInt(ans, 10);
    if (num >= 1 && num <= options.length) return num - 1;
    warn(`Just type a number between 1 and ${options.length}.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Default models
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_MODELS: Record<LLMProviderId, string> = {
  anthropic: "claude-opus-4-5",
  openai: "gpt-5.2",
  "openai-codex": "gpt-5.2",
  "openai-compatible": "llama3.2",
};

// ─────────────────────────────────────────────────────────────────────────────
// Existing config detection
// ─────────────────────────────────────────────────────────────────────────────

export interface ExistingConfig {
  anthropicKey?: string;
  anthropicToken?: string;
  openaiKey?: string;
  discordToken?: string;
  telegramToken?: string;
  gatewayToken?: string;
  hasOAuthAnthro?: boolean;
  hasOAuthCodex?: boolean;
}

/**
 * Detect existing configuration from secrets.yaml and auth directory.
 * @param configDir Directory containing secrets.yaml and auth/
 */
export function detectExistingConfig(configDir: string): ExistingConfig | null {
  const secretsPath = join(configDir, "secrets.yaml");
  const authDir = join(configDir, "auth");
  
  if (!existsSync(secretsPath) && !existsSync(authDir)) {
    return null;
  }
  
  const result: ExistingConfig = {};
  
  // Parse secrets.yaml
  if (existsSync(secretsPath)) {
    try {
      const content = readFileSync(secretsPath, "utf-8");
      
      // Anthropic
      const anthroKeyMatch = content.match(/^anthropic:\s*\n\s+apiKey:\s*"?([^"\n]+)"?/m);
      if (anthroKeyMatch?.[1] && anthroKeyMatch[1] !== '""') {
        result.anthropicKey = anthroKeyMatch[1];
      }
      const anthroTokenMatch = content.match(/^anthropic:\s*\n(?:\s+apiKey:[^\n]*\n)?\s+token:\s*"?([^"\n]+)"?/m);
      if (anthroTokenMatch?.[1] && anthroTokenMatch[1] !== '""') {
        result.anthropicToken = anthroTokenMatch[1];
      }
      
      // OpenAI
      const openaiMatch = content.match(/^openai:\s*\n\s+apiKey:\s*"?([^"\n]+)"?/m);
      if (openaiMatch?.[1] && openaiMatch[1] !== '""') {
        result.openaiKey = openaiMatch[1];
      }
      
      // Discord
      const discordMatch = content.match(/^discord:\s*\n\s+token:\s*"?([^"\n]+)"?/m);
      if (discordMatch?.[1] && discordMatch[1] !== '""') {
        result.discordToken = discordMatch[1];
      }
      
      // Telegram
      const telegramMatch = content.match(/^telegram:\s*\n\s+token:\s*"?([^"\n]+)"?/m);
      if (telegramMatch?.[1] && telegramMatch[1] !== '""') {
        result.telegramToken = telegramMatch[1];
      }
      
      // Gateway
      const gatewayMatch = content.match(/^gateway:\s*\n\s+token:\s*"?([^"\n]+)"?/m);
      if (gatewayMatch?.[1] && gatewayMatch[1] !== '""') {
        result.gatewayToken = gatewayMatch[1];
      }
    } catch {
      // Ignore parse errors
    }
  }
  
  // Check OAuth tokens
  if (existsSync(authDir)) {
    result.hasOAuthAnthro = existsSync(join(authDir, "anthropic.json"));
    result.hasOAuthCodex = existsSync(join(authDir, "openai-codex.json"));
  }
  
  // Return null if nothing found
  if (Object.keys(result).length === 0) {
    return null;
  }
  
  return result;
}
