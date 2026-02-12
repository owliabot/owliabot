//go:build windows

package main

import "os"

func resizeSignals() []os.Signal {
	return nil
}
