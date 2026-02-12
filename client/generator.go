package main

import (
	"errors"
	"fmt"
	"path"
	"path/filepath"
	"strconv"
	"strings"
)

type Answers struct {
	ProviderChoice               string
	AnthropicCredential          string
	AnthropicModel               string
	OpenAIKey                    string
	OpenAIModel                  string
	OpenAICodexModel             string
	OpenAICompatibleBaseURL      string
	OpenAICompatibleKey          string
	OpenAICompatibleModel        string
	ChannelChoice                string
	DiscordToken                 string
	TelegramToken                string
	DiscordChannelAllowList      []string
	DiscordMemberAllowList       []string
	TelegramAllowList            []string
	AdditionalWriteToolAllowList []string
	GatewayPort                  string
	GatewayToken                 string
	Timezone                     string
	EnableWriteToolsForAllowlist bool
	EnableMCP                    bool
	MCPPresets                   []string
}

type AppConfig struct {
	Workspace    string             `yaml:"workspace"`
	Timezone     string             `yaml:"timezone,omitempty"`
	Providers    []ProviderConfig   `yaml:"providers"`
	Discord      *DiscordConfig     `yaml:"discord,omitempty"`
	Telegram     *TelegramConfig    `yaml:"telegram,omitempty"`
	Gateway      *GatewayConfig     `yaml:"gateway,omitempty"`
	MemorySearch MemorySearchConfig `yaml:"memorySearch"`
	System       SystemCapability   `yaml:"system"`
	MCP          *MCPConfig         `yaml:"mcp,omitempty"`
	Tools        *ToolsConfig       `yaml:"tools,omitempty"`
	Security     *SecurityConfig    `yaml:"security,omitempty"`
}

type MCPConfig struct {
	AutoStart bool     `yaml:"autoStart"`
	Presets   []string `yaml:"presets,omitempty"`
}

type ProviderConfig struct {
	ID       string `yaml:"id"`
	Model    string `yaml:"model"`
	APIKey   string `yaml:"apiKey"`
	BaseURL  string `yaml:"baseUrl,omitempty"`
	Priority int    `yaml:"priority"`
}

type DiscordConfig struct {
	RequireMentionInGuild bool     `yaml:"requireMentionInGuild"`
	ChannelAllowList      []string `yaml:"channelAllowList,omitempty"`
	MemberAllowList       []string `yaml:"memberAllowList,omitempty"`
}

type TelegramConfig struct {
	AllowList []string `yaml:"allowList,omitempty"`
}

type GatewayConfig struct {
	HTTP *GatewayHTTP `yaml:"http"`
}

type GatewayHTTP struct {
	Host  string `yaml:"host"`
	Port  int    `yaml:"port"`
	Token string `yaml:"token,omitempty"`
}

type MemorySearchConfig struct {
	Enabled bool `yaml:"enabled"`
	Store   struct {
		Path string `yaml:"path"`
	} `yaml:"store"`
	Provider string   `yaml:"provider"`
	Fallback string   `yaml:"fallback"`
	Sources  []string `yaml:"sources"`
	Extra    []string `yaml:"extraPaths"`
	Indexing struct {
		AutoIndex     bool `yaml:"autoIndex"`
		MinIntervalMs int  `yaml:"minIntervalMs"`
	} `yaml:"indexing"`
}

type SystemCapability struct {
	Exec struct {
		CommandAllowList []string `yaml:"commandAllowList"`
		EnvAllowList     []string `yaml:"envAllowList"`
		TimeoutMs        int      `yaml:"timeoutMs"`
		MaxOutputBytes   int      `yaml:"maxOutputBytes"`
	} `yaml:"exec"`
	Web struct {
		DomainAllowList      []string `yaml:"domainAllowList"`
		DomainDenyList       []string `yaml:"domainDenyList"`
		AllowPrivateNetworks bool     `yaml:"allowPrivateNetworks"`
		TimeoutMs            int      `yaml:"timeoutMs"`
		MaxResponseBytes     int      `yaml:"maxResponseBytes"`
		BlockOnSecret        bool     `yaml:"blockOnSecret"`
	} `yaml:"web"`
	WebSearch struct {
		DefaultProvider string `yaml:"defaultProvider"`
		TimeoutMs       int    `yaml:"timeoutMs"`
		MaxResults      int    `yaml:"maxResults"`
	} `yaml:"webSearch"`
}

type ToolsConfig struct {
	AllowWrite bool `yaml:"allowWrite"`
}

type SecurityConfig struct {
	WriteGateEnabled             bool     `yaml:"writeGateEnabled"`
	WriteToolAllowList           []string `yaml:"writeToolAllowList"`
	WriteToolConfirmation        bool     `yaml:"writeToolConfirmation"`
	WriteToolConfirmationTimeout int      `yaml:"writeToolConfirmationTimeoutMs,omitempty"`
}

type SecretsConfig struct {
	Anthropic        *AnthropicSecret `yaml:"anthropic,omitempty"`
	OpenAI           *OpenAISecret    `yaml:"openai,omitempty"`
	OpenAICompatible *OpenAISecret    `yaml:"openai-compatible,omitempty"`
	Discord          *ChannelSecret   `yaml:"discord,omitempty"`
	Telegram         *ChannelSecret   `yaml:"telegram,omitempty"`
	Gateway          *GatewaySecret   `yaml:"gateway,omitempty"`
}

type AnthropicSecret struct {
	Token  string `yaml:"token,omitempty"`
	APIKey string `yaml:"apiKey,omitempty"`
}

type OpenAISecret struct {
	APIKey string `yaml:"apiKey,omitempty"`
}

type ChannelSecret struct {
	Token string `yaml:"token,omitempty"`
}

type GatewaySecret struct {
	Token string `yaml:"token,omitempty"`
}

const (
	defaultGatewayPort = 8787
)

var (
	readOnlyExecCommands = []string{
		"ls", "cat", "head", "tail", "grep", "find", "echo", "pwd", "wc",
		"date", "env", "which", "file", "stat", "du", "df",
	}
	writeExecCommands = []string{
		"rm", "mkdir", "touch", "mv", "cp",
	}
)

func BuildAppConfig(a Answers) AppConfig {
	cfg := AppConfig{
		Workspace: "/app/workspace",
		Timezone:  strings.TrimSpace(a.Timezone),
		Providers: buildProviders(a),
		Gateway: &GatewayConfig{
			HTTP: &GatewayHTTP{
				Host:  "0.0.0.0",
				Port:  8787,
				Token: "secrets",
			},
		},
	}
	if cfg.Timezone == "" {
		cfg.Timezone = "UTC"
	}

	cfg.MemorySearch.Enabled = true
	cfg.MemorySearch.Provider = "sqlite"
	cfg.MemorySearch.Fallback = "naive"
	cfg.MemorySearch.Sources = []string{"files"}
	cfg.MemorySearch.Extra = []string{}
	cfg.MemorySearch.Store.Path = "/app/workspace/memory/{agentId}.sqlite"
	cfg.MemorySearch.Indexing.AutoIndex = true
	cfg.MemorySearch.Indexing.MinIntervalMs = 5 * 60 * 1000

	cfg.System.Exec.CommandAllowList = append([]string{}, readOnlyExecCommands...)
	cfg.System.Exec.EnvAllowList = []string{"PATH", "HOME", "USER", "LANG", "LC_ALL"}
	cfg.System.Exec.TimeoutMs = 60000
	cfg.System.Exec.MaxOutputBytes = 256 * 1024
	cfg.System.Web.DomainAllowList = []string{}
	cfg.System.Web.DomainDenyList = []string{}
	cfg.System.Web.AllowPrivateNetworks = false
	cfg.System.Web.TimeoutMs = 15000
	cfg.System.Web.MaxResponseBytes = 512 * 1024
	cfg.System.Web.BlockOnSecret = true
	cfg.System.WebSearch.DefaultProvider = "duckduckgo"
	cfg.System.WebSearch.TimeoutMs = 15000
	cfg.System.WebSearch.MaxResults = 10

	if hasDiscord(a.ChannelChoice) {
		cfg.Discord = &DiscordConfig{
			RequireMentionInGuild: true,
			ChannelAllowList:      cloneSlice(a.DiscordChannelAllowList),
			MemberAllowList:       cloneSlice(a.DiscordMemberAllowList),
		}
	}

	if hasTelegram(a.ChannelChoice) {
		cfg.Telegram = &TelegramConfig{
			AllowList: cloneSlice(a.TelegramAllowList),
		}
	}

	if a.EnableWriteToolsForAllowlist {
		allowlist := DeriveWriteToolAllowList(
			a.DiscordMemberAllowList,
			a.TelegramAllowList,
			a.AdditionalWriteToolAllowList,
		)
		if len(allowlist) > 0 {
			cfg.Tools = &ToolsConfig{AllowWrite: true}
			cfg.Security = &SecurityConfig{
				WriteGateEnabled:      false,
				WriteToolAllowList:    allowlist,
				WriteToolConfirmation: false,
			}
			cfg.System.Exec.CommandAllowList = append(cfg.System.Exec.CommandAllowList, writeExecCommands...)
		}
	}

	if a.EnableMCP {
		presets := cloneSlice(a.MCPPresets)
		if len(presets) == 0 {
			presets = []string{"playwright"}
		}
		cfg.MCP = &MCPConfig{
			AutoStart: true,
			Presets:   presets,
		}
	}

	return cfg
}

func BuildSecrets(a Answers) SecretsConfig {
	sec := SecretsConfig{}

	if strings.TrimSpace(a.AnthropicCredential) != "" {
		sec.Anthropic = &AnthropicSecret{}
		if strings.HasPrefix(strings.TrimSpace(a.AnthropicCredential), "sk-ant-oat01-") {
			sec.Anthropic.Token = strings.TrimSpace(a.AnthropicCredential)
		} else {
			sec.Anthropic.APIKey = strings.TrimSpace(a.AnthropicCredential)
		}
	}
	if strings.TrimSpace(a.OpenAIKey) != "" {
		sec.OpenAI = &OpenAISecret{APIKey: strings.TrimSpace(a.OpenAIKey)}
	}
	if strings.TrimSpace(a.OpenAICompatibleKey) != "" {
		sec.OpenAICompatible = &OpenAISecret{APIKey: strings.TrimSpace(a.OpenAICompatibleKey)}
	}
	if hasDiscord(a.ChannelChoice) && strings.TrimSpace(a.DiscordToken) != "" {
		sec.Discord = &ChannelSecret{Token: strings.TrimSpace(a.DiscordToken)}
	}
	if hasTelegram(a.ChannelChoice) && strings.TrimSpace(a.TelegramToken) != "" {
		sec.Telegram = &ChannelSecret{Token: strings.TrimSpace(a.TelegramToken)}
	}
	if strings.TrimSpace(a.GatewayToken) != "" {
		sec.Gateway = &GatewaySecret{Token: strings.TrimSpace(a.GatewayToken)}
	}

	return sec
}

func BuildDockerComposeYAML(configDir string, timezone string, gatewayPort string, image string) (string, error) {
	cleanConfigDir := strings.TrimSpace(configDir)
	if cleanConfigDir == "" {
		return "", errors.New("config-dir cannot be empty")
	}
	if strings.TrimSpace(timezone) == "" {
		timezone = "UTC"
	}
	gateway, err := parseGatewayPort(gatewayPort)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(image) == "" {
		image = "ghcr.io/owliabot/owliabot:latest"
	}
	configSource := filepath.ToSlash(filepath.Clean(cleanConfigDir))
	workspaceSource := path.Join(configSource, "workspace")

	return fmt.Sprintf(`# docker-compose.yml for OwliaBot
# Generated by onboard-go

services:
  owliabot:
    image: ${OWLIABOT_IMAGE:-%s}
    container_name: owliabot
    restart: unless-stopped
    ports:
      - "127.0.0.1:%d:8787"
    volumes:
      - type: bind
        source: %s
        target: /home/owliabot/.owliabot
      - type: bind
        source: %s
        target: /app/workspace
    environment:
      TZ: %s
    command: ["start", "-c", "/home/owliabot/.owliabot/app.yaml"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8787/health"]
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 10s
`, image, gateway, quoteYAMLScalar(configSource), quoteYAMLScalar(workspaceSource), quoteYAMLScalar(strings.TrimSpace(timezone))), nil
}

func parseGatewayPort(raw string) (int, error) {
	portText := strings.TrimSpace(raw)
	if portText == "" {
		return defaultGatewayPort, nil
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		return 0, fmt.Errorf("gateway port must be numeric: %q", portText)
	}
	if port < 1 || port > 65535 {
		return 0, fmt.Errorf("gateway port out of range: %d", port)
	}
	return port, nil
}

func quoteYAMLScalar(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func buildProviders(a Answers) []ProviderConfig {
	var providers []ProviderConfig
	priority := 1

	addAnthropic := a.ProviderChoice == "anthropic" || a.ProviderChoice == "multiple"
	addOpenAI := a.ProviderChoice == "openai" || a.ProviderChoice == "multiple"
	addCodex := a.ProviderChoice == "openai-codex" || a.ProviderChoice == "multiple"
	addCompatible := a.ProviderChoice == "openai-compatible" || a.ProviderChoice == "multiple"

	if addAnthropic {
		model := strings.TrimSpace(a.AnthropicModel)
		if model == "" {
			model = "claude-opus-4-5"
		}
		apiKey := "env"
		if strings.TrimSpace(a.AnthropicCredential) != "" {
			apiKey = "secrets"
		}
		providers = append(providers, ProviderConfig{
			ID:       "anthropic",
			Model:    model,
			APIKey:   apiKey,
			Priority: priority,
		})
		priority++
	}

	if addOpenAI {
		model := strings.TrimSpace(a.OpenAIModel)
		if model == "" {
			model = "gpt-5.2"
		}
		apiKey := "env"
		if strings.TrimSpace(a.OpenAIKey) != "" {
			apiKey = "secrets"
		}
		providers = append(providers, ProviderConfig{
			ID:       "openai",
			Model:    model,
			APIKey:   apiKey,
			Priority: priority,
		})
		priority++
	}

	if addCodex {
		model := strings.TrimSpace(a.OpenAICodexModel)
		if model == "" {
			model = "gpt-5.2"
		}
		providers = append(providers, ProviderConfig{
			ID:       "openai-codex",
			Model:    model,
			APIKey:   "oauth",
			Priority: priority,
		})
		priority++
	}

	if addCompatible {
		model := strings.TrimSpace(a.OpenAICompatibleModel)
		if model == "" {
			model = "llama3.2"
		}
		baseURL := strings.TrimSpace(a.OpenAICompatibleBaseURL)
		if baseURL == "" {
			baseURL = "http://host.docker.internal:11434/v1"
		}
		apiKey := "none"
		if strings.TrimSpace(a.OpenAICompatibleKey) != "" {
			apiKey = "secrets"
		}
		providers = append(providers, ProviderConfig{
			ID:       "openai-compatible",
			Model:    model,
			APIKey:   apiKey,
			BaseURL:  baseURL,
			Priority: priority,
		})
		priority++
	}

	if len(providers) == 0 {
		providers = append(providers, ProviderConfig{
			ID:       "anthropic",
			Model:    "claude-opus-4-5",
			APIKey:   "env",
			Priority: 1,
		})
	}

	return providers
}

func hasDiscord(choice string) bool {
	return choice == "discord" || choice == "both"
}

func hasTelegram(choice string) bool {
	return choice == "telegram" || choice == "both"
}

func cloneSlice(values []string) []string {
	out := make([]string, 0, len(values))
	for _, v := range values {
		clean := strings.TrimSpace(v)
		if clean != "" {
			out = append(out, clean)
		}
	}
	return out
}

func RenderAppYAML(cfg AppConfig) string {
	var b strings.Builder
	b.WriteString("workspace: " + cfg.Workspace + "\n")
	if cfg.Timezone != "" {
		b.WriteString("timezone: " + cfg.Timezone + "\n")
	}

	b.WriteString("providers:\n")
	for _, p := range cfg.Providers {
		b.WriteString("  - id: " + p.ID + "\n")
		b.WriteString("    model: " + p.Model + "\n")
		if p.BaseURL != "" {
			b.WriteString("    baseUrl: " + p.BaseURL + "\n")
		}
		b.WriteString("    apiKey: " + p.APIKey + "\n")
		b.WriteString(fmt.Sprintf("    priority: %d\n", p.Priority))
	}

	if cfg.Discord != nil {
		b.WriteString("discord:\n")
		b.WriteString(fmt.Sprintf("  requireMentionInGuild: %t\n", cfg.Discord.RequireMentionInGuild))
		if len(cfg.Discord.ChannelAllowList) > 0 {
			b.WriteString("  channelAllowList:\n")
			for _, v := range cfg.Discord.ChannelAllowList {
				b.WriteString("    - \"" + v + "\"\n")
			}
		}
		if len(cfg.Discord.MemberAllowList) > 0 {
			b.WriteString("  memberAllowList:\n")
			for _, v := range cfg.Discord.MemberAllowList {
				b.WriteString("    - \"" + v + "\"\n")
			}
		}
	}

	if cfg.Telegram != nil {
		b.WriteString("telegram:\n")
		if len(cfg.Telegram.AllowList) > 0 {
			b.WriteString("  allowList:\n")
			for _, v := range cfg.Telegram.AllowList {
				b.WriteString("    - \"" + v + "\"\n")
			}
		}
	}

	if cfg.Gateway != nil && cfg.Gateway.HTTP != nil {
		b.WriteString("gateway:\n")
		b.WriteString("  http:\n")
		b.WriteString("    host: " + cfg.Gateway.HTTP.Host + "\n")
		b.WriteString(fmt.Sprintf("    port: %d\n", cfg.Gateway.HTTP.Port))
		if cfg.Gateway.HTTP.Token != "" {
			b.WriteString("    token: " + cfg.Gateway.HTTP.Token + "\n")
		}
	}

	b.WriteString("memorySearch:\n")
	b.WriteString(fmt.Sprintf("  enabled: %t\n", cfg.MemorySearch.Enabled))
	b.WriteString("  provider: " + cfg.MemorySearch.Provider + "\n")
	b.WriteString("  fallback: " + cfg.MemorySearch.Fallback + "\n")
	b.WriteString("  store:\n")
	b.WriteString("    path: " + cfg.MemorySearch.Store.Path + "\n")
	b.WriteString("  extraPaths: []\n")
	b.WriteString("  sources:\n")
	for _, src := range cfg.MemorySearch.Sources {
		b.WriteString("    - " + src + "\n")
	}
	b.WriteString("  indexing:\n")
	b.WriteString(fmt.Sprintf("    autoIndex: %t\n", cfg.MemorySearch.Indexing.AutoIndex))
	b.WriteString(fmt.Sprintf("    minIntervalMs: %d\n", cfg.MemorySearch.Indexing.MinIntervalMs))

	b.WriteString("system:\n")
	b.WriteString("  exec:\n")
	b.WriteString("    commandAllowList:\n")
	for _, cmd := range cfg.System.Exec.CommandAllowList {
		b.WriteString("      - " + cmd + "\n")
	}
	b.WriteString("    envAllowList:\n")
	for _, env := range cfg.System.Exec.EnvAllowList {
		b.WriteString("      - " + env + "\n")
	}
	b.WriteString(fmt.Sprintf("    timeoutMs: %d\n", cfg.System.Exec.TimeoutMs))
	b.WriteString(fmt.Sprintf("    maxOutputBytes: %d\n", cfg.System.Exec.MaxOutputBytes))
	b.WriteString("  web:\n")
	b.WriteString("    domainAllowList: []\n")
	b.WriteString("    domainDenyList: []\n")
	b.WriteString(fmt.Sprintf("    allowPrivateNetworks: %t\n", cfg.System.Web.AllowPrivateNetworks))
	b.WriteString(fmt.Sprintf("    timeoutMs: %d\n", cfg.System.Web.TimeoutMs))
	b.WriteString(fmt.Sprintf("    maxResponseBytes: %d\n", cfg.System.Web.MaxResponseBytes))
	b.WriteString(fmt.Sprintf("    blockOnSecret: %t\n", cfg.System.Web.BlockOnSecret))
	b.WriteString("  webSearch:\n")
	b.WriteString("    defaultProvider: " + cfg.System.WebSearch.DefaultProvider + "\n")
	b.WriteString(fmt.Sprintf("    timeoutMs: %d\n", cfg.System.WebSearch.TimeoutMs))
	b.WriteString(fmt.Sprintf("    maxResults: %d\n", cfg.System.WebSearch.MaxResults))

	if cfg.MCP != nil {
		b.WriteString("mcp:\n")
		b.WriteString(fmt.Sprintf("  autoStart: %t\n", cfg.MCP.AutoStart))
		if len(cfg.MCP.Presets) > 0 {
			b.WriteString("  presets:\n")
			for _, preset := range cfg.MCP.Presets {
				b.WriteString("    - " + preset + "\n")
			}
		}
	}

	if cfg.Tools != nil {
		b.WriteString("tools:\n")
		b.WriteString(fmt.Sprintf("  allowWrite: %t\n", cfg.Tools.AllowWrite))
	}

	if cfg.Security != nil {
		b.WriteString("security:\n")
		b.WriteString(fmt.Sprintf("  writeGateEnabled: %t\n", cfg.Security.WriteGateEnabled))
		b.WriteString("  writeToolAllowList:\n")
		for _, v := range cfg.Security.WriteToolAllowList {
			b.WriteString("    - \"" + v + "\"\n")
		}
		b.WriteString(fmt.Sprintf("  writeToolConfirmation: %t\n", cfg.Security.WriteToolConfirmation))
		if cfg.Security.WriteToolConfirmationTimeout > 0 {
			b.WriteString(fmt.Sprintf("  writeToolConfirmationTimeoutMs: %d\n", cfg.Security.WriteToolConfirmationTimeout))
		}
	}

	return b.String()
}

func RenderSecretsYAML(sec SecretsConfig) string {
	var b strings.Builder
	if sec.Anthropic != nil {
		b.WriteString("anthropic:\n")
		if sec.Anthropic.APIKey != "" {
			b.WriteString("  apiKey: \"" + sec.Anthropic.APIKey + "\"\n")
		}
		if sec.Anthropic.Token != "" {
			b.WriteString("  token: \"" + sec.Anthropic.Token + "\"\n")
		}
	}
	if sec.OpenAI != nil && sec.OpenAI.APIKey != "" {
		b.WriteString("openai:\n")
		b.WriteString("  apiKey: \"" + sec.OpenAI.APIKey + "\"\n")
	}
	if sec.OpenAICompatible != nil && sec.OpenAICompatible.APIKey != "" {
		b.WriteString("openai-compatible:\n")
		b.WriteString("  apiKey: \"" + sec.OpenAICompatible.APIKey + "\"\n")
	}
	if sec.Discord != nil && sec.Discord.Token != "" {
		b.WriteString("discord:\n")
		b.WriteString("  token: \"" + sec.Discord.Token + "\"\n")
	}
	if sec.Telegram != nil && sec.Telegram.Token != "" {
		b.WriteString("telegram:\n")
		b.WriteString("  token: \"" + sec.Telegram.Token + "\"\n")
	}
	if sec.Gateway != nil && sec.Gateway.Token != "" {
		b.WriteString("gateway:\n")
		b.WriteString("  token: \"" + sec.Gateway.Token + "\"\n")
	}
	if b.Len() == 0 {
		return "{}\n"
	}
	return b.String()
}
