/**
 * Enhanced Docker-aware onboarding for OwliaBot
 * 
 * Replaces the bash logic in install.sh with TypeScript.
 * Supports: existing config reuse, OpenAI-compatible, gateway, timezone, docker output.
 */

import { createInterface } from "node:readline";
import { existsSync, readFileSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { createLogger } from "../utils/logger.js";
import type { AppConfig, ProviderConfig, LLMProviderId, MemorySearchConfig, SystemCapabilityConfig } from "./types.js";
import { saveAppConfig } from "./storage.js";
import { startOAuthFlow } from "../auth/oauth.js";
import { saveSecrets, type SecretsConfig } from "./secrets.js";
import { ensureWorkspaceInitialized } from "../workspace/init.js";
import { validateAnthropicSetupToken, isSetupToken } from "../auth/setup-token.js";

const log = createLogger("onboard");

// Colors (ANSI escape codes)
const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const BLUE = "\x1b[0;34m";
const CYAN = "\x1b[0;36m";
const NC = "\x1b[0m"; // No Color

function info(msg: string) { console.log(`${BLUE}i${NC} ${msg}`); }
function success(msg: string) { console.log(`${GREEN}✓${NC} ${msg}`); }
function warn(msg: string) { console.log(`${YELLOW}!${NC} ${msg}`); }
function error(msg: string) { console.log(`${RED}✗${NC} ${msg}`); }

function header(title: string) {
  console.log("");
  console.log(`${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
  console.log(`${CYAN}  ${title}${NC}`);
  console.log(`${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
  console.log("");
}

function ask(rl: ReturnType<typeof createInterface>, q: string, secret = false): Promise<string> {
  return new Promise((resolve) => {
    if (secret) {
      // Hide input for secrets
      process.stdout.write(q);
      const stdin = process.stdin;
      const oldRawMode = stdin.isRaw;
      if (stdin.isTTY) stdin.setRawMode(true);
      
      let input = "";
      const onData = (char: Buffer) => {
        const c = char.toString();
        if (c === "\n" || c === "\r") {
          stdin.removeListener("data", onData);
          if (stdin.isTTY) stdin.setRawMode(oldRawMode ?? false);
          console.log("");
          resolve(input.trim());
        } else if (c === "\x03") { // Ctrl+C
          process.exit(1);
        } else if (c === "\x7f" || c === "\b") { // Backspace
          input = input.slice(0, -1);
        } else {
          input += c;
        }
      };
      stdin.on("data", onData);
    } else {
      rl.question(q, (ans) => resolve(ans.trim()));
    }
  });
}

async function askYN(rl: ReturnType<typeof createInterface>, q: string, defaultYes = false): Promise<boolean> {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const ans = await ask(rl, `${q} ${suffix}: `);
  if (!ans) return defaultYes;
  return ans.toLowerCase().startsWith("y");
}

async function selectOption(rl: ReturnType<typeof createInterface>, prompt: string, options: string[]): Promise<number> {
  console.log(prompt);
  options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));
  
  while (true) {
    const ans = await ask(rl, `Select [1-${options.length}]: `);
    const n = parseInt(ans, 10);
    if (!isNaN(n) && n >= 1 && n <= options.length) {
      return n - 1;
    }
    warn(`Please enter a number between 1 and ${options.length}`);
  }
}

interface ExistingConfig {
  anthropicKey?: string;
  anthropicOAuth?: boolean;
  openaiKey?: string;
  openaiOAuth?: boolean;
  discordToken?: string;
  telegramToken?: string;
  gatewayToken?: string;
  openaiCompatKey?: string;
}

function detectExistingConfig(): ExistingConfig | null {
  const home = homedir();
  const secretsPath = join(home, ".owliabot", "secrets.yaml");
  const authDir = join(home, ".owliabot", "auth");
  
  const result: ExistingConfig = {};
  let hasAny = false;
  
  if (existsSync(secretsPath)) {
    const content = readFileSync(secretsPath, "utf-8");
    
    // Simple YAML parsing for known fields
    const anthropicMatch = content.match(/^anthropic:\s*\n\s+apiKey:\s*"?([^"\n]+)"?/m);
    if (anthropicMatch?.[1] && anthropicMatch[1] !== '""') {
      result.anthropicKey = anthropicMatch[1];
      hasAny = true;
    }
    
    const openaiMatch = content.match(/^openai:\s*\n\s+apiKey:\s*"?([^"\n]+)"?/m);
    if (openaiMatch?.[1] && openaiMatch[1] !== '""') {
      result.openaiKey = openaiMatch[1];
      hasAny = true;
    }
    
    const discordMatch = content.match(/^discord:\s*\n\s+token:\s*"?([^"\n]+)"?/m);
    if (discordMatch?.[1] && discordMatch[1] !== '""') {
      result.discordToken = discordMatch[1];
      hasAny = true;
    }
    
    const telegramMatch = content.match(/^telegram:\s*\n\s+token:\s*"?([^"\n]+)"?/m);
    if (telegramMatch?.[1] && telegramMatch[1] !== '""') {
      result.telegramToken = telegramMatch[1];
      hasAny = true;
    }
    
    const gatewayMatch = content.match(/^gateway:\s*\n\s+token:\s*"?([^"\n]+)"?/m);
    if (gatewayMatch?.[1] && gatewayMatch[1] !== '""') {
      result.gatewayToken = gatewayMatch[1];
      hasAny = true;
    }
  }
  
  if (existsSync(join(authDir, "anthropic.json"))) {
    result.anthropicOAuth = true;
    hasAny = true;
  }
  if (existsSync(join(authDir, "openai-codex.json"))) {
    result.openaiOAuth = true;
    hasAny = true;
  }
  
  return hasAny ? result : null;
}

export interface DockerOnboardOptions {
  configDir?: string;  // Where to write config (default: ./config)
  outputDir?: string;  // Where to write docker-compose.yml (default: .)
  outputFormat?: "docker-run" | "docker-compose" | "both";
}

export async function runDockerOnboarding(options: DockerOnboardOptions = {}): Promise<void> {
  const configDir = options.configDir ?? "./config";
  const outputDir = options.outputDir ?? ".";
  const outputFormat = options.outputFormat ?? "both";
  
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  
  try {
    // Banner
    console.log("");
    console.log(`${CYAN}`);
    console.log("   ____          ___       ____        _   ");
    console.log("  / __ \\        / (_)     |  _ \\      | |  ");
    console.log(" | |  | |_      _| |_  __ _| |_) | ___ | |_ ");
    console.log(" | |  | \\ \\ /\\ / / | |/ _\` |  _ < / _ \\| __|");
    console.log(" | |__| |\\ V  V /| | | (_| | |_) | (_) | |_ ");
    console.log("  \\____/  \\_/\\_/ |_|_|\\__,_|____/ \\___/ \\__|");
    console.log(`${NC}`);
    console.log("");
    console.log("  OwliaBot Docker Configuration");
    console.log("");
    
    // Ensure config directory exists
    mkdirSync(configDir, { recursive: true });
    
    // Check for existing config
    const existing = detectExistingConfig();
    let reuseExisting = false;
    
    if (existing) {
      header("Existing configuration found");
      info(`Found existing config at: ~/.owliabot`);
      
      if (existing.anthropicKey) info(`Found Anthropic API key: ${existing.anthropicKey.slice(0, 10)}...`);
      if (existing.anthropicOAuth) info("Found Anthropic OAuth token");
      if (existing.openaiKey) info(`Found OpenAI API key: ${existing.openaiKey.slice(0, 10)}...`);
      if (existing.openaiOAuth) info("Found OpenAI OAuth token (openai-codex)");
      if (existing.discordToken) info(`Found Discord token: ${existing.discordToken.slice(0, 20)}...`);
      if (existing.telegramToken) info(`Found Telegram token: ${existing.telegramToken.slice(0, 10)}...`);
      if (existing.gatewayToken) info(`Found Gateway token: ${existing.gatewayToken.slice(0, 10)}...`);
      
      reuseExisting = await askYN(rl, "Do you want to reuse existing configuration?", true);
      if (reuseExisting) {
        success("Will reuse existing configuration");
      } else {
        info("Will configure new credentials");
      }
    }
    
    // =========================================================================
    // AI Providers
    // =========================================================================
    header("AI provider setup");
    
    const secrets: SecretsConfig = {};
    const providers: ProviderConfig[] = [];
    let priority = 1;
    
    // Reuse existing or prompt
    let useAnthropic = false;
    let useOpenai = false;
    let useOpenaiCodex = false;
    let useOpenaiCompat = false;
    
    if (reuseExisting && existing) {
      if (existing.anthropicKey || existing.anthropicOAuth) {
        useAnthropic = true;
        if (existing.anthropicKey) secrets.anthropic = { apiKey: existing.anthropicKey };
        success("Reusing Anthropic configuration");
      }
      if (existing.openaiKey) {
        useOpenai = true;
        secrets.openai = { apiKey: existing.openaiKey };
        success("Reusing OpenAI configuration");
      }
      if (existing.openaiOAuth) {
        useOpenaiCodex = true;
        success("Reusing OpenAI OAuth (openai-codex) configuration");
      }
    }
    
    if (!useAnthropic && !useOpenai && !useOpenaiCodex) {
      const aiChoice = await selectOption(rl, "Choose your AI provider(s):", [
        "Anthropic (Claude)",
        "OpenAI (API key)",
        "OpenAI (OAuth via ChatGPT Plus/Pro - openai-codex)",
        "OpenAI-compatible (Ollama / vLLM / LM Studio / etc.)",
        "Multiple providers (fallback)",
      ]);
      
      // Anthropic
      if (aiChoice === 0 || aiChoice === 4) {
        useAnthropic = true;
        console.log("");
        info("Anthropic: https://console.anthropic.com/settings/keys");
        
        const useOAuth = await askYN(rl, "Use OAuth instead of API key? (Claude Pro/Max subscription)", true);
        if (!useOAuth) {
          const key = await ask(rl, "Enter Anthropic API key: ", true);
          if (key) {
            secrets.anthropic = { apiKey: key };
            success("Anthropic API key set");
          }
        } else {
          success("Anthropic OAuth will be configured after container starts");
        }
      }
      
      // OpenAI
      if (aiChoice === 1 || aiChoice === 4) {
        useOpenai = true;
        console.log("");
        info("OpenAI API keys: https://platform.openai.com/api-keys");
        const key = await ask(rl, "Enter OpenAI API key: ", true);
        if (key) {
          secrets.openai = { apiKey: key };
          success("OpenAI API key set");
        }
      }
      
      // OpenAI Codex (OAuth)
      if (aiChoice === 2 || aiChoice === 4) {
        useOpenaiCodex = true;
        console.log("");
        info("OpenAI OAuth (openai-codex) uses your ChatGPT Plus/Pro subscription.");
        success("OpenAI OAuth will be configured after container starts");
      }
      
      // OpenAI-compatible
      if (aiChoice === 3 || aiChoice === 4) {
        console.log("");
        info("OpenAI-compatible supports any server that implements the OpenAI v1 API.");
        info("Examples:");
        info("  - Ollama:    http://localhost:11434/v1");
        info("  - vLLM:      http://localhost:8000/v1");
        info("  - LM Studio: http://localhost:1234/v1");
        console.log("");
        
        const baseUrl = await ask(rl, "API base URL: ");
        if (baseUrl) {
          useOpenaiCompat = true;
          const model = await ask(rl, "Model name [llama3.2]: ") || "llama3.2";
          const apiKey = await ask(rl, "API key (optional): ", true);
          
          providers.push({
            id: "openai-compatible" as LLMProviderId,
            model,
            baseUrl,
            apiKey: apiKey ? "secrets" : "none",
            priority: priority++,
          } as ProviderConfig);
          
          if (apiKey) {
            (secrets as any)["openai-compatible"] = { apiKey };
          }
          success(`OpenAI-compatible configured: ${baseUrl}`);
        }
      }
    }
    
    // Build provider configs
    if (useAnthropic) {
      providers.push({
        id: "anthropic",
        model: "claude-sonnet-4-5",
        apiKey: secrets.anthropic?.apiKey ? "secrets" : "oauth",
        priority: priority++,
      } as ProviderConfig);
    }
    if (useOpenai) {
      providers.push({
        id: "openai",
        model: "gpt-4o",
        apiKey: secrets.openai?.apiKey ? "secrets" : "env",
        priority: priority++,
      } as ProviderConfig);
    }
    if (useOpenaiCodex) {
      providers.push({
        id: "openai-codex",
        model: "gpt-5.2",
        apiKey: "oauth",
        priority: priority++,
      } as ProviderConfig);
    }
    
    if (providers.length === 0) {
      error("You must select at least one provider.");
      process.exit(1);
    }
    
    // =========================================================================
    // Chat platforms
    // =========================================================================
    header("Chat platform setup");
    
    let discordToken = reuseExisting && existing?.discordToken ? existing.discordToken : "";
    let telegramToken = reuseExisting && existing?.telegramToken ? existing.telegramToken : "";
    
    if (reuseExisting && (discordToken || telegramToken)) {
      success("Reusing existing chat platform configuration:");
      if (discordToken) {
        info("  - Discord");
        secrets.discord = { token: discordToken };
      }
      if (telegramToken) {
        info("  - Telegram");
        secrets.telegram = { token: telegramToken };
      }
    } else {
      const chatChoice = await selectOption(rl, "Choose platform(s):", [
        "Discord",
        "Telegram", 
        "Both",
      ]);
      
      if (chatChoice === 0 || chatChoice === 2) {
        console.log("");
        info("Discord developer portal: https://discord.com/developers/applications");
        discordToken = await ask(rl, "Enter Discord bot token: ", true);
        if (discordToken) {
          secrets.discord = { token: discordToken };
          success("Discord token set");
        }
      }
      
      if (chatChoice === 1 || chatChoice === 2) {
        console.log("");
        info("Telegram BotFather: https://t.me/BotFather");
        telegramToken = await ask(rl, "Enter Telegram bot token: ", true);
        if (telegramToken) {
          secrets.telegram = { token: telegramToken };
          success("Telegram token set");
        }
      }
    }
    
    if (!discordToken && !telegramToken) {
      error("You must configure at least one chat platform token.");
      process.exit(1);
    }
    
    // =========================================================================
    // Gateway HTTP
    // =========================================================================
    header("Gateway HTTP");
    
    info("Gateway HTTP is used for health checks and REST API access.");
    
    const gatewayPort = await ask(rl, "Host port to expose the gateway [8787]: ") || "8787";
    
    let gatewayToken = reuseExisting && existing?.gatewayToken ? existing.gatewayToken : "";
    if (!gatewayToken) {
      gatewayToken = randomBytes(16).toString("hex");
      info("Generated a random gateway token.");
    } else {
      success("Reusing existing Gateway token");
    }
    
    const confirmToken = await ask(rl, `Gateway token [${gatewayToken.slice(0, 8)}...]: `, true);
    if (confirmToken) gatewayToken = confirmToken;
    success("Gateway token set");
    
    (secrets as any).gateway = { token: gatewayToken };
    
    // =========================================================================
    // Timezone
    // =========================================================================
    header("Other settings");
    
    const tz = await ask(rl, "Timezone [UTC]: ") || "UTC";
    success(`Timezone: ${tz}`);
    
    // =========================================================================
    // Write configs
    // =========================================================================
    header("Writing config");
    
    const home = homedir();
    const owliabotHome = join(home, ".owliabot");
    mkdirSync(owliabotHome, { recursive: true });
    chmodSync(owliabotHome, 0o700);
    mkdirSync(join(owliabotHome, "auth"), { recursive: true });
    
    // Write secrets.yaml
    const secretsYaml = `# OwliaBot Secrets
# Generated by onboard on ${new Date().toISOString()}
# This file contains sensitive information. Do NOT commit it.

anthropic:
  apiKey: "${secrets.anthropic?.apiKey ?? ""}"

openai:
  apiKey: "${secrets.openai?.apiKey ?? ""}"

openai-compatible:
  apiKey: "${(secrets as any)["openai-compatible"]?.apiKey ?? ""}"

discord:
  token: "${secrets.discord?.token ?? ""}"

telegram:
  token: "${secrets.telegram?.token ?? ""}"

gateway:
  token: "${gatewayToken}"
`;
    
    const secretsPath = join(owliabotHome, "secrets.yaml");
    writeFileSync(secretsPath, secretsYaml);
    chmodSync(secretsPath, 0o600);
    success(`Wrote ${secretsPath} (chmod 600)`);
    
    // Write app.yaml
    let appYaml = `# OwliaBot config
# Generated by onboard on ${new Date().toISOString()}
# Secrets are in ~/.owliabot/secrets.yaml

providers:
`;
    
    for (const p of providers) {
      appYaml += `  - id: ${p.id}\n`;
      appYaml += `    model: ${p.model}\n`;
      appYaml += `    apiKey: ${p.apiKey}\n`;
      if ((p as any).baseUrl) {
        appYaml += `    baseUrl: ${(p as any).baseUrl}\n`;
      }
      appYaml += `    priority: ${p.priority}\n`;
    }
    
    appYaml += `
# Chat platform config (tokens are read from secrets.yaml)
`;
    
    if (discordToken) {
      appYaml += `discord:
  enabled: true
`;
    }
    if (telegramToken) {
      appYaml += `telegram:
  enabled: true
`;
    }
    
    appYaml += `
# Gateway HTTP config
gateway:
  http:
    host: 0.0.0.0
    port: 8787

workspace: /app/workspace
timezone: ${tz}
`;
    
    const appConfigPath = join(configDir, "app.yaml");
    writeFileSync(appConfigPath, appYaml);
    success(`Wrote ${appConfigPath}`);
    
    // Create symlink for secrets
    const secretsLink = join(configDir, "secrets.yaml");
    try {
      const { symlinkSync, unlinkSync } = await import("node:fs");
      try { unlinkSync(secretsLink); } catch {}
      symlinkSync(secretsPath, secretsLink);
      success(`Linked ${secretsLink} -> ${secretsPath}`);
    } catch {
      info(`Note: Could not create symlink. Mount secrets.yaml manually.`);
    }
    
    // =========================================================================
    // Docker output
    // =========================================================================
    header("Docker commands");
    
    const image = "ghcr.io/owliabot/owliabot:latest";
    
    if (outputFormat === "docker-run" || outputFormat === "both") {
      console.log("Docker run command:");
      console.log(`
docker run -d \\
  --name owliabot \\
  --restart unless-stopped \\
  -p 127.0.0.1:${gatewayPort}:8787 \\
  -v ~/.owliabot/secrets.yaml:/app/config/secrets.yaml:ro \\
  -v ~/.owliabot/auth:/home/owliabot/.owliabot/auth \\
  -v $(pwd)/${configDir}/app.yaml:/app/config/app.yaml:ro \\
  -v $(pwd)/workspace:/app/workspace \\
  -e TZ=${tz} \\
  ${image} \\
  start -c /app/config/app.yaml
`);
    }
    
    if (outputFormat === "docker-compose" || outputFormat === "both") {
      const composeYaml = `# docker-compose.yml for OwliaBot
# Generated by onboard

services:
  owliabot:
    image: ${image}
    container_name: owliabot
    restart: unless-stopped
    ports:
      - "127.0.0.1:${gatewayPort}:8787"
    volumes:
      - ~/.owliabot/secrets.yaml:/app/config/secrets.yaml:ro
      - ~/.owliabot/auth:/home/owliabot/.owliabot/auth
      - ./${configDir}/app.yaml:/app/config/app.yaml:ro
      - ./workspace:/app/workspace
    environment:
      - TZ=${tz}
    command: ["start", "-c", "/app/config/app.yaml"]
`;
      
      const composePath = join(outputDir, "docker-compose.yml");
      writeFileSync(composePath, composeYaml);
      success(`Wrote ${composePath}`);
      console.log("\nTo start: docker-compose up -d");
    }
    
    // =========================================================================
    // Summary
    // =========================================================================
    header("Done");
    
    console.log("Files created:");
    console.log("  - ~/.owliabot/secrets.yaml   (sensitive)");
    console.log("  - ~/.owliabot/auth/          (OAuth tokens)");
    console.log("  - ./config/app.yaml          (app config)");
    console.log("  - ./docker-compose.yml       (if generated)");
    console.log("");
    
    console.log("Next steps:");
    if (useAnthropic && !secrets.anthropic?.apiKey) {
      console.log("  - Anthropic OAuth: docker run --rm -it -v ~/.owliabot/auth:/home/owliabot/.owliabot/auth " + image + " auth setup anthropic");
    }
    if (useOpenaiCodex) {
      console.log("  - OpenAI OAuth: docker run --rm -it -v ~/.owliabot/auth:/home/owliabot/.owliabot/auth " + image + " auth setup openai-codex");
    }
    console.log("  - Start: docker-compose up -d");
    console.log("  - Logs:  docker-compose logs -f");
    console.log("");
    
    console.log("Gateway HTTP:");
    console.log(`  - URL:   http://localhost:${gatewayPort}`);
    console.log(`  - Token: ${gatewayToken.slice(0, 8)}...`);
    console.log("");
    
    success("All set!");
    
  } finally {
    rl.close();
  }
}
