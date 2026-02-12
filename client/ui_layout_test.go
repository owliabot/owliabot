package main

import (
	"strings"
	"testing"
)

func TestBuildStepColumnShowsNumberedJourney(t *testing.T) {
	lines := buildStepColumn([]string{"Welcome", "Provider", "Channels"}, 1, "Provider", 24)
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "1.") || !strings.Contains(joined, "2.") || !strings.Contains(joined, "3.") {
		t.Fatalf("expected numbered journey items, got:\n%s", joined)
	}
	if !strings.Contains(joined, "✓") || !strings.Contains(joined, "▶") || !strings.Contains(joined, "·") {
		t.Fatalf("expected journey status markers (done/current/pending), got:\n%s", joined)
	}
}

func TestBuildStepColumnFallbackOmitsSecurity(t *testing.T) {
	lines := buildStepColumn(nil, 0, "Welcome", 24)
	joined := stripANSI(strings.Join(lines, "\n"))
	if strings.Contains(joined, "Security") {
		t.Fatalf("fallback journey should not include Security stage, got:\n%s", joined)
	}
	if !strings.Contains(joined, "Review") || !strings.Contains(joined, "Apply") {
		t.Fatalf("fallback journey should include review/apply stages, got:\n%s", joined)
	}
}

func TestBuildStepColumnUsesFullWidthProgressBar(t *testing.T) {
	const colWidth = 24
	lines := buildStepColumn([]string{"Welcome", "Provider", "Channels", "Security"}, 1, "Provider", colWidth)
	if len(lines) < 3 {
		t.Fatalf("expected progress lines, got: %v", lines)
	}
	barPlain := stripANSI(lines[2])
	if strings.Contains(barPlain, "[") || strings.Contains(barPlain, "]") {
		t.Fatalf("progress bar should not use brackets, got: %q", barPlain)
	}
	if len([]rune(barPlain)) != colWidth {
		t.Fatalf("expected full-width progress bar line length %d, got %d (%q)", colWidth, len([]rune(barPlain)), barPlain)
	}
	if !strings.Contains(lines[2], "[48;5;252m") || !strings.Contains(lines[2], "[48;5;249m") || !strings.Contains(lines[2], "[48;5;238m") {
		t.Fatalf("expected gradient progress bar segments, got: %q", lines[2])
	}
}

func TestComposePopupShowsJourneyProgressBar(t *testing.T) {
	layout := composePopup(
		popupView{
			StepIndex:  1,
			TotalSteps: 6,
			StepTitle:  "Provider",
			Steps:      []string{"Welcome", "Provider", "Channels", "Security", "Review", "Apply"},
			Question:   "Which provider should I use?",
			Options:    []string{"Anthropic", "OpenAI"},
		},
		120,
		40,
	)
	foundProgress := false
	for _, line := range layout.Lines {
		plain := stripANSI(line)
		if strings.Contains(plain, "Progress") || strings.Contains(plain, "Step 2 of 6") {
			foundProgress = true
			break
		}
	}
	if !foundProgress {
		t.Fatalf("expected journey progress bar metadata, got:\n%s", strings.Join(layout.Lines, "\n"))
	}
}

func TestComposePopupRemovesTopStepMetaRow(t *testing.T) {
	layout := composePopup(
		popupView{
			StepIndex:  0,
			TotalSteps: 5,
			StepTitle:  "Welcome",
			Steps:      []string{"Welcome", "Provider", "Channels", "Review", "Apply"},
			Question:   "Welcome question",
		},
		120,
		40,
	)
	joined := stripANSI(strings.Join(layout.Lines, "\n"))
	if strings.Contains(joined, "Step 1/5  Welcome") {
		t.Fatalf("top step meta row should be removed, got:\n%s", joined)
	}
}

func TestComposePopupPlacesInputCursorInsideCard(t *testing.T) {
	layout := composePopup(
		popupView{
			StepIndex:  2,
			TotalSteps: 6,
			StepTitle:  "Channels",
			Steps:      []string{"Welcome", "Provider", "Channels", "Security", "Review", "Apply"},
			Question:   "Which channels should be enabled?",
			Options:    []string{"Discord", "Telegram", "Both"},
		},
		130,
		42,
	)
	if layout.InputAbsRow <= 0 || layout.InputAbsCol <= 0 {
		t.Fatalf("input cursor should be positioned, got row=%d col=%d", layout.InputAbsRow, layout.InputAbsCol)
	}
	if layout.InputAbsCol <= layout.LeftPad+2 {
		t.Fatalf("input cursor should be inside card content, got row=%d col=%d leftPad=%d", layout.InputAbsRow, layout.InputAbsCol, layout.LeftPad)
	}
}

func TestComposePopupFitsSmallTerminal(t *testing.T) {
	layout := composePopup(
		popupView{
			StepIndex:    1,
			TotalSteps:   6,
			StepTitle:    "Provider",
			Steps:        []string{"Welcome", "Provider", "Channels", "Security", "Review", "Apply"},
			Question:     "OpenAI API key (leave blank to use env vars)",
			ContextLines: []string{"Assistant: Existing configuration detected."},
			Options:      []string{"Anthropic", "OpenAI", "OpenAI Codex (OAuth)", "OpenAI-compatible", "Multiple providers"},
		},
		88,
		30,
	)
	for _, line := range layout.Lines {
		if visibleLen(line)+layout.LeftPad > 88 {
			t.Fatalf("line exceeds terminal width: width=%d line=%q", visibleLen(line)+layout.LeftPad, stripANSI(line))
		}
	}
}

func TestComposePopupKeepsRightBorderAlignedForLongOptionCopy(t *testing.T) {
	layout := composePopup(
		popupView{
			StepIndex:  1,
			TotalSteps: 6,
			StepTitle:  "Provider",
			Steps:      []string{"Welcome", "Provider", "Channels", "Security", "Review", "Apply"},
			Question:   "Which AI provider should OwliaBot use?",
			Options: []string{
				"Anthropic (Claude)",
				"OpenAI",
				"OpenAI Codex (OAuth)",
				"OpenAI-compatible",
				"Multiple providers (fallback chain)",
			},
			OptionDetails: []string{
				"Fastest to start with Claude using a key or setup token.",
				"Recommended for most teams with broad model options.",
				"Sign in with OAuth for team-friendly account management.",
				"Use self-hosted or third-party OpenAI-compatible endpoints.",
				"Automatic fallback across providers (trade-offs: cost and consistency).",
			},
			Recommended: 1,
		},
		220,
		44,
	)

	expected := layout.OuterWidth
	for i, line := range layout.Lines {
		if got := visibleLen(line); got != expected {
			t.Fatalf("line %d width mismatch: expected %d, got %d\nline: %q", i, expected, got, stripANSI(line))
		}
	}
}

func TestMainAreaShowsOnlyQuestionAndKeyContext(t *testing.T) {
	layout := composePopup(
		popupView{
			StepIndex:    0,
			TotalSteps:   6,
			StepTitle:    "Welcome",
			Steps:        []string{"Welcome", "Provider", "Channels", "Security", "Review", "Apply"},
			Question:     "Do you want to reuse existing credentials?",
			Highlights:   []string{"Detected existing configuration", "Saved Discord connection detected", "Config directory: ~/.owliabot", "Saved OpenAI connection detected"},
			ContextLines: []string{"Assistant: I'll guide you through Docker onboarding."},
		},
		128,
		38,
	)
	joined := stripANSI(strings.Join(layout.Lines, "\n"))
	if strings.Contains(joined, "Details") || strings.Contains(joined, "Conversation") {
		t.Fatalf("main area should not render details or conversation sections, got:\n%s", joined)
	}
}

func TestMainAreaUsesKeyNotesLabelAndShowsFiveItems(t *testing.T) {
	lines := buildRightColumn(
		popupView{
			Question: "Question",
			Highlights: []string{
				"Existing configuration detected",
				"secrets.discord.token: disc...oken",
				"auth.openai-codex: expires 2026-02-21",
				"secrets.openai.apiKey: sk-...1234",
				"secrets.telegram.token: tele...9999",
				"secrets.gateway.token: gate...0000",
			},
		},
		80,
		6,
		8,
	)
	joined := stripANSI(strings.Join(lines, "\n"))
	if !strings.Contains(joined, "Key Notes") {
		t.Fatalf("expected Key Notes label, got:\n%s", joined)
	}
	if strings.Contains(joined, "Key Context") {
		t.Fatalf("legacy Key Context label should not appear, got:\n%s", joined)
	}
	if !strings.Contains(joined, "secrets.telegram.token") {
		t.Fatalf("expected up to 5 key notes to be visible, got:\n%s", joined)
	}
	if strings.Contains(joined, "secrets.gateway.token") {
		t.Fatalf("should cap key notes to 5 visible items, got:\n%s", joined)
	}
}

func TestMainAreaUsesStatusLabelWhenInputDisabled(t *testing.T) {
	lines := buildRightColumn(
		popupView{
			Question:     "Pulling Docker image...",
			Highlights:   []string{"Image: ghcr.io/owliabot/owliabot:latest"},
			DisableInput: true,
			Spinner:      "Downloading layers...",
		},
		80,
		6,
		8,
	)
	joined := stripANSI(strings.Join(lines, "\n"))
	if !strings.Contains(joined, "STATUS") {
		t.Fatalf("expected STATUS label for non-question state, got:\n%s", joined)
	}
	if strings.Contains(joined, "QUESTION") {
		t.Fatalf("did not expect QUESTION label for non-question state, got:\n%s", joined)
	}
}

func TestMainAreaUsesActionLabelWhenRequested(t *testing.T) {
	lines := buildRightColumn(
		popupView{
			Question:      "Open https://auth.openai.com/codex/device and enter device code WXYZ-9876.",
			Highlights:    []string{"Open URL: https://auth.openai.com/codex/device", "Device code: WXYZ-9876"},
			DisableInput:  true,
			HeadlineLabel: "ACTION",
		},
		80,
		6,
		8,
	)
	joined := stripANSI(strings.Join(lines, "\n"))
	if !strings.Contains(joined, "ACTION") {
		t.Fatalf("expected ACTION label, got:\n%s", joined)
	}
	if strings.Contains(joined, "STATUS") {
		t.Fatalf("did not expect STATUS label when ACTION explicitly requested, got:\n%s", joined)
	}
}

func TestComposePopupUsesCompactRowsForShortOptions(t *testing.T) {
	layout := composePopup(
		popupView{
			StepIndex:  1,
			TotalSteps: 6,
			StepTitle:  "Provider",
			Steps:      []string{"Welcome", "Provider", "Channels", "Security", "Review", "Apply"},
			Question:   "Which AI provider should OwliaBot use?",
			Options:    []string{"Anthropic", "OpenAI", "OpenAI Codex (OAuth)", "OpenAI-compatible", "Multiple providers"},
			OptionDetails: []string{
				"Claude-first setup.",
				"Recommended for most teams.",
				"OAuth login flow.",
				"Self-hosted compatible APIs.",
				"Fallback chain.",
			},
			Recommended: 1,
		},
		132,
		40,
	)
	joined := stripANSI(strings.Join(layout.Lines, "\n"))
	if strings.Contains(joined, "╔") || strings.Contains(joined, "╚") {
		t.Fatalf("short option lists should use compact rows, got:\n%s", joined)
	}
	if !strings.Contains(joined, "★ Recommended") {
		t.Fatalf("expected recommended marker in compact rows, got:\n%s", joined)
	}
}

func TestSelectHighlightsKeepsExistingConfigAlert(t *testing.T) {
	highlights := []string{
		"Existing configuration detected",
		"Location: /Users/demo/.owliabot",
		"Anthropic API key found",
		"Discord token found",
		"OpenAI Codex OAuth token file found",
	}
	selected := selectHighlights(highlights, 3)
	if len(selected) != 3 {
		t.Fatalf("unexpected selection length: %v", selected)
	}
	if selected[0] != highlights[0] {
		t.Fatalf("expected first alert line to remain visible, got: %v", selected)
	}
}
