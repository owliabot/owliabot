package main

import (
	"strings"
	"testing"
)

func TestBuildFooterLinesRendersOptionCards(t *testing.T) {
	view := popupView{
		Options:   []string{"Start initialization", "Cancel"},
		InputHint: "Input",
	}
	lines := buildFooterLines(view, 64)
	joined := strings.Join(lines, "\n")

	if !strings.Contains(joined, "Options") {
		t.Fatalf("expected options header, got:\n%s", joined)
	}
	if !strings.Contains(joined, "╭") || !strings.Contains(joined, "╰") {
		t.Fatalf("expected card borders for options, got:\n%s", joined)
	}
	if !strings.Contains(joined, "1") || !strings.Contains(joined, "2") {
		t.Fatalf("expected numbered options, got:\n%s", joined)
	}
}

func TestBuildFooterLinesIncludesKeyboardHint(t *testing.T) {
	view := popupView{InputHint: "Type number and press Enter"}
	lines := buildFooterLines(view, 50)
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "Type number and press Enter") {
		t.Fatalf("expected keyboard hint, got:\n%s", joined)
	}
}

func TestBuildFooterLinesHighlightsSelectedOption(t *testing.T) {
	view := popupView{
		Options:        []string{"Anthropic", "OpenAI", "OpenAI Codex"},
		SelectedOption: 1,
	}
	lines := buildFooterLines(view, 72)
	joined := strings.Join(lines, "\n")
	if !strings.Contains(stripANSI(joined), "▶") || !strings.Contains(stripANSI(joined), "[2] OpenAI") {
		t.Fatalf("expected selected row highlight marker, got:\n%s", joined)
	}
}

func TestBuildFooterLinesShowsInputBuffer(t *testing.T) {
	view := popupView{
		Options:    []string{"Yes", "No"},
		InputValue: "2",
	}
	lines := buildFooterLines(view, 60)
	joined := stripANSI(strings.Join(lines, "\n"))
	if !strings.Contains(joined, "Input > 2") {
		t.Fatalf("expected input buffer in prompt, got:\n%s", joined)
	}
}

func TestBuildFooterLinesOmitsLegacyKeyHintBarForOptions(t *testing.T) {
	view := popupView{
		Options:   []string{"Yes", "No"},
		InputHint: "Type number and press Enter",
	}
	lines := buildFooterLines(view, 72)
	joined := stripANSI(strings.Join(lines, "\n"))
	if strings.Contains(joined, "Select") || strings.Contains(joined, "Confirm") || strings.Contains(joined, "Esc Back") {
		t.Fatalf("legacy key hint bar should be removed, got:\n%s", joined)
	}
}

func TestBuildFooterLinesKeepsInputHintForOptions(t *testing.T) {
	view := popupView{
		Options:   []string{"Yes", "No"},
		InputHint: "Use arrows to choose, Enter to confirm (number shortcuts work).",
	}
	lines := buildFooterLines(view, 100)
	joined := stripANSI(strings.Join(lines, "\n"))
	if !strings.Contains(joined, "Use arrows to choose, Enter to confirm (number shortcuts work).") {
		t.Fatalf("expected input hint to remain visible, got:\n%s", joined)
	}
}

func TestBuildFooterLinesOmitsLegacyKeyHintBarInLineMode(t *testing.T) {
	view := popupView{
		Options:   []string{"Yes", "No"},
		InputHint: "Type up/down or number + Enter to confirm",
		LineMode:  true,
	}
	lines := buildFooterLines(view, 90)
	joined := stripANSI(strings.Join(lines, "\n"))
	if strings.Contains(joined, "Select") || strings.Contains(joined, "Confirm") || strings.Contains(joined, "Esc Back") {
		t.Fatalf("legacy key hint bar should be removed in line mode, got:\n%s", joined)
	}
}

func TestBuildFooterLinesHidesInputPromptForSelectionMode(t *testing.T) {
	view := popupView{
		Options:      []string{"Yes", "No"},
		InputHint:    "Use arrows to choose, Enter to confirm (number shortcuts work).",
		DisableInput: true,
	}
	lines := buildFooterLines(view, 90)
	joined := stripANSI(strings.Join(lines, "\n"))
	if strings.Contains(joined, "Input >") {
		t.Fatalf("selection mode should not render input prompt, got:\n%s", joined)
	}
}

func TestBuildFooterLinesHidesReconnectNotice(t *testing.T) {
	view := popupView{
		Options:    []string{"Yes", "No"},
		InputValue: "1",
		ErrorText:  "Session restored.",
	}
	lines := buildFooterLines(view, 100)
	joined := stripANSI(strings.Join(lines, "\n"))
	if strings.Contains(joined, "Session restored.") {
		t.Fatalf("reconnect notice should be hidden from UI, got:\n%s", joined)
	}
}

func TestBuildFooterLinesRendersOptionDescriptionAndRecommended(t *testing.T) {
	view := popupView{
		Options:       []string{"OpenAI", "Anthropic"},
		OptionDetails: []string{"Recommended for most teams.", "Fastest for Claude-first setups."},
		Recommended:   0,
	}
	lines := buildFooterLines(view, 78)
	joined := stripANSI(strings.Join(lines, "\n"))
	if !strings.Contains(joined, "Recommended for most teams.") {
		t.Fatalf("expected option detail, got:\n%s", joined)
	}
	if !strings.Contains(joined, "★ Recommended") {
		t.Fatalf("expected recommended badge, got:\n%s", joined)
	}
}

func TestBuildFooterLinesRendersOptionDescriptionsDimmed(t *testing.T) {
	view := popupView{
		Options:       []string{"OpenAI"},
		OptionDetails: []string{"Recommended for most teams."},
	}
	lines := buildFooterLines(view, 72)
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "\x1b[38;5;242m") {
		t.Fatalf("expected dim color for option descriptions, got:\n%s", joined)
	}
}

func TestBuildFooterLayoutCompactOptionDescriptionsDimmed(t *testing.T) {
	view := popupView{
		Options:       []string{"Yes", "No"},
		OptionDetails: []string{"Continue with detected settings.", "Enter fresh values manually."},
	}
	layout := buildFooterLayout(view, 88, false)
	joined := strings.Join(layout.Rows, "\n")
	if !strings.Contains(joined, "\x1b[38;5;242m") {
		t.Fatalf("expected dim style in compact option descriptions, got:\n%s", joined)
	}
}
