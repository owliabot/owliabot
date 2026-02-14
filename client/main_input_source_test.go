package main

import (
	"os"
	"testing"
)

func TestResolveInteractiveInputPrefersPipedStdin(t *testing.T) {
	oldOpenTTY := openTTYDevice
	oldStdin := os.Stdin
	t.Cleanup(func() {
		openTTYDevice = oldOpenTTY
		os.Stdin = oldStdin
	})

	stdinReader, stdinWriter, err := os.Pipe()
	if err != nil {
		t.Fatalf("create stdin pipe: %v", err)
	}
	t.Cleanup(func() {
		_ = stdinReader.Close()
		_ = stdinWriter.Close()
	})
	os.Stdin = stdinReader

	fakeTTY, err := os.CreateTemp("", "onboard-fake-tty-*")
	if err != nil {
		t.Fatalf("create fake tty: %v", err)
	}
	t.Cleanup(func() {
		_ = fakeTTY.Close()
		_ = os.Remove(fakeTTY.Name())
	})

	openTTYCalls := 0
	openTTYDevice = func() (*os.File, error) {
		openTTYCalls++
		return fakeTTY, nil
	}

	input, ownsInput, reader := resolveInteractiveInput()
	if input != stdinReader {
		t.Fatalf("expected piped stdin input to be used")
	}
	if ownsInput {
		t.Fatalf("piped stdin should not be treated as owned input")
	}
	if reader == nil {
		t.Fatalf("expected buffered reader")
	}
	if openTTYCalls != 0 {
		t.Fatalf("expected resolveInteractiveInput not to open /dev/tty when stdin is piped")
	}
}
