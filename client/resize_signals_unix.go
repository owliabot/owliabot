//go:build !windows

package main

import (
	"os"
	"syscall"
)

func resizeSignals() []os.Signal {
	return []os.Signal{syscall.SIGWINCH}
}
