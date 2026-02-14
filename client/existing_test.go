package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDetectExistingConfigFromSecretsAndAuth(t *testing.T) {
	tmp := t.TempDir()
	expires := time.Now().Add(6 * time.Hour).UnixMilli()
	secrets := `anthropic:
  apiKey: "sk-ant-api03-demo"
  token: "sk-ant-oat01-demo"
openai:
  apiKey: "sk-openai-demo"
openai-compatible:
  apiKey: "compat-demo"
discord:
  token: "discord-demo"
telegram:
  token: "telegram-demo"
gateway:
  token: "gateway-demo"
`
	if err := os.WriteFile(filepath.Join(tmp, "secrets.yaml"), []byte(secrets), 0o600); err != nil {
		t.Fatalf("write secrets: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(tmp, "auth"), 0o755); err != nil {
		t.Fatalf("mkdir auth: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "auth", "anthropic.json"), []byte("{}"), 0o644); err != nil {
		t.Fatalf("write anthropic oauth: %v", err)
	}
	codexAuth := []byte(`{"expires":` + fmt.Sprintf("%d", expires) + `,"email":"demo@example.com"}`)
	if err := os.WriteFile(filepath.Join(tmp, "auth", "auth-openai-codex.json"), codexAuth, 0o644); err != nil {
		t.Fatalf("write codex oauth: %v", err)
	}

	existing, err := DetectExistingConfig(tmp)
	if err != nil {
		t.Fatalf("detect existing: %v", err)
	}
	if existing == nil {
		t.Fatalf("expected existing config")
	}
	if existing.AnthropicAPIKey == "" || existing.AnthropicToken == "" {
		t.Fatalf("expected anthropic secrets: %+v", existing)
	}
	if existing.OpenAIKey == "" || existing.OpenAICompatibleKey == "" {
		t.Fatalf("expected openai secrets: %+v", existing)
	}
	if existing.DiscordToken == "" || existing.TelegramToken == "" || existing.GatewayToken == "" {
		t.Fatalf("expected channel and gateway secrets: %+v", existing)
	}
	if !existing.HasOAuthAnthropic || !existing.HasOAuthCodex {
		t.Fatalf("expected oauth markers: %+v", existing)
	}
	if len(existing.DetectedSecrets) == 0 {
		t.Fatalf("expected detected secrets detail entries")
	}
	if existing.OpenAICodexOAuth == nil {
		t.Fatalf("expected codex oauth detail")
	}
	if !existing.OpenAICodexOAuth.ExpiresKnown {
		t.Fatalf("expected codex oauth expires metadata to be known")
	}
	if existing.OpenAICodexOAuth.ExpiresAt.UnixMilli() != expires {
		t.Fatalf("unexpected oauth expires value: got %d want %d", existing.OpenAICodexOAuth.ExpiresAt.UnixMilli(), expires)
	}
}

func TestDetectExistingConfigReadsAppSettings(t *testing.T) {
	tmp := t.TempDir()
	app := "" +
		"timezone: Asia/Tokyo\n" +
		"providers:\n" +
		"  - id: anthropic\n    model: claude-opus-4-5\n    apiKey: env\n    priority: 1\n" +
		"  - id: openai\n    model: gpt-5.2\n    apiKey: env\n    priority: 2\n" +
		"  - id: openai-codex\n    model: gpt-5\n    apiKey: env\n    priority: 3\n" +
		"  - id: openai-compatible\n    model: llama3.2\n    baseUrl: https://example.test/v1\n    apiKey: env\n    priority: 4\n" +
		"discord:\n  requireMentionInGuild: true\n  channelAllowList:\n    - \"123\"\n  memberAllowList:\n    - \"789\"\n" +
		"telegram:\n  allowList:\n    - \"456\"\n" +
		"gateway:\n  http:\n    port: 9999\n" +
		"security:\n  writeToolAllowList:\n    - \"789\"\n"
	if err := os.WriteFile(filepath.Join(tmp, "app.yaml"), []byte(app), 0o644); err != nil {
		t.Fatal(err)
	}

	existing, err := DetectExistingConfig(tmp)
	if err != nil || existing == nil {
		t.Fatalf("unexpected: %v", err)
	}
	if existing.Timezone != "Asia/Tokyo" {
		t.Fatalf("timezone missing")
	}
	if existing.OpenAICompatibleBaseURL != "https://example.test/v1" {
		t.Fatalf("baseUrl missing")
	}
	if existing.AnthropicModel != "claude-opus-4-5" {
		t.Fatalf("anthropic model missing")
	}
	if existing.OpenAIModel != "gpt-5.2" {
		t.Fatalf("openai model missing")
	}
	if existing.OpenAICodexModel != "gpt-5" {
		t.Fatalf("openai-codex model missing")
	}
	if existing.OpenAICompatibleModel != "llama3.2" {
		t.Fatalf("openai-compatible model missing")
	}
	if len(existing.DiscordChannelAllowList) != 1 || existing.DiscordChannelAllowList[0] != "123" {
		t.Fatalf("discord channel allowlist missing")
	}
	if len(existing.DiscordMemberAllowList) != 1 || existing.DiscordMemberAllowList[0] != "789" {
		t.Fatalf("discord member allowlist missing")
	}
	if len(existing.TelegramAllowList) != 1 || existing.TelegramAllowList[0] != "456" {
		t.Fatalf("telegram allowlist missing")
	}
	if existing.GatewayPort != "9999" {
		t.Fatalf("gateway port missing")
	}

	answers := Answers{
		Timezone:                     "UTC",
		OpenAICompatibleBaseURL:      "http://host.docker.internal:11434/v1",
		AnthropicModel:               "claude-haiku-3-5",
		OpenAIModel:                  "gpt-4.1",
		OpenAICodexModel:             "gpt-4.1",
		OpenAICompatibleModel:        "qwen2.5:14b",
		GatewayPort:                  "8787",
		EnableWriteToolsForAllowlist: false,
	}
	applyExistingAppSettings(existing, &answers)

	if answers.Timezone != "Asia/Tokyo" {
		t.Fatalf("timezone not reused")
	}
	if answers.OpenAICompatibleBaseURL != "https://example.test/v1" {
		t.Fatalf("baseUrl not reused")
	}
	if answers.AnthropicModel != "claude-opus-4-5" {
		t.Fatalf("anthropic model not reused")
	}
	if answers.OpenAIModel != "gpt-5.2" {
		t.Fatalf("openai model not reused")
	}
	if answers.OpenAICodexModel != "gpt-5" {
		t.Fatalf("openai-codex model not reused")
	}
	if answers.OpenAICompatibleModel != "llama3.2" {
		t.Fatalf("openai-compatible model not reused")
	}
	if len(answers.DiscordChannelAllowList) != 1 || answers.DiscordChannelAllowList[0] != "123" {
		t.Fatalf("discord channel allowlist not reused")
	}
	if len(answers.DiscordMemberAllowList) != 1 || answers.DiscordMemberAllowList[0] != "789" {
		t.Fatalf("discord member allowlist not reused")
	}
	if len(answers.TelegramAllowList) != 1 || answers.TelegramAllowList[0] != "456" {
		t.Fatalf("telegram allowlist not reused")
	}
	if answers.GatewayPort != "9999" {
		t.Fatalf("gateway port not reused")
	}
	if !answers.EnableWriteToolsForAllowlist {
		t.Fatalf("write tool allowlist not reused")
	}
}

func TestDetectExistingConfigReturnsNilWhenNoSignals(t *testing.T) {
	tmp := t.TempDir()
	existing, err := DetectExistingConfig(tmp)
	if err != nil {
		t.Fatalf("detect existing: %v", err)
	}
	if existing != nil {
		t.Fatalf("expected nil existing config, got: %+v", existing)
	}
}
