package main

import (
	"strings"
	"testing"
)

func TestBuildDockerArtifacts(t *testing.T) {
	answers := Answers{
		ProviderChoice:               "anthropic",
		AnthropicCredential:          "sk-ant-oat01-demo",
		AnthropicModel:               "claude-opus-4-1",
		ChannelChoice:                "both",
		DiscordToken:                 "discord-demo-token",
		TelegramToken:                "telegram-demo-token",
		DiscordChannelAllowList:      []string{"123", "456"},
		DiscordMemberAllowList:       []string{"111"},
		TelegramAllowList:            []string{"222"},
		GatewayPort:                  "8789",
		GatewayToken:                 "gateway-demo",
		Timezone:                     "Asia/Shanghai",
		EnableWriteToolsForAllowlist: true,
		EnableMCP:                    true,
		MCPPresets:                   []string{"playwright"},
	}

	cfg := BuildAppConfig(answers)
	if cfg.Workspace != "/app/workspace" {
		t.Fatalf("workspace mismatch: %s", cfg.Workspace)
	}
	if len(cfg.Providers) != 1 || cfg.Providers[0].ID != "anthropic" {
		t.Fatalf("unexpected providers: %+v", cfg.Providers)
	}
	if cfg.Gateway == nil || cfg.Gateway.HTTP == nil || cfg.Gateway.HTTP.Port != 8787 {
		t.Fatalf("gateway defaults not applied: %+v", cfg.Gateway)
	}
	if cfg.Discord == nil || len(cfg.Discord.ChannelAllowList) != 2 {
		t.Fatalf("discord allowlist missing: %+v", cfg.Discord)
	}
	if cfg.Security == nil || len(cfg.Security.WriteToolAllowList) != 2 {
		t.Fatalf("security allowlist not derived: %+v", cfg.Security)
	}
	if cfg.MCP == nil || !cfg.MCP.AutoStart || len(cfg.MCP.Presets) != 1 || cfg.MCP.Presets[0] != "playwright" {
		t.Fatalf("mcp config missing or invalid: %+v", cfg.MCP)
	}

	secrets := BuildSecrets(answers)
	if secrets.Gateway == nil || secrets.Gateway.Token != "gateway-demo" {
		t.Fatalf("gateway secret missing: %+v", secrets.Gateway)
	}
	if secrets.Anthropic == nil || secrets.Anthropic.Token == "" {
		t.Fatalf("anthropic secret missing: %+v", secrets.Anthropic)
	}
	if secrets.Discord == nil || secrets.Telegram == nil {
		t.Fatalf("channel tokens missing: %+v %+v", secrets.Discord, secrets.Telegram)
	}
}

func TestRenderAppYAMLIncludesMCPSectionWhenEnabled(t *testing.T) {
	answers := Answers{
		ProviderChoice: "openai",
		OpenAIModel:    "gpt-5.2",
		ChannelChoice:  "none",
		EnableMCP:      true,
		MCPPresets:     []string{"playwright"},
	}

	yaml := RenderAppYAML(BuildAppConfig(answers))
	if !strings.Contains(yaml, "mcp:") {
		t.Fatalf("expected mcp block, got:\n%s", yaml)
	}
	if !strings.Contains(yaml, "presets:") || !strings.Contains(yaml, "- playwright") {
		t.Fatalf("expected playwright preset in mcp block, got:\n%s", yaml)
	}
}

func TestBuildDockerComposeYAML(t *testing.T) {
	compose := BuildDockerComposeYAML("/Users/demo/.owliabot", "Asia/Shanghai", "8789", "ghcr.io/owliabot/owliabot:latest")
	if !strings.Contains(compose, "127.0.0.1:8789:8787") {
		t.Fatalf("expected mapped gateway port, got:\n%s", compose)
	}
	if !strings.Contains(compose, "TZ=Asia/Shanghai") {
		t.Fatalf("expected timezone env, got:\n%s", compose)
	}
	if !strings.Contains(compose, "/Users/demo/.owliabot:/home/owliabot/.owliabot") {
		t.Fatalf("expected config mount, got:\n%s", compose)
	}
}
