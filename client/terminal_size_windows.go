//go:build windows

package main

func getTerminalSizeFromIOCTL(fd int) (int, int, bool) {
	return 0, 0, false
}
