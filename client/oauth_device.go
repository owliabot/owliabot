package main

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

func handleOpenAICodexOAuthNow(w *wizardSession, configDir string) error {
	if w == nil {
		return nil
	}
	renderWaiting := func(progress openAICodexDeviceLoginResult) {
		question := buildOpenAICodexActionQuestion(progress)
		highlights := buildOpenAICodexActionHighlights(progress)
		status := openAICodexStatusText(progress)
		w.renderWithLabel(
			"Provider",
			question,
			nil,
			"Waiting for browser verification. This view will auto-update.",
			"",
			-1,
			highlights,
			status,
			true,
			"ACTION",
		)
	}

	renderWaiting(openAICodexDeviceLoginResult{StatusText: "Requesting device code..."})

	result, err := runOpenAICodexDeviceLoginWithUpdatesFn(configDir, func(progress openAICodexDeviceLoginResult) {
		renderWaiting(progress)
	})
	if err != nil {
		return err
	}
	highlights := buildOpenAICodexResultHighlights(result)
	if result.Connected {
		_, err = w.askOption(
			"Provider",
			"OpenAI Codex OAuth connected successfully.",
			[]string{"Continue"},
			0,
			highlights,
		)
		return err
	}
	choice, err := w.askOption(
		"Provider",
		"OAuth did not complete. Continue and finish later?",
		[]string{"Continue", "Back"},
		0,
		highlights,
	)
	if err != nil {
		return err
	}
	if choice == 1 {
		return errBackRequested
	}
	return err
}

func buildOpenAICodexActionQuestion(progress openAICodexDeviceLoginResult) string {
	return fmt.Sprintf(
		"Open %s and enter device code %s to finish OpenAI Codex login.",
		openAICodexActionValue(progress.VerificationURL, "(waiting for URL)"),
		openAICodexActionValue(progress.DeviceCode, "(waiting for code)"),
	)
}

func buildOpenAICodexActionHighlights(progress openAICodexDeviceLoginResult) []string {
	return []string{
		"Authentication method: OpenAI device code",
		"Complete sign-in in your browser. We'll continue automatically.",
		"Open URL: " + openAICodexActionValue(progress.VerificationURL, "waiting..."),
		"Device code: " + openAICodexActionValue(progress.DeviceCode, "waiting..."),
	}
}

func buildOpenAICodexResultHighlights(result openAICodexDeviceLoginResult) []string {
	highlights := []string{
		"Authentication method: OpenAI device code",
	}
	if url := strings.TrimSpace(result.VerificationURL); url != "" {
		highlights = append(highlights, "Verification URL: "+url)
	}
	if code := strings.TrimSpace(result.DeviceCode); code != "" {
		highlights = append(highlights, "Device code: "+code)
	}
	if result.Connected {
		status := "Connection status: connected"
		if !result.ExpiresAt.IsZero() {
			status += " · expires " + result.ExpiresAt.UTC().Format("2006-01-02 15:04 MST")
		}
		highlights = append(highlights, status)
		if email := strings.TrimSpace(result.Email); email != "" {
			highlights = append(highlights, "Account: "+email)
		}
		return highlights
	}
	return append(highlights, "Connection status: not connected")
}

func openAICodexStatusText(progress openAICodexDeviceLoginResult) string {
	status := strings.TrimSpace(progress.StatusText)
	if status == "" {
		return "Waiting for verification..."
	}
	return status
}

func openAICodexActionValue(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func runOpenAICodexDeviceLogin(configDir string) (openAICodexDeviceLoginResult, error) {
	return runOpenAICodexDeviceLoginWithUpdates(configDir, nil)
}

func runOpenAICodexDeviceLoginWithUpdates(
	configDir string,
	onUpdate func(openAICodexDeviceLoginResult),
) (openAICodexDeviceLoginResult, error) {
	result := openAICodexDeviceLoginResult{}
	root := onboardingProjectRootDir()
	configDir = strings.TrimSpace(configDir)
	if configDir == "" {
		return result, errors.New("config-dir cannot be empty for oauth setup")
	}

	setupCmd, setupArgs, setupDir, setupErr := resolveOpenAICodexSetupCommand(root)
	if setupErr != nil {
		return result, setupErr
	}

	cmd := exec.Command(setupCmd, setupArgs...)
	cmd.Dir = setupDir
	cmd.Env = append(os.Environ(), "OWLIABOT_HOME="+configDir)
	cmd.Stdin = os.Stdin
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return result, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return result, err
	}
	if err := cmd.Start(); err != nil {
		return result, err
	}

	updates := make(chan string, 128)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		scanPipeLines(stdout, updates)
	}()
	go func() {
		defer wg.Done()
		scanPipeLines(stderr, updates)
	}()
	go func() {
		wg.Wait()
		close(updates)
	}()

	publishUpdate := func(status string) {
		status = strings.TrimSpace(status)
		if status != "" {
			result.StatusText = status
		}
		if onUpdate != nil {
			onUpdate(result)
		}
	}

	publishUpdate("Starting device code login...")

	for line := range updates {
		for _, status := range applyOpenAICodexOutputLine(&result, line) {
			publishUpdate(status)
		}
	}

	runErr := cmd.Wait()
	if existing, err := DetectExistingConfig(configDir); err == nil && existing != nil && existing.OpenAICodexOAuth != nil {
		result.Connected = true
		if existing.OpenAICodexOAuth.ExpiresKnown {
			result.ExpiresAt = existing.OpenAICodexOAuth.ExpiresAt
		}
		result.Email = existing.OpenAICodexOAuth.Email
	}
	if result.Connected {
		publishUpdate("Verification complete.")
	}
	if runErr != nil {
		return result, runErr
	}
	return result, nil
}

func applyOpenAICodexOutputLine(result *openAICodexDeviceLoginResult, line string) []string {
	if result == nil {
		return nil
	}

	statuses := make([]string, 0, 3)
	if result.VerificationURL == "" {
		if url := firstURLInText(line); url != "" {
			result.VerificationURL = url
			statuses = append(statuses, "Device login URL is ready.")
		}
	}
	if result.DeviceCode == "" {
		if code := firstDeviceCodeInText(line); code != "" {
			result.DeviceCode = code
			statuses = append(statuses, "Device code is ready.")
		}
	}
	if status := oauthStatusFromOutputLine(line); status != "" {
		statuses = append(statuses, status)
	}
	return statuses
}

func oauthStatusFromOutputLine(line string) string {
	text := strings.ToLower(strings.TrimSpace(line))
	if text == "" {
		return ""
	}
	switch {
	case strings.Contains(text, "waiting for verification"):
		return "Waiting for verification..."
	case strings.Contains(text, "authentication successful"):
		return "Verification complete."
	case strings.Contains(text, "device code login"):
		return "Device code login started."
	case strings.Contains(text, "open this url"):
		return "Open the verification URL in your browser."
	case strings.Contains(text, "then enter this one-time code"):
		return "Enter the device code in your browser."
	case strings.Contains(text, "starting") && strings.Contains(text, "oauth"):
		return "Starting OAuth flow..."
	default:
		return ""
	}
}

func onboardingProjectRootDir() string {
	cwd, err := os.Getwd()
	if err != nil {
		return "."
	}
	if filepath.Base(cwd) == "client" {
		return filepath.Dir(cwd)
	}
	if fileExists(filepath.Join(cwd, "client")) && fileExists(filepath.Join(cwd, "src", "entry.ts")) {
		return cwd
	}
	return cwd
}

func scanPipeLines(reader io.Reader, sink chan<- string) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		sink <- line
	}
}

func firstURLInText(text string) string {
	fields := strings.Fields(text)
	for _, field := range fields {
		candidate := strings.TrimRight(strings.TrimSpace(field), ".,);")
		if strings.HasPrefix(candidate, "http://") || strings.HasPrefix(candidate, "https://") {
			return candidate
		}
	}
	return ""
}

func firstDeviceCodeInText(text string) string {
	fields := strings.Fields(text)
	for _, field := range fields {
		candidate := strings.TrimSpace(strings.Trim(field, "[](){}.,;:"))
		if len(candidate) < 4 || len(candidate) > 32 {
			continue
		}
		if strings.Count(candidate, "-") >= 1 && looksAlphaNumDash(candidate) && isLikelyDeviceCode(candidate) {
			return candidate
		}
	}
	return ""
}

func isLikelyDeviceCode(value string) bool {
	hasHyphen := strings.Contains(value, "-")
	if !hasHyphen {
		return false
	}
	seenUpper := false
	seenDigit := false
	for _, r := range value {
		if r >= 'a' && r <= 'z' {
			return false
		}
		if r >= 'A' && r <= 'Z' {
			seenUpper = true
		}
		if r >= '0' && r <= '9' {
			seenDigit = true
		}
	}
	return seenUpper && seenDigit
}

func looksAlphaNumDash(value string) bool {
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}
