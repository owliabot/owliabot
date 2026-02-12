package main

import "testing"

func TestOptionInputHintRawMode(t *testing.T) {
	got := optionInputHint(false)
	if got != "Use arrows to choose, Enter to confirm (number shortcuts work)." {
		t.Fatalf("unexpected raw hint: %q", got)
	}
}

func TestOptionInputHintLineBufferedMode(t *testing.T) {
	got := optionInputHint(true)
	if got != "Type up/down or number + Enter to confirm." {
		t.Fatalf("unexpected line hint: %q", got)
	}
}
