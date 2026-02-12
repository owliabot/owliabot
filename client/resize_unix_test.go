//go:build !windows

package main

import (
	"os"
	"syscall"
	"testing"
)

func TestResizeSignalsIncludeSIGWINCH(t *testing.T) {
	signals := resizeSignals()
	want := os.Signal(syscall.SIGWINCH)
	for _, s := range signals {
		if s == want {
			return
		}
	}
	t.Fatalf("expected SIGWINCH in resize signals, got: %v", signals)
}
