package main

import (
	"strings"
	"testing"
	"time"
)

func TestHandleOpenAICodexOAuthNowRunsDeviceFlowAndChecksConnection(t *testing.T) {
	oldFlow := runOpenAICodexDeviceLoginWithUpdatesFn
	t.Cleanup(func() {
		runOpenAICodexDeviceLoginWithUpdatesFn = oldFlow
	})

	called := false
	runOpenAICodexDeviceLoginWithUpdatesFn = func(configDir string, _ func(openAICodexDeviceLoginResult)) (openAICodexDeviceLoginResult, error) {
		called = true
		return openAICodexDeviceLoginResult{
			VerificationURL: "https://auth.openai.com/device",
			DeviceCode:      "ABCD-1234",
			Connected:       true,
			ExpiresAt:       time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC),
			Email:           "demo@example.com",
		}, nil
	}

	w := newLineModeWizardSessionForTest(t, "\n")

	if err := handleOpenAICodexOAuthNow(w, "/tmp/owliabot-config"); err != nil {
		t.Fatalf("expected oauth prompt helper to succeed, got %v", err)
	}
	if !called {
		t.Fatalf("expected device login flow to run")
	}

	if !strings.Contains(strings.ToLower(w.lastView.Question), "connected") {
		t.Fatalf("expected connected status question, got %q", w.lastView.Question)
	}
	joinedHighlights := strings.Join(w.lastView.Highlights, "\n")
	if !strings.Contains(joinedHighlights, "https://auth.openai.com/device") {
		t.Fatalf("expected verification url in highlights, got %q", joinedHighlights)
	}
	if !strings.Contains(joinedHighlights, "ABCD-1234") {
		t.Fatalf("expected device code in highlights, got %q", joinedHighlights)
	}
}

func TestHandleOpenAICodexOAuthNowShowsDeviceCodeInsideWizardWhileWaiting(t *testing.T) {
	oldFlow := runOpenAICodexDeviceLoginWithUpdatesFn
	t.Cleanup(func() {
		runOpenAICodexDeviceLoginWithUpdatesFn = oldFlow
	})

	runOpenAICodexDeviceLoginWithUpdatesFn = func(configDir string, onUpdate func(openAICodexDeviceLoginResult)) (openAICodexDeviceLoginResult, error) {
		update := openAICodexDeviceLoginResult{
			VerificationURL: "https://auth.openai.com/codex/device",
			DeviceCode:      "WXYZ-9876",
		}
		if onUpdate != nil {
			onUpdate(update)
		}
		update.Connected = true
		update.ExpiresAt = time.Date(2026, 3, 2, 9, 0, 0, 0, time.UTC)
		return update, nil
	}

	w := newLineModeWizardSessionForTest(t, "\n")
	rendered := []popupView{}
	w.renderer = func(view popupView) {
		rendered = append(rendered, view)
	}

	if err := handleOpenAICodexOAuthNow(w, "/tmp/owliabot-config"); err != nil {
		t.Fatalf("expected oauth prompt helper to succeed, got %v", err)
	}

	found := false
	var waitingQuestion string
	var waitingHeadline string
	for _, view := range rendered {
		if !view.DisableInput {
			continue
		}
		if !strings.Contains(strings.ToLower(view.Question), "device code") {
			continue
		}
		joinedHighlights := strings.Join(view.Highlights, "\n")
		if strings.Contains(joinedHighlights, "https://auth.openai.com/codex/device") && strings.Contains(joinedHighlights, "WXYZ-9876") {
			waitingQuestion = view.Question
			waitingHeadline = view.HeadlineLabel
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected a waiting wizard view with device code and verification URL, got %d render(s)", len(rendered))
	}
	if !strings.Contains(waitingQuestion, "https://auth.openai.com/codex/device") {
		t.Fatalf("expected waiting question to include verification URL, got %q", waitingQuestion)
	}
	if !strings.Contains(waitingQuestion, "WXYZ-9876") {
		t.Fatalf("expected waiting question to include device code, got %q", waitingQuestion)
	}
	if waitingHeadline != "ACTION" {
		t.Fatalf("expected waiting state headline ACTION, got %q", waitingHeadline)
	}
}

func TestFirstDeviceCodeInTextIgnoresProviderSlug(t *testing.T) {
	got := firstDeviceCodeInText("2026-02-12 INFO Starting openai-codex OAuth flow")
	if got != "" {
		t.Fatalf("expected no device code, got %q", got)
	}
}

func TestFirstDeviceCodeInTextParsesUppercaseCode(t *testing.T) {
	got := firstDeviceCodeInText("Then enter this one-time code: WXYZ-9876")
	if got != "WXYZ-9876" {
		t.Fatalf("expected device code WXYZ-9876, got %q", got)
	}
}
