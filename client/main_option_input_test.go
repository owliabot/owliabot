package main

import "testing"

func TestArrowInputHelpers(t *testing.T) {
	if !isArrowUpInput("up") {
		t.Fatalf("expected textual up to be recognized")
	}
	if !isArrowUpInput("\x1b[A") {
		t.Fatalf("expected CSI up to be recognized")
	}
	if !isArrowUpInput("\x1bOA") {
		t.Fatalf("expected SS3 up to be recognized")
	}
	if isArrowUpInput("down") {
		t.Fatalf("down must not be treated as up")
	}

	if !isArrowDownInput("down") {
		t.Fatalf("expected textual down to be recognized")
	}
	if !isArrowDownInput("\x1b[B") {
		t.Fatalf("expected CSI down to be recognized")
	}
	if !isArrowDownInput("\x1bOB") {
		t.Fatalf("expected SS3 down to be recognized")
	}
	if isArrowDownInput("up") {
		t.Fatalf("up must not be treated as down")
	}
}

func TestEscapeLeaderHelpers(t *testing.T) {
	if !isArrowEscapeLeader('[') {
		t.Fatalf("expected '[' to be recognized as arrow leader")
	}
	if !isArrowEscapeLeader('O') {
		t.Fatalf("expected 'O' to be recognized as arrow leader")
	}
	if isArrowEscapeLeader('A') {
		t.Fatalf("'A' must not be treated as arrow leader")
	}
}

func TestApplyLineBufferedNavigationInputCaretSequence(t *testing.T) {
	next, moved := applyLineBufferedNavigationInput("^[[A^[[B^[[A^[[B", 0, 2)
	if !moved {
		t.Fatalf("expected caret notation arrow sequence to be recognized")
	}
	if next != 1 {
		t.Fatalf("expected selection to move to option 2, got %d", next+1)
	}
}

func TestApplyLineBufferedNavigationInputAnsiWithParams(t *testing.T) {
	next, moved := applyLineBufferedNavigationInput("\x1b[1;2B\x1b[1;2A\x1b[1;2B", 0, 3)
	if !moved {
		t.Fatalf("expected parameterized ANSI arrow sequences to be recognized")
	}
	if next != 1 {
		t.Fatalf("expected final selection index 1, got %d", next)
	}
}
