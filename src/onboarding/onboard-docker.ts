/**
 * Enhanced Docker-aware onboarding for OwliaBot
 * 
 * Replaces the bash logic in install.sh with TypeScript.
 * Supports: existing config reuse, OpenAI-compatible, gateway, timezone, docker output.
 */

import { createInterface } from "node:readline";
import { existsSync, readFileSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

/**
 * Safely chmod a path, ignoring EPERM/EACCES errors from bind-mounted volumes.
 * When running in Docker with host-mounted volumes, the container user (uid 1001)
 * may not have permission to chmod directories owned by the host user.
 * install.sh already sets proper permissions on the host side.
 * 
 * @returns true if chmod succeeded, false if skipped due to permission error
 */
function safeChmod(path: string, mode: number): boolean {
  try {
    chmodSync(path, mode);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") {
      // Ignore - likely a bind-mounted volume with host ownership
      return false;
    }
    throw err;
  }
}
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { stringify as yamlStringify } from "yaml";
import type { ProviderConfig, LLMProviderId } from "./types.js";
import type { SecretsConfig } from "./secrets.js";
import {
  COLORS,
  info,
  success,
  warn,
  error,
  header,
  ask,
  askYN,
  selectOption,
  printBanner,
  detectExistingConfig as detectExistingConfigBase,
  type ExistingConfig as ExistingConfigBase,
} from "./shared.js";

// Extended config for Docker mode (includes openaiCompatKey and OAuth flags)
interface ExistingConfig extends ExistingConfigBase {
  openaiCompatKey?: string;
  anthropicOAuth?: boolean;
  openaiOAuth?: boolean;
}

function detectExistingConfig(): ExistingConfig | null {
  const home = homedir();
  const configDir = join(home, ".owliabot");
  const secretsPath = join(configDir, "secrets.yaml");
  
  // Use shared detection for standard fields
  const baseConfig = detectExistingConfigBase(configDir);
  if (!baseConfig && !existsSync(secretsPath)) {
    return null;
  }
  
  const result: ExistingConfig = baseConfig ? { ...baseConfig } : {};
  
  // Check for openai-compatible key (Docker-specific)
  if (existsSync(secretsPath)) {
    const content = readFileSync(secretsPath, "utf-8");
    const compatMatch = content.match(/^openai-compatible:\s*\n\s+apiKey:\s*"?([^"\n]+)"?/m);
    if (compatMatch?.[1] && compatMatch[1] !== '""') {
      result.openaiCompatKey = compatMatch[1];
    }
  }
  
  // Map OAuth fields from base to Docker-specific names
  if (baseConfig?.hasOAuthAnthro) {
    result.anthropicOAuth = true;
  }
  if (baseConfig?.hasOAuthCodex) {
    result.openaiOAuth = true;
  }
  
  return Object.keys(result).length > 0 ? result : null;
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
  
  // Determine if configDir is absolute or relative for Docker volume paths
  // For generated Docker commands, always use host-relative paths.
  // When running inside a container (configDir=/app/config), map to host path (./config).
  // This ensures generated docker-compose.yml mounts correctly on the host.
  let hostConfigDir: string;
  if (configDir.startsWith("/app/")) {
    // Container path like /app/config -> host path ./config
    hostConfigDir = "." + configDir.slice(4);
  } else if (configDir.startsWith("/")) {
    // Other absolute paths -> default to ./config
    hostConfigDir = "./config";
  } else {
    // Relative paths -> keep as-is with ./ prefix
    hostConfigDir = configDir.startsWith("./") ? configDir : `./${configDir}`;
  }
  const dockerConfigPath = hostConfigDir;
  const shellConfigPath = hostConfigDir.replace(/^\.\//, "$(pwd)/");
  
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  
  try {
    // Banner
    printBanner("(Docker)");
    
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
          success("Anthropic OAuth: after starting the container, run:");
          info("  docker exec -it owliabot owliabot auth setup anthropic");
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
        success("OpenAI OAuth: after starting the container, run:");
        info("  docker exec -it owliabot owliabot auth setup openai-codex");
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
        info("💡 如果使用 Ollama，请先安装: curl -fsSL https://ollama.com/install.sh | sh");
        info("   安装后运行: ollama pull llama3.2");
        console.log("");
        warn("⚠️  Docker 网络注意事项:");
        warn("   容器内无法访问宿主机的 localhost/127.0.0.1");
        warn("   请使用 http://host.docker.internal:11434/v1 替代");
        warn("   (Linux 用户需添加 --add-host=host.docker.internal:host-gateway)");
        console.log("");
        
        let baseUrl = await ask(rl, "API base URL: ");
        if (baseUrl) {
          // Auto-fix localhost URLs for Docker networking
          if (baseUrl.match(/\blocalhost\b|127\.0\.0\.1/)) {
            const suggested = baseUrl.replace(/\blocalhost\b|127\.0\.0\.1/, "host.docker.internal");
            warn(`检测到 localhost 地址，Docker 容器内无法访问。`);
            info(`建议使用: ${suggested}`);
            const useFixed = await askYN(rl, `自动替换为 ${suggested}?`, true);
            if (useFixed) {
              baseUrl = suggested;
              success(`已替换为: ${baseUrl}`);
            }
          }
          useOpenaiCompat = true;
          const model = await ask(rl, "Model name [llama3.2]: ") || "llama3.2";
          const apiKey = await ask(rl, "API key (optional): ", true);
          
          // OpenAI-compatible uses "secrets" placeholder (config loader now resolves it)
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
        model: "claude-opus-4-5",
        apiKey: secrets.anthropic?.apiKey ? "secrets" : "oauth",
        priority: priority++,
      } as ProviderConfig);
    }
    if (useOpenai) {
      providers.push({
        id: "openai",
        model: "gpt-5.2",
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
        header("Discord Bot 创建步骤");
        info("1. 前往 https://discord.com/developers/applications");
        info("2. 点击 New Application → 输入名称 → 创建");
        info("3. 左侧菜单 Bot → Reset Token → 复制 Token");
        info("4. ⚠️  在 Bot 页面开启 MESSAGE CONTENT INTENT（必须！）");
        info("5. OAuth2 → URL Generator → 勾选 bot → 选权限 → 复制链接邀请 Bot");
        info("详细指南: https://github.com/owliabot/owliabot/blob/main/docs/discord-setup.md");
        console.log("");
        discordToken = await ask(rl, "Enter Discord bot token: ", true);
        if (discordToken) {
          secrets.discord = { token: discordToken };
          success("Discord token set");
        }
      }
      
      if (chatChoice === 1 || chatChoice === 2) {
        console.log("");
        header("Telegram Bot 创建步骤");
        info("1. 在 Telegram 中打开 @BotFather: https://t.me/BotFather");
        info("2. 发送 /newbot → 输入 Bot 名称 → 输入用户名（须以 bot 结尾）");
        info("3. 复制返回的 Token（格式: 123456789:ABCdef...）");
        info("4. 获取你的 User ID: 打开 @userinfobot 发送任意消息");
        info("详细指南: https://github.com/owliabot/owliabot/blob/main/docs/telegram-setup.md");
        console.log("");
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
    if (!safeChmod(owliabotHome, 0o700)) {
      warn(`Could not chmod ${owliabotHome} - using host permissions (bind-mounted volume)`);
    }
    mkdirSync(join(owliabotHome, "auth"), { recursive: true });
    
    // Write secrets.yaml using YAML serializer (safe escaping)
    // All sensitive tokens go to secrets.yaml (config loader resolves "secrets" placeholder)
    const secretsData = {
      anthropic: { apiKey: secrets.anthropic?.apiKey ?? "" },
      openai: { apiKey: secrets.openai?.apiKey ?? "" },
      "openai-compatible": { apiKey: (secrets as any)["openai-compatible"]?.apiKey ?? "" },
      discord: { token: secrets.discord?.token ?? "" },
      telegram: { token: secrets.telegram?.token ?? "" },
      gateway: { token: gatewayToken },
    };
    
    const secretsYaml = `# OwliaBot Secrets
# Generated by onboard on ${new Date().toISOString()}
# This file contains sensitive information. Do NOT commit it.

${yamlStringify(secretsData, { indent: 2 })}`;
    
    const secretsPath = join(owliabotHome, "secrets.yaml");
    writeFileSync(secretsPath, secretsYaml);
    if (safeChmod(secretsPath, 0o600)) {
      success(`Wrote ${secretsPath} (chmod 600)`);
    } else {
      warn(`Wrote ${secretsPath} (chmod skipped - host-mounted volume, ensure host permissions are secure)`);
    }
    
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
# Gateway HTTP config (token resolved from secrets.yaml)
gateway:
  http:
    host: 0.0.0.0
    port: 8787
    token: secrets

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
    const needsHostNetwork = providers.some(p => (p as any).baseUrl?.includes("host.docker.internal"));
    
    if (outputFormat === "docker-run" || outputFormat === "both") {
      console.log("Docker run command:");
      console.log(`
docker run -d \\
  --name owliabot \\
  --restart unless-stopped \\${needsHostNetwork ? "\n  --add-host=host.docker.internal:host-gateway \\" : ""}
  -p 127.0.0.1:${gatewayPort}:8787 \\
  -v ~/.owliabot/secrets.yaml:/app/config/secrets.yaml:ro \\
  -v ~/.owliabot/auth:/home/owliabot/.owliabot/auth \\
  -v ${shellConfigPath}/app.yaml:/app/config/app.yaml:ro \\
  -v owliabot_workspace:/app/workspace \\
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
      - ${dockerConfigPath}/app.yaml:/app/config/app.yaml:ro
      - owliabot_workspace:/app/workspace${needsHostNetwork ? `
    extra_hosts:
      - "host.docker.internal:host-gateway"` : ""}
    environment:
      - TZ=${tz}
    command: ["start", "-c", "/app/config/app.yaml"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8787/health"]
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 10s

volumes:
  owliabot_workspace:
    name: owliabot_workspace
`;
      
      const composePath = join(outputDir, "docker-compose.yml");
      writeFileSync(composePath, composeYaml);
      success(`Wrote ${composePath}`);
      console.log("\nTo start:");
      console.log("  docker compose up -d     # Docker Compose v2");
      console.log("  docker-compose up -d     # Docker Compose v1");
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
    
    const needsOAuth = (useAnthropic && !secrets.anthropic?.apiKey) || useOpenaiCodex;
    
    console.log("Next steps:");
    console.log("  1. Start the container:");
    console.log("     docker compose up -d");
    console.log("");
    if (needsOAuth) {
      console.log("  2. Set up OAuth authentication (run after container is started):");
      if (useAnthropic && !secrets.anthropic?.apiKey) {
        console.log("     docker exec -it owliabot owliabot auth setup anthropic");
      }
      if (useOpenaiCodex) {
        console.log("     docker exec -it owliabot owliabot auth setup openai-codex");
      }
      console.log("");
      console.log("  3. Check logs:");
    } else {
      console.log("  2. Check logs:");
    }
    console.log("     docker compose logs -f");
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
