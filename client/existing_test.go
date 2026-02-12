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
	if err := os.WriteFile(filepath.Join(tmp, "auth", "anthropic.json"), []byte("{}"), 0o600); err != nil {
		t.Fatalf("write anthropic oauth: %v", err)
	}
	codexAuth := []byte(`{"expires":` + fmt.Sprintf("%d", expires) + `,"email":"demo@example.com"}`)
	if err := os.WriteFile(filepath.Join(tmp, "auth", "auth-openai-codex.json"), codexAuth, 0o600); err != nil {
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
