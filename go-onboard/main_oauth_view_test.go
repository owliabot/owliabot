package main

import (
	"strings"
	"testing"
	"time"
)

func TestBuildOpenAICodexActionQuestionUsesWaitingPlaceholders(t *testing.T) {
	question := buildOpenAICodexActionQuestion(openAICodexDeviceLoginResult{})
	if !strings.Contains(question, "(waiting for URL)") {
		t.Fatalf("expected waiting URL placeholder, got %q", question)
	}
	if !strings.Contains(question, "(waiting for code)") {
		t.Fatalf("expected waiting code placeholder, got %q", question)
	}
}

func TestBuildOpenAICodexActionQuestionUsesDetectedValues(t *testing.T) {
	question := buildOpenAICodexActionQuestion(openAICodexDeviceLoginResult{
		VerificationURL: "https://auth.openai.com/codex/device",
		DeviceCode:      "WXYZ-9876",
	})
	if !strings.Contains(question, "https://auth.openai.com/codex/device") {
		t.Fatalf("expected verification URL in question, got %q", question)
	}
	if !strings.Contains(question, "WXYZ-9876") {
		t.Fatalf("expected device code in question, got %q", question)
	}
}

func TestBuildOpenAICodexActionHighlightsShowsWaitingFields(t *testing.T) {
	highlights := buildOpenAICodexActionHighlights(openAICodexDeviceLoginResult{})
	joined := strings.Join(highlights, "\n")
	if !strings.Contains(joined, "Open URL: waiting...") {
		t.Fatalf("expected waiting URL highlight, got %q", joined)
	}
	if !strings.Contains(joined, "Device code: waiting...") {
		t.Fatalf("expected waiting code highlight, got %q", joined)
	}
}

func TestBuildOpenAICodexResultHighlightsIncludesConnectionAndAccount(t *testing.T) {
	expires := time.Date(2026, 2, 21, 6, 45, 0, 0, time.UTC)
	highlights := buildOpenAICodexResultHighlights(openAICodexDeviceLoginResult{
		VerificationURL: "https://auth.openai.com/codex/device",
		DeviceCode:      "WXYZ-9876",
		Connected:       true,
		ExpiresAt:       expires,
		Email:           "demo@example.com",
	})
	joined := strings.Join(highlights, "\n")
	if !strings.Contains(joined, "Connection status: connected · expires 2026-02-21 06:45 UTC") {
		t.Fatalf("expected connected status with expiry, got %q", joined)
	}
	if !strings.Contains(joined, "Account: demo@example.com") {
		t.Fatalf("expected account line, got %q", joined)
	}
}

func TestBuildOpenAICodexResultHighlightsIncludesNotConnected(t *testing.T) {
	highlights := buildOpenAICodexResultHighlights(openAICodexDeviceLoginResult{Connected: false})
	joined := strings.Join(highlights, "\n")
	if !strings.Contains(joined, "Connection status: not connected") {
		t.Fatalf("expected not-connected status, got %q", joined)
	}
}

func TestApplyOpenAICodexOutputLinePopulatesURLAndStatus(t *testing.T) {
	result := openAICodexDeviceLoginResult{}
	statuses := applyOpenAICodexOutputLine(&result, "Open this URL in your browser and sign in: https://auth.openai.com/codex/device")
	if result.VerificationURL != "https://auth.openai.com/codex/device" {
		t.Fatalf("expected parsed verification url, got %q", result.VerificationURL)
	}
	if len(statuses) < 2 {
		t.Fatalf("expected two status updates, got %v", statuses)
	}
	if statuses[0] != "Device login URL is ready." {
		t.Fatalf("expected first status to announce URL readiness, got %q", statuses[0])
	}
	if statuses[1] != "Open the verification URL in your browser." {
		t.Fatalf("expected second status to guide browser action, got %q", statuses[1])
	}
}

func TestApplyOpenAICodexOutputLinePopulatesCodeAndKeepsExistingValues(t *testing.T) {
	result := openAICodexDeviceLoginResult{
		VerificationURL: "https://auth.openai.com/codex/device",
	}
	statuses := applyOpenAICodexOutputLine(&result, "Then enter this one-time code (valid for 15 minutes): WXYZ-9876")
	if result.VerificationURL != "https://auth.openai.com/codex/device" {
		t.Fatalf("expected existing URL to remain, got %q", result.VerificationURL)
	}
	if result.DeviceCode != "WXYZ-9876" {
		t.Fatalf("expected parsed device code, got %q", result.DeviceCode)
	}
	if len(statuses) < 2 {
		t.Fatalf("expected two status updates, got %v", statuses)
	}
	if statuses[0] != "Device code is ready." {
		t.Fatalf("expected first status to announce code readiness, got %q", statuses[0])
	}
	if statuses[1] != "Enter the device code in your browser." {
		t.Fatalf("expected second status to guide code entry, got %q", statuses[1])
	}
}
