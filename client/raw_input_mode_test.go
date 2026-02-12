package main

import "testing"

func TestRawInputSttyArgsAvoidRawMode(t *testing.T) {
	args := rawInputSttyArgs()
	for _, arg := range args {
		if arg == "raw" {
			t.Fatalf("raw mode must not be used because it breaks TUI output rendering")
		}
	}

	expected := map[string]bool{"-icanon": false, "-echo": false}
	for _, arg := range args {
		if _, ok := expected[arg]; ok {
			expected[arg] = true
		}
	}
	for key, found := range expected {
		if !found {
			t.Fatalf("expected %s in stty args, got: %v", key, args)
		}
	}
}
