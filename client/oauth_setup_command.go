package main

import (
	"errors"
	"os/exec"
	"path/filepath"
)

var oauthLookPath = exec.LookPath

func resolveOpenAICodexSetupCommand(root string) (cmd string, args []string, dir string, err error) {
	if root == "" {
		root = "."
	}

	if bin, lookErr := oauthLookPath("owliabot"); lookErr == nil && bin != "" {
		return bin, []string{"auth", "setup", "openai-codex"}, root, nil
	}

	distEntry := filepath.Join(root, "dist", "entry.js")
	if fileExists(distEntry) {
		return "node", []string{distEntry, "auth", "setup", "openai-codex"}, root, nil
	}

	srcEntry := filepath.Join(root, "src", "entry.ts")
	if fileExists(srcEntry) {
		if tsxBin, lookErr := oauthLookPath("tsx"); lookErr == nil && tsxBin != "" {
			return tsxBin, []string{srcEntry, "auth", "setup", "openai-codex"}, root, nil
		}
		return "node", []string{"--import", "tsx", srcEntry, "auth", "setup", "openai-codex"}, root, nil
	}

	return "", nil, "", errors.New(
		"unable to start OpenAI Codex OAuth setup: neither `owliabot` command nor local entry files were found",
	)
}
