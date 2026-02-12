package main

import (
	"bufio"
	"fmt"
	"strings"
	"testing"
)

func TestRunWizardDiscordSelectionWithoutExistingConfig(t *testing.T) {
	origLookPath := execLookPath
	origCombinedOutput := execCombinedOutput
	execLookPath = func(file string) (string, error) {
		if file == "docker" {
			return "/usr/bin/docker", nil
		}
		return "", fmt.Errorf("unexpected lookup: %s", file)
	}
	execCombinedOutput = func(name string, args ...string) (string, error) {
		if name != "docker" {
			return "", fmt.Errorf("unexpected command: %s", name)
		}
		if len(args) > 0 && args[0] == "version" {
			return "27.0.0", nil
		}
		if len(args) > 0 && args[0] == "info" {
			return "27.0.0", nil
		}
		return "", fmt.Errorf("unexpected docker args: %v", args)
	}
	t.Cleanup(func() {
		execLookPath = origLookPath
		execCombinedOutput = origCombinedOutput
	})

	// Flow:
	// 1) Welcome -> Continue
	// 2) Provider -> Skip now
	// 3) Channels -> Discord
	// 4) Discord token -> blank
	// 5) MCP -> Done
	// 6) Review -> Start initialization
	input := strings.NewReader("1\n6\n1\n\n2\n1\n")
	w := &wizardSession{
		input:        nil,
		ownsInput:    false,
		reader:       bufio.NewReader(input),
		steps:        cloneSlice(defaultWizardSteps),
		conversation: []string{"Assistant: test"},
		renderer: func(popupView) {
			// no-op for test
		},
	}

	answers, err := w.runWizard(cliOptions{
		ConfigDir: "/tmp/owliabot-config",
		OutputDir: "/tmp/owliabot-output",
		Image:     "ghcr.io/owliabot/owliabot:latest",
	})
	if err != nil {
		t.Fatalf("runWizard returned error: %v", err)
	}
	if answers.ChannelChoice != "discord" {
		t.Fatalf("expected discord channel choice, got %q", answers.ChannelChoice)
	}
}
