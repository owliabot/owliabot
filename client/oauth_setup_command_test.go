package main

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestResolveOpenAICodexSetupCommandPrefersOwliabotBinary(t *testing.T) {
	oldLookPath := oauthLookPath
	defer func() {
		oauthLookPath = oldLookPath
	}()

	oauthLookPath = func(name string) (string, error) {
		if name == "owliabot" {
			return "/usr/local/bin/owliabot", nil
		}
		return "", errors.New("not found")
	}

	cmd, args, dir, err := resolveOpenAICodexSetupCommand("/tmp/repo")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if cmd != "/usr/local/bin/owliabot" {
		t.Fatalf("expected owliabot binary, got %q", cmd)
	}
	if !reflect.DeepEqual(args, []string{"auth", "setup", "openai-codex"}) {
		t.Fatalf("unexpected args: %v", args)
	}
	if dir != "/tmp/repo" {
		t.Fatalf("unexpected dir: %q", dir)
	}
}

func TestResolveOpenAICodexSetupCommandFallsBackToDistEntry(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "dist"), 0o755); err != nil {
		t.Fatalf("mkdir dist: %v", err)
	}
	distEntry := filepath.Join(root, "dist", "entry.js")
	if err := os.WriteFile(distEntry, []byte(""), 0o644); err != nil {
		t.Fatalf("write dist entry: %v", err)
	}

	oldLookPath := oauthLookPath
	defer func() {
		oauthLookPath = oldLookPath
	}()
	oauthLookPath = func(string) (string, error) {
		return "", errors.New("not found")
	}

	cmd, args, _, err := resolveOpenAICodexSetupCommand(root)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if cmd != "node" {
		t.Fatalf("expected node command, got %q", cmd)
	}
	expectedArgs := []string{distEntry, "auth", "setup", "openai-codex"}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Fatalf("unexpected args: %v", args)
	}
}

func TestResolveOpenAICodexSetupCommandFallsBackToSourceEntry(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	srcEntry := filepath.Join(root, "src", "entry.ts")
	if err := os.WriteFile(srcEntry, []byte(""), 0o644); err != nil {
		t.Fatalf("write src entry: %v", err)
	}

	oldLookPath := oauthLookPath
	defer func() {
		oauthLookPath = oldLookPath
	}()
	oauthLookPath = func(name string) (string, error) {
		if name == "tsx" {
			return "/usr/local/bin/tsx", nil
		}
		return "", errors.New("not found")
	}

	cmd, args, _, err := resolveOpenAICodexSetupCommand(root)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if cmd != "/usr/local/bin/tsx" {
		t.Fatalf("expected tsx command, got %q", cmd)
	}
	expectedArgs := []string{srcEntry, "auth", "setup", "openai-codex"}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Fatalf("unexpected args: %v", args)
	}
}

func TestResolveOpenAICodexSetupCommandUsesNodeImportTsxWhenTsxBinaryMissing(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	srcEntry := filepath.Join(root, "src", "entry.ts")
	if err := os.WriteFile(srcEntry, []byte(""), 0o644); err != nil {
		t.Fatalf("write src entry: %v", err)
	}

	oldLookPath := oauthLookPath
	defer func() {
		oauthLookPath = oldLookPath
	}()
	oauthLookPath = func(string) (string, error) {
		return "", errors.New("not found")
	}

	cmd, args, _, err := resolveOpenAICodexSetupCommand(root)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if cmd != "node" {
		t.Fatalf("expected node command, got %q", cmd)
	}
	expectedArgs := []string{"--import", "tsx", srcEntry, "auth", "setup", "openai-codex"}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Fatalf("unexpected args: %v", args)
	}
}

func TestResolveOpenAICodexSetupCommandReturnsErrorWhenNoEntryPoint(t *testing.T) {
	root := t.TempDir()

	oldLookPath := oauthLookPath
	defer func() {
		oauthLookPath = oldLookPath
	}()
	oauthLookPath = func(string) (string, error) {
		return "", errors.New("not found")
	}

	_, _, _, err := resolveOpenAICodexSetupCommand(root)
	if err == nil {
		t.Fatalf("expected error when no command path is available")
	}
}
