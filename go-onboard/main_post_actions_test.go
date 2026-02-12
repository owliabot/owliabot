package main

import (
	"strings"
	"testing"
)

func TestRunPostActionsShowStartCommandProvidesVisibleFeedback(t *testing.T) {
	w := newLineModeWizardSessionForTest(t, "3\n5\n")

	w.runPostActions(applyResult{
		GatewayPort: "8787",
		ConfigDir:   "/tmp/config",
		OutputDir:   "/tmp/output",
		Image:       "ghcr.io/owliabot/owliabot:latest",
	})

	joinedHighlights := strings.Join(w.lastView.Highlights, "\n")
	if !strings.Contains(joinedHighlights, "Last action:") || !strings.Contains(joinedHighlights, "OWLIABOT_IMAGE=") {
		t.Fatalf("expected visible start command feedback in highlights, got %q", joinedHighlights)
	}
}

func TestRunPostActionsUsesRenamedStartOptions(t *testing.T) {
	w := newLineModeWizardSessionForTest(t, "5\n")
	w.runPostActions(applyResult{
		GatewayPort: "8787",
		ConfigDir:   "/tmp/config",
		OutputDir:   "/tmp/output",
		Image:       "ghcr.io/owliabot/owliabot:latest",
	})
	if len(w.lastView.Options) < 2 {
		t.Fatalf("expected apply options to be rendered, got %+v", w.lastView.Options)
	}
	if w.lastView.Options[0] != "Start OwliaBot now" {
		t.Fatalf("unexpected first apply option: %q", w.lastView.Options[0])
	}
	if w.lastView.Options[1] != "Start with specific tag/version" {
		t.Fatalf("unexpected second apply option: %q", w.lastView.Options[1])
	}
}

func TestRunPostActionsStartNowExitsDashboard(t *testing.T) {
	oldLocal := detectLocalImageFn
	oldUpdate := detectImageUpdateFn
	oldStart := startDockerComposeFn
	t.Cleanup(func() {
		detectLocalImageFn = oldLocal
		detectImageUpdateFn = oldUpdate
		startDockerComposeFn = oldStart
	})

	detectLocalImageFn = func(imageRef string) bool { return true }
	detectImageUpdateFn = func(imageRef string) imageUpdateInfo {
		return imageUpdateInfo{ImageRef: imageRef, HasLocal: true}
	}
	started := false
	startDockerComposeFn = func(outputDir, imageRef string) error {
		started = true
		return nil
	}

	w := newLineModeWizardSessionForTest(t, "1\n")
	if !w.runPostActions(applyResult{
		GatewayPort: "8787",
		ConfigDir:   "/tmp/config",
		OutputDir:   "/tmp/output",
		Image:       "ghcr.io/owliabot/owliabot:latest",
	}) {
		t.Fatalf("expected post actions to exit after successful container start")
	}
	if !started {
		t.Fatalf("expected container start to be invoked")
	}
}

func TestRunPostActionsExitClearsTerminal(t *testing.T) {
	oldClear := clearTerminalViewFn
	t.Cleanup(func() {
		clearTerminalViewFn = oldClear
	})

	cleared := false
	clearTerminalViewFn = func() {
		cleared = true
	}

	w := newLineModeWizardSessionForTest(t, "5\n")
	started := w.runPostActions(applyResult{
		GatewayPort: "8787",
		ConfigDir:   "/tmp/config",
		OutputDir:   "/tmp/output",
		Image:       "ghcr.io/owliabot/owliabot:latest",
	})

	if started {
		t.Fatalf("expected Exit action not to report started")
	}
	if !cleared {
		t.Fatalf("expected terminal clear to run on Exit action")
	}
}
