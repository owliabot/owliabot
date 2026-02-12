package main

import (
	"os"
	"testing"
)

func TestAskInputLineBufferedForcesCanonicalEchoMode(t *testing.T) {
	oldSetLineMode := setLineInputModeFn
	t.Cleanup(func() {
		setLineInputModeFn = oldSetLineMode
	})

	called := false
	setLineInputModeFn = func(input *os.File) {
		called = true
	}

	w := newLineModeWizardSessionForTest(t, "discord-demo-token\n")
	got, err := w.askInputLineBuffered("Channels", "Discord bot token (optional)", "", nil)
	if err != nil {
		t.Fatalf("askInputLineBuffered returned error: %v", err)
	}
	if got != "discord-demo-token" {
		t.Fatalf("expected typed token to be returned, got %q", got)
	}
	if !called {
		t.Fatalf("expected setLineInputModeFn to be called")
	}
}
