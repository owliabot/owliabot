package main

import (
	"strings"
	"testing"
)

func TestRunningNoticeBannerContainsOwliabotAscii(t *testing.T) {
	joined := strings.Join(runningNoticeBannerLines(), "\n")
	if !strings.Contains(joined, "█") {
		t.Fatalf("expected solid banner content, got:\n%s", joined)
	}
}

func TestRunningNoticeBannerMatchesBrandBanner(t *testing.T) {
	running := strings.Join(runningNoticeBannerLines(), "\n")
	brand := strings.Join(owliabotASCIIBannerLines(), "\n")
	if running != brand {
		t.Fatalf("expected running notice banner to match brand banner")
	}
}
