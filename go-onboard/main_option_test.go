package main

import (
	"testing"
	"time"
)

func TestRecommendedProviderIndexDefaultsToClaude(t *testing.T) {
	if got := recommendedProviderIndex(nil); got != 0 {
		t.Fatalf("expected default recommendation index 0 (Claude), got %d", got)
	}
}

func TestRecommendedProviderIndexUsesDetectedCredentials(t *testing.T) {
	cases := []struct {
		name     string
		existing *ExistingConfig
		want     int
	}{
		{
			name:     "openai",
			existing: &ExistingConfig{OpenAIKey: "k"},
			want:     1,
		},
		{
			name:     "anthropic",
			existing: &ExistingConfig{AnthropicToken: "t"},
			want:     0,
		},
		{
			name:     "codex oauth",
			existing: &ExistingConfig{OpenAICodexOAuth: &OAuthSessionDetail{ExpiresKnown: true, ExpiresAt: time.Now().Add(2 * time.Hour)}},
			want:     2,
		},
		{
			name:     "compatible",
			existing: &ExistingConfig{OpenAICompatibleKey: "k"},
			want:     3,
		},
		{
			name:     "multiple connected providers",
			existing: &ExistingConfig{OpenAIKey: "k", AnthropicToken: "t"},
			want:     4,
		},
		{
			name:     "expired codex session falls back to claude",
			existing: &ExistingConfig{OpenAICodexOAuth: &OAuthSessionDetail{ExpiresKnown: true, ExpiresAt: time.Now().Add(-2 * time.Hour)}},
			want:     0,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := recommendedProviderIndex(tc.existing); got != tc.want {
				t.Fatalf("expected %d, got %d", tc.want, got)
			}
		})
	}
}

func TestDefaultWizardStepsIncludeMCPBeforeReview(t *testing.T) {
	for _, step := range defaultWizardSteps {
		if step == "Security" {
			t.Fatalf("security stage should not exist in docker onboarding steps: %v", defaultWizardSteps)
		}
	}
	expected := []string{"Welcome", "Provider", "Channels", "MCP", "Review", "Apply"}
	if len(defaultWizardSteps) != len(expected) {
		t.Fatalf("unexpected step count: got %d want %d (%v)", len(defaultWizardSteps), len(expected), defaultWizardSteps)
	}
	for i, step := range expected {
		if defaultWizardSteps[i] != step {
			t.Fatalf("unexpected step order at %d: got %q want %q", i, defaultWizardSteps[i], step)
		}
	}
}

func TestProviderOptionsIncludeSkipNow(t *testing.T) {
	options, details := providerStageMenu()
	if len(options) != len(details) {
		t.Fatalf("provider options/details length mismatch: %d vs %d", len(options), len(details))
	}
	if options[len(options)-1] != "Skip now" {
		t.Fatalf("expected final provider option to be Skip now, got %q", options[len(options)-1])
	}
}

func TestChannelOptionsIncludeSkipNow(t *testing.T) {
	options, details := channelStageMenu()
	if len(options) != len(details) {
		t.Fatalf("channel options/details length mismatch: %d vs %d", len(options), len(details))
	}
	if options[len(options)-1] != "Skip now" {
		t.Fatalf("expected final channel option to be Skip now, got %q", options[len(options)-1])
	}
}

func TestMCPStageMentionsAvailablePresets(t *testing.T) {
	presets := availableMCPPresets()
	found := false
	for _, preset := range presets {
		if preset == "playwright" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected playwright preset in MCP availability list, got %v", presets)
	}
	descriptions := mcpPresetDescriptions(presets)
	if len(descriptions) != len(presets) {
		t.Fatalf("expected descriptions for each preset, got %v for %v", descriptions, presets)
	}
	if len(descriptions) > 0 && descriptions[0] == "" {
		t.Fatalf("expected non-empty preset description, got %v", descriptions)
	}
}

func TestAskMultiSelectWithDetailsTogglesAndConfirms(t *testing.T) {
	w := newLineModeWizardSessionForTest(t, "1\n2\n3\n")
	selected, err := w.askMultiSelectWithDetails(
		"MCP",
		"Select MCP presets",
		[]string{"playwright", "custom"},
		[]string{"Playwright tools", "Custom tools"},
		nil,
		nil,
	)
	if err != nil {
		t.Fatalf("askMultiSelectWithDetails returned error: %v", err)
	}
	if len(selected) != 2 || selected[0] != 0 || selected[1] != 1 {
		t.Fatalf("unexpected selected indexes: %v", selected)
	}
}

func TestModelDefaultIndexUsesCustomWhenUnknown(t *testing.T) {
	presets := []modelPreset{
		{Value: "gpt-5.2"},
		{Value: "gpt-5"},
	}
	if got := modelDefaultIndex("gpt-4.1", presets); got != len(presets) {
		t.Fatalf("expected custom index %d, got %d", len(presets), got)
	}
	if got := modelDefaultIndex("gpt-5", presets); got != 1 {
		t.Fatalf("expected matched preset index 1, got %d", got)
	}
}

func TestShouldReuseChannelTokenWithoutPrompt(t *testing.T) {
	existing := &ExistingConfig{
		DiscordToken:  "discord-token",
		TelegramToken: "telegram-token",
	}

	if !shouldReuseChannelTokenWithoutPrompt(true, existing, existing.DiscordToken) {
		t.Fatalf("expected reuse=true to skip discord token prompt")
	}
	if !shouldReuseChannelTokenWithoutPrompt(true, existing, existing.TelegramToken) {
		t.Fatalf("expected reuse=true to skip telegram token prompt")
	}
	if shouldReuseChannelTokenWithoutPrompt(false, existing, existing.DiscordToken) {
		t.Fatalf("expected reuse=false not to skip prompt")
	}
	if shouldReuseChannelTokenWithoutPrompt(true, nil, "x") {
		t.Fatalf("expected nil existing config not to skip prompt")
	}
	if shouldReuseChannelTokenWithoutPrompt(true, existing, "") {
		t.Fatalf("expected empty token not to skip prompt")
	}
}
