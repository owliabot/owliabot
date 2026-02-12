package main

import (
	"errors"
	"strings"
	"testing"
)

func TestDetectDockerStatusNotInstalled(t *testing.T) {
	oldLookPath := execLookPath
	oldRun := execCombinedOutput
	t.Cleanup(func() {
		execLookPath = oldLookPath
		execCombinedOutput = oldRun
	})

	execLookPath = func(file string) (string, error) {
		return "", errors.New("not found")
	}
	execCombinedOutput = func(name string, args ...string) (string, error) {
		t.Fatalf("execCombinedOutput should not be called when docker is missing")
		return "", nil
	}

	status := detectDockerStatus()
	if status.Installed {
		t.Fatalf("expected Installed=false, got %+v", status)
	}
	if status.Running {
		t.Fatalf("expected Running=false, got %+v", status)
	}
}

func TestDetectDockerStatusInstalledButNotRunning(t *testing.T) {
	oldLookPath := execLookPath
	oldRun := execCombinedOutput
	t.Cleanup(func() {
		execLookPath = oldLookPath
		execCombinedOutput = oldRun
	})

	execLookPath = func(file string) (string, error) {
		return "/usr/bin/docker", nil
	}
	execCombinedOutput = func(name string, args ...string) (string, error) {
		if len(args) >= 2 && args[0] == "version" {
			return "26.1.1", nil
		}
		if len(args) >= 1 && args[0] == "info" {
			return "Cannot connect to the Docker daemon", errors.New("daemon not running")
		}
		return "", nil
	}

	status := detectDockerStatus()
	if !status.Installed {
		t.Fatalf("expected Installed=true, got %+v", status)
	}
	if status.Running {
		t.Fatalf("expected Running=false, got %+v", status)
	}
	if status.ClientVersion != "26.1.1" {
		t.Fatalf("unexpected client version: %+v", status)
	}
}

func TestDetectDockerStatusRunning(t *testing.T) {
	oldLookPath := execLookPath
	oldRun := execCombinedOutput
	t.Cleanup(func() {
		execLookPath = oldLookPath
		execCombinedOutput = oldRun
	})

	execLookPath = func(file string) (string, error) {
		return "/usr/bin/docker", nil
	}
	execCombinedOutput = func(name string, args ...string) (string, error) {
		if len(args) >= 2 && args[0] == "version" {
			return "26.1.1", nil
		}
		if len(args) >= 1 && args[0] == "info" {
			return "26.1.1", nil
		}
		return "", nil
	}

	status := detectDockerStatus()
	if !status.Installed || !status.Running {
		t.Fatalf("expected docker installed and running, got %+v", status)
	}
	if status.ServerVersion != "26.1.1" {
		t.Fatalf("unexpected server version: %+v", status)
	}
}

func TestApplyImageSelectionSupportsTagAndFullRef(t *testing.T) {
	base := "ghcr.io/owliabot/owliabot:latest"
	if got := applyImageSelection(base, "v1.2.3"); got != "ghcr.io/owliabot/owliabot:v1.2.3" {
		t.Fatalf("expected tagged ref, got %q", got)
	}
	if got := applyImageSelection(base, "ghcr.io/owliabot/owliabot:v2"); got != "ghcr.io/owliabot/owliabot:v2" {
		t.Fatalf("expected full ref kept, got %q", got)
	}
}

func TestBuildExistingHighlightsMentionsDockerStatus(t *testing.T) {
	highlights := buildDockerHighlights(
		"~/.owliabot",
		".",
		dockerStatus{Installed: true, Running: true, ClientVersion: "26.1.1", ServerVersion: "26.1.1"},
	)
	joined := ""
	for _, line := range highlights {
		joined += line + "\n"
	}
	if !containsAll(joined, "Docker CLI: installed", "Docker engine: running", "Config directory: ~/.owliabot") {
		t.Fatalf("unexpected highlights:\n%s", joined)
	}
}

func TestParseRemoteDigestFromManifest(t *testing.T) {
	json := `{"Descriptor":{"digest":"sha256:abc123"}}`
	digest := parseRemoteDigestFromManifest(json)
	if digest != "sha256:abc123" {
		t.Fatalf("expected digest sha256:abc123, got %q", digest)
	}
}

func containsAll(input string, parts ...string) bool {
	for _, part := range parts {
		if !strings.Contains(input, part) {
			return false
		}
	}
	return true
}
