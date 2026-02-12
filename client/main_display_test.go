package main

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestDisplayPathUsesTildeForHome(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		t.Skip("home not available in test environment")
	}
	got := displayPath(home + "/.owliabot")
	if got != "~/.owliabot" {
		t.Fatalf("expected tilde path, got %q", got)
	}
}

func TestDescribeExistingSignalsListsMaskedFields(t *testing.T) {
	expires := time.Date(2026, 2, 28, 10, 30, 0, 0, time.UTC)
	existing := &ExistingConfig{
		DiscordToken: "discord-secret",
		OpenAIKey:    "openai-secret",
		DetectedSecrets: []DetectedSecretEntry{
			{Path: "openai.apiKey", Value: "openai-secret"},
			{Path: "discord.token", Value: "discord-secret"},
		},
		OpenAICodexOAuth: &OAuthSessionDetail{
			ExpiresKnown: true,
			ExpiresAt:    expires,
			Email:        "demo@example.com",
		},
	}
	lines := describeExistingSignals(existing)
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "secrets.openai.apiKey") {
		t.Fatalf("expected openai secret field listing, got:\n%s", joined)
	}
	if !strings.Contains(joined, "secrets.discord.token") {
		t.Fatalf("expected discord secret field listing, got:\n%s", joined)
	}
	if strings.Contains(joined, "openai-secret") || strings.Contains(joined, "discord-secret") {
		t.Fatalf("credential values should be masked, got:\n%s", joined)
	}
	if !strings.Contains(joined, "auth.openai-codex") || !strings.Contains(joined, "2026-02-28") {
		t.Fatalf("expected oauth metadata with expiry date, got:\n%s", joined)
	}
}

func TestBuildExistingHighlightsUsesCalmTone(t *testing.T) {
	lines := buildExistingHighlights("~/.owliabot", &ExistingConfig{DiscordToken: "x"})
	joined := strings.Join(lines, "\n")
	if strings.Contains(joined, "!!!") {
		t.Fatalf("highlights should avoid alarm-style wording, got:\n%s", joined)
	}
	if !strings.Contains(joined, "Existing configuration detected") {
		t.Fatalf("expected calm detection message, got:\n%s", joined)
	}
	if !strings.Contains(joined, "Reuse saved settings or enter new values.") {
		t.Fatalf("expected plain-language next-step message, got:\n%s", joined)
	}
	if strings.Contains(strings.ToLower(joined), "config directory:") {
		t.Fatalf("welcome highlights should not show config directory path in key context, got:\n%s", joined)
	}
}
