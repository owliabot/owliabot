package main

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	zone "github.com/lrstanley/bubblezone"
)

type cliOptions struct {
	ConfigDir string
	OutputDir string
	Image     string
}

type applyResult struct {
	ConfigDir   string
	OutputDir   string
	AppPath     string
	SecretsPath string
	ComposePath string
	GatewayPort string
	Image       string
}

type openAICodexDeviceLoginResult struct {
	VerificationURL string
	DeviceCode      string
	StatusText      string
	Connected       bool
	ExpiresAt       time.Time
	Email           string
}

type wizardSession struct {
	input        *os.File
	ownsInput    bool
	reader       *bufio.Reader
	stepIndex    int
	steps        []string
	conversation []string
	showHelp     bool
	errorText    string
	renderMu     sync.Mutex
	renderer     func(popupView)
	lastView     popupView
	hasLastView  bool
	resizeStop   chan struct{}
	resizeDone   chan struct{}
}

var defaultWizardSteps = []string{
	"Welcome",
	"Provider",
	"Channels",
	"MCP",
	"Review",
	"Apply",
}

var errBackRequested = errors.New("back requested")
var errWizardCancelled = errors.New("wizard cancelled by user")

type modelPreset struct {
	Value       string
	Description string
}

var anthropicModelPresets = []modelPreset{
	{Value: "claude-opus-4-5", Description: "Best quality for complex reasoning tasks."},
	{Value: "claude-sonnet-4-5", Description: "Balanced speed and quality for daily use."},
	{Value: "claude-haiku-3-5", Description: "Fastest and lowest-cost option."},
}

var openAIModelPresets = []modelPreset{
	{Value: "gpt-5.2", Description: "Recommended default for most teams."},
	{Value: "gpt-5", Description: "Strong quality with broad capability support."},
	{Value: "gpt-4.1", Description: "Stable fallback for compatibility."},
}

var openAICodexModelPresets = []modelPreset{
	{Value: "gpt-5.2", Description: "Recommended Codex default with best coding quality."},
	{Value: "gpt-5", Description: "Strong coding performance with lower latency."},
	{Value: "gpt-4.1", Description: "Compatibility-focused fallback model."},
}

var openAICompatibleModelPresets = []modelPreset{
	{Value: "llama3.2", Description: "Default local model for quick setup."},
	{Value: "qwen2.5:14b", Description: "Good balance for self-hosted workloads."},
	{Value: "gpt-oss-120b", Description: "Higher-quality open model when available."},
}

type stepJumpRequestedError struct {
	step int
}

func (e stepJumpRequestedError) Error() string {
	return fmt.Sprintf("step jump requested: %d", e.step)
}

func asStepJumpRequested(err error) (int, bool) {
	var target stepJumpRequestedError
	if errors.As(err, &target) {
		return target.step, true
	}
	return 0, false
}

func (w *wizardSession) canJourneyJump() bool {
	return w.stepIndex > 0 && w.stepIndex < len(w.steps)-1
}

var openTTYDevice = func() (*os.File, error) {
	tty, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err == nil {
		return tty, nil
	}
	return os.OpenFile("/dev/tty", os.O_RDONLY, 0)
}

var setLineInputModeFn = setLineInputMode
var clearTerminalViewFn = clearTerminalView
var handleOpenAICodexOAuthNowFn = handleOpenAICodexOAuthNow
var runOpenAICodexDeviceLoginFn = runOpenAICodexDeviceLogin
var runOpenAICodexDeviceLoginWithUpdatesFn = runOpenAICodexDeviceLoginWithUpdates

func resolveInteractiveInput() (*os.File, bool, *bufio.Reader) {
	if shouldUseStdinInput(os.Stdin) {
		return os.Stdin, false, bufio.NewReader(os.Stdin)
	}

	tty, err := openTTYDevice()
	if err == nil && tty != nil {
		return tty, true, bufio.NewReader(tty)
	}
	return os.Stdin, false, bufio.NewReader(os.Stdin)
}

func shouldUseStdinInput(stdin *os.File) bool {
	if stdin == nil {
		return false
	}
	info, err := stdin.Stat()
	if err != nil || info == nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice == 0
}

func isInputEOF(err error) bool {
	return errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)
}

func (w *wizardSession) recoverInputOnEOF(err error) bool {
	if !isInputEOF(err) {
		return false
	}

	tty, openErr := openTTYDevice()
	if openErr != nil || tty == nil {
		return false
	}

	if w.ownsInput && w.input != nil && w.input != os.Stdin {
		_ = w.input.Close()
	}

	w.input = tty
	w.ownsInput = true
	w.reader = bufio.NewReader(tty)
	return true
}

func main() {
	zone.NewGlobal()

	home, _ := os.UserHomeDir()
	defaultConfig := filepath.Join(home, ".owliabot")

	var opts cliOptions
	flag.StringVar(&opts.ConfigDir, "config-dir", defaultConfig, "Config directory (default: ~/.owliabot)")
	flag.StringVar(&opts.OutputDir, "output-dir", ".", "Output directory for docker-compose.yml")
	flag.StringVar(&opts.Image, "image", "ghcr.io/owliabot/owliabot:latest", "OwliaBot Docker image")
	flag.Parse()

	input, ownsInput, reader := resolveInteractiveInput()
	session := &wizardSession{
		input:        input,
		ownsInput:    ownsInput,
		reader:       reader,
		steps:        cloneSlice(defaultWizardSteps),
		conversation: []string{"Assistant: I'll guide you through Docker onboarding."},
		renderer:     renderPopup,
	}
	if session.ownsInput && session.input != nil {
		defer func() {
			_ = session.input.Close()
		}()
	}
	session.startResizeWatcher()
	defer session.stopResizeWatcher()

	answers, err := session.runWizard(opts)
	if err != nil {
		if errors.Is(err, errWizardCancelled) {
			fmt.Fprintln(os.Stdout, "onboard-go cancelled.")
			return
		}
		fmt.Fprintf(os.Stderr, "onboard-go cancelled: %v\n", err)
		os.Exit(1)
	}

	session.stepIndex = len(session.steps) - 1
	var result applyResult
	err = session.runSpinner(
		"Applying configuration files",
		[]string{"Writing app.yaml, secrets.yaml, and docker-compose.yml."},
		func() error {
			applied, applyErr := applyAnswers(answers, opts)
			if applyErr != nil {
				return applyErr
			}
			result = applied
			return nil
		},
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "onboard-go failed: %v\n", err)
		os.Exit(1)
	}

	session.conversation = append(session.conversation,
		"Tool: Configuration files are ready.",
		fmt.Sprintf("Tool: app.yaml -> %s", displayPath(result.AppPath)),
		fmt.Sprintf("Tool: secrets.yaml -> %s", displayPath(result.SecretsPath)),
		fmt.Sprintf("Tool: docker-compose.yml -> %s", displayPath(result.ComposePath)),
	)
	started := session.runPostActions(result)
	if started {
		printRunningNotice(result.GatewayPort, result.OutputDir)
	}
}

func runningNoticeBannerLines() []string {
	return owliabotASCIIBannerLines()
}

func (w *wizardSession) resolveImageForLaunch(defaultImage string, promptTag bool) (string, error) {
	imageRef := normalizeImageRef(defaultImage)
	if promptTag {
		defaultTag := imageTagOrDefault(imageRef)
		tagOrRef, err := w.askInput(
			"Complete",
			"Image tag (e.g. latest, v1.2.3) or full image reference",
			defaultTag,
			[]string{fmt.Sprintf("Repository: %s", imageRepository(imageRef))},
		)
		if err != nil {
			return "", err
		}
		imageRef = applyImageSelection(imageRef, tagOrRef)
	}

	hasLocal := detectLocalImageFn(imageRef)
	if !hasLocal {
		checkHighlights := []string{
			fmt.Sprintf("Image: %s", imageRef),
			"Local image cache: not found",
		}
		pull, err := w.askYN(
			"Complete",
			"No local image cache found. Pull image before start?",
			true,
			checkHighlights,
		)
		if err != nil {
			return "", err
		}
		if !pull {
			return "", errors.New("No local image available and pull was skipped.")
		}

		if !promptTag {
			newestTag := fetchNewestImageTagFn(imageRef)
			tagOptions, tagDetails := buildImagePullTagOptions(imageRef, newestTag)
			tagChoice, choiceErr := w.askOptionWithDetails(
				"Complete",
				"Select image tag/version to pull",
				tagOptions,
				tagDetails,
				0,
				0,
				[]string{
					fmt.Sprintf("Repository: %s", imageRepository(imageRef)),
					"Default selection is latest.",
				},
			)
			if choiceErr != nil {
				return "", choiceErr
			}
			selected := tagOptions[tagChoice]
			if selected == "Custom tag/reference" {
				custom, customErr := w.askInput(
					"Complete",
					"Custom tag (e.g. v1.2.3) or full image reference",
					"latest",
					[]string{fmt.Sprintf("Repository: %s", imageRepository(imageRef))},
				)
				if customErr != nil {
					return "", customErr
				}
				selected = custom
			}
			imageRef = applyImageSelection(imageRef, selected)
			checkHighlights[0] = fmt.Sprintf("Image: %s", imageRef)
		}

		if err := w.pullImageWithFeedback(imageRef, checkHighlights); err != nil {
			return "", err
		}
		w.conversation = append(w.conversation, "Assistant: Pulled image successfully.")
		return imageRef, nil
	}

	updateInfo := detectImageUpdateFn(imageRef)
	if !updateInfo.HasLocal {
		updateInfo.HasLocal = true
	}
	checkHighlights := buildImageCheckHighlights(imageRef, updateInfo)
	if updateInfo.HasLocal && updateInfo.HasRemote && updateInfo.LocalDigest != updateInfo.RemoteDigest {
		pull, err := w.askYN(
			"Complete",
			"A newer image version is available. Pull the update before start?",
			true,
			checkHighlights,
		)
		if err != nil {
			return "", err
		}
		if pull {
			if err := w.pullImageWithFeedback(imageRef, checkHighlights); err != nil {
				return "", err
			}
			w.conversation = append(w.conversation, "Assistant: Pulled the latest image for this tag.")
		}
		return imageRef, nil
	}

	return imageRef, nil
}

func buildImageCheckHighlights(imageRef string, updateInfo imageUpdateInfo) []string {
	checkHighlights := []string{fmt.Sprintf("Image: %s", imageRef)}
	if updateInfo.HasLocal {
		checkHighlights = append(checkHighlights, fmt.Sprintf("Local digest: %s", shortenDigest(updateInfo.LocalDigest)))
	} else {
		checkHighlights = append(checkHighlights, "Local digest: not cached")
	}
	if updateInfo.HasRemote {
		checkHighlights = append(checkHighlights, fmt.Sprintf("Registry digest: %s", shortenDigest(updateInfo.RemoteDigest)))
	}
	if strings.TrimSpace(updateInfo.CheckError) != "" {
		checkHighlights = append(checkHighlights, "Registry check: unavailable ("+updateInfo.CheckError+")")
	}
	return checkHighlights
}

func buildImagePullTagOptions(imageRef string, newestTag string) ([]string, []string) {
	options := make([]string, 0, 5)
	details := make([]string, 0, 5)
	add := func(tag string, description string) {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			return
		}
		for _, existing := range options {
			if existing == tag {
				return
			}
		}
		options = append(options, tag)
		details = append(details, description)
	}

	repo := imageRepository(imageRef)
	add("latest", fmt.Sprintf("Stable default from %s.", repo))
	add("develop", "Latest development build.")
	newestTag = strings.TrimSpace(newestTag)
	if newestTag != "" {
		add(newestTag, "Newest discovered version tag from registry.")
	}
	add("Custom tag/reference", "Enter any tag or a full image reference manually.")
	return options, details
}

func sanitizePullUpdateLine(line string) string {
	line = strings.TrimSpace(stripANSI(line))
	if line == "" {
		return ""
	}
	runes := []rune(line)
	if len(runes) > 120 {
		return string(runes[:117]) + "..."
	}
	return line
}

func (w *wizardSession) pullImageWithFeedback(imageRef string, highlights []string) error {
	renderHighlights := append([]string{}, highlights...)
	update := func(line string) {
		line = sanitizePullUpdateLine(line)
		if line == "" {
			return
		}
		w.render(
			"Complete",
			"Pulling Docker image...",
			nil,
			"Please wait...",
			"",
			-1,
			renderHighlights,
			line,
			true,
		)
	}

	update("Starting docker pull...")
	if err := pullDockerImageWithProgressFn(imageRef, update); err != nil {
		return err
	}
	update("Pull complete.")
	return nil
}

func shortenDigest(digest string) string {
	digest = strings.TrimSpace(digest)
	if digest == "" {
		return ""
	}
	if len(digest) <= 20 {
		return digest
	}
	return digest[:20] + "..."
}

func modelDefaultIndex(current string, presets []modelPreset) int {
	current = strings.TrimSpace(current)
	if current == "" {
		return 0
	}
	for i, preset := range presets {
		if preset.Value == current {
			return i
		}
	}
	return len(presets)
}

func modelMenu(presets []modelPreset) ([]string, []string) {
	options := make([]string, 0, len(presets)+1)
	details := make([]string, 0, len(presets)+1)
	for _, preset := range presets {
		options = append(options, preset.Value)
		details = append(details, preset.Description)
	}
	options = append(options, "Custom model ID")
	details = append(details, "Type any model name manually.")
	return options, details
}

func (w *wizardSession) askModelWithOptions(
	title string,
	question string,
	current string,
	presets []modelPreset,
	highlights []string,
) (string, error) {
	if len(presets) == 0 {
		return current, nil
	}
	options, details := modelMenu(presets)
	defaultIndex := modelDefaultIndex(current, presets)
	choice, err := w.askOptionWithDetails(title, question, options, details, defaultIndex, 0, highlights)
	if err != nil {
		return "", err
	}
	if choice < len(presets) {
		return presets[choice].Value, nil
	}
	custom, inputErr := w.askInput(title, "Custom model ID", current, []string{"Any provider-supported model string is accepted."})
	if inputErr != nil {
		return "", inputErr
	}
	return custom, nil
}

func (w *wizardSession) render(
	title, question string,
	options []string,
	inputHint string,
	inputValue string,
	selectedOption int,
	highlights []string,
	spinner string,
	disableInput bool,
) {
	w.renderWithLabel(
		title,
		question,
		options,
		inputHint,
		inputValue,
		selectedOption,
		highlights,
		spinner,
		disableInput,
		"",
	)
}

func defaultHeadlineLabel(disableInput bool) string {
	if disableInput {
		return "STATUS"
	}
	return "QUESTION"
}

func (w *wizardSession) renderWithLabel(
	title, question string,
	options []string,
	inputHint string,
	inputValue string,
	selectedOption int,
	highlights []string,
	spinner string,
	disableInput bool,
	headlineLabel string,
) {
	if strings.TrimSpace(headlineLabel) == "" {
		headlineLabel = defaultHeadlineLabel(disableInput)
	}
	w.renderView(popupView{
		StepIndex:      w.stepIndex,
		TotalSteps:     len(w.steps),
		StepTitle:      title,
		Steps:          w.steps,
		HeadlineLabel:  headlineLabel,
		Question:       question,
		ContextLines:   w.conversation,
		Highlights:     highlights,
		Options:        options,
		InputHint:      inputHint,
		InputValue:     inputValue,
		SelectedOption: selectedOption,
		ErrorText:      w.errorText,
		Spinner:        spinner,
		DisableInput:   disableInput,
		ShowHelp:       w.showHelp,
	})
}

func (w *wizardSession) renderOptionPrompt(
	title, question string,
	options []string,
	optionDetails []string,
	inputHint string,
	inputValue string,
	selectedOption int,
	recommendedOption int,
	highlights []string,
	spinner string,
	disableInput bool,
	lineMode bool,
) {
	w.renderView(popupView{
		StepIndex:      w.stepIndex,
		TotalSteps:     len(w.steps),
		StepTitle:      title,
		Steps:          w.steps,
		HeadlineLabel:  defaultHeadlineLabel(disableInput),
		Question:       question,
		ContextLines:   w.conversation,
		Highlights:     highlights,
		Options:        options,
		OptionDetails:  optionDetails,
		Recommended:    recommendedOption,
		InputHint:      inputHint,
		InputValue:     inputValue,
		SelectedOption: selectedOption,
		ErrorText:      w.errorText,
		Spinner:        spinner,
		DisableInput:   disableInput,
		LineMode:       lineMode,
		ShowHelp:       w.showHelp,
	})
}

func (w *wizardSession) renderView(view popupView) {
	w.renderMu.Lock()
	defer w.renderMu.Unlock()
	if w.renderer == nil {
		w.renderer = renderPopup
	}
	w.lastView = view
	w.hasLastView = true
	w.renderer(view)
}

func (w *wizardSession) renderOnResize() {
	w.renderMu.Lock()
	defer w.renderMu.Unlock()
	if !w.hasLastView {
		return
	}
	if w.renderer == nil {
		w.renderer = renderPopup
	}
	w.renderer(w.lastView)
}

func (w *wizardSession) startResizeWatcher() {
	if w.resizeStop != nil {
		return
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, resizeSignals()...)

	w.resizeStop = make(chan struct{})
	w.resizeDone = make(chan struct{})
	go func() {
		defer close(w.resizeDone)
		for {
			select {
			case <-sigCh:
				w.renderOnResize()
			case <-w.resizeStop:
				signal.Stop(sigCh)
				return
			}
		}
	}()
}

func (w *wizardSession) stopResizeWatcher() {
	if w.resizeStop == nil {
		return
	}
	close(w.resizeStop)
	<-w.resizeDone
	w.resizeStop = nil
	w.resizeDone = nil
}

func (w *wizardSession) runSpinner(title string, highlights []string, action func() error) error {
	frames := []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
	done := make(chan error, 1)
	started := time.Now()

	go func() {
		done <- action()
	}()

	idx := 0
	for {
		select {
		case err := <-done:
			elapsed := time.Since(started)
			if elapsed < 600*time.Millisecond {
				time.Sleep(600*time.Millisecond - elapsed)
			}
			if err != nil {
				w.render(title, "Something went wrong while applying files.", nil, "Please wait...", "", -1, highlights, ansiRed+"Failed"+ansiReset, true)
				return err
			}
			w.render(title, "Configuration applied successfully.", nil, "Done", "", -1, highlights, ansiGreen+"Done"+ansiReset, true)
			time.Sleep(180 * time.Millisecond)
			return nil
		default:
			w.render(title, "Running file generation tools...", nil, "Please wait...", "", -1, highlights, frames[idx%len(frames)], true)
			idx++
			time.Sleep(90 * time.Millisecond)
		}
	}
}

func applyAnswers(a Answers, opts cliOptions) (applyResult, error) {
	configDir := expandHome(strings.TrimSpace(opts.ConfigDir))
	outputDir := expandHome(strings.TrimSpace(opts.OutputDir))
	if configDir == "" {
		return applyResult{}, errors.New("config-dir cannot be empty")
	}
	if outputDir == "" {
		outputDir = "."
	}

	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return applyResult{}, err
	}
	if err := os.MkdirAll(filepath.Join(configDir, "auth"), 0o700); err != nil {
		return applyResult{}, err
	}
	if err := os.MkdirAll(filepath.Join(configDir, "workspace"), 0o755); err != nil {
		return applyResult{}, err
	}
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return applyResult{}, err
	}

	app := BuildAppConfig(a)
	sec := BuildSecrets(a)
	appYAML := RenderAppYAML(app)
	secretsYAML := RenderSecretsYAML(sec)
	gatewayPort, err := parseGatewayPort(a.GatewayPort)
	if err != nil {
		return applyResult{}, err
	}
	composeYAML, err := BuildDockerComposeYAML(configDir, a.Timezone, a.GatewayPort, opts.Image)
	if err != nil {
		return applyResult{}, err
	}

	appPath := filepath.Join(configDir, "app.yaml")
	if err := os.WriteFile(appPath, []byte(appYAML), 0o644); err != nil {
		return applyResult{}, err
	}
	secretsPath := filepath.Join(configDir, "secrets.yaml")
	if err := os.WriteFile(secretsPath, []byte(secretsYAML), 0o600); err != nil {
		return applyResult{}, err
	}
	composePath := filepath.Join(outputDir, "docker-compose.yml")
	if err := os.WriteFile(composePath, []byte(composeYAML), 0o644); err != nil {
		return applyResult{}, err
	}

	return applyResult{
		ConfigDir:   configDir,
		OutputDir:   outputDir,
		AppPath:     appPath,
		SecretsPath: secretsPath,
		ComposePath: composePath,
		GatewayPort: strconv.Itoa(gatewayPort),
		Image:       normalizeImageRef(opts.Image),
	}, nil
}

func reuseProviders(existing *ExistingConfig, answers *Answers) bool {
	if existing == nil {
		return false
	}
	useAnthropic := existing.AnthropicAPIKey != "" || existing.AnthropicToken != "" || existing.HasOAuthAnthropic
	useOpenAI := existing.OpenAIKey != ""
	useCodex := existing.HasOAuthCodex

	count := 0
	if useAnthropic {
		count++
	}
	if useOpenAI {
		count++
	}
	if useCodex {
		count++
	}
	if count == 0 {
		return false
	}

	switch {
	case count > 1:
		answers.ProviderChoice = "multiple"
	case useAnthropic:
		answers.ProviderChoice = "anthropic"
	case useOpenAI:
		answers.ProviderChoice = "openai"
	case useCodex:
		answers.ProviderChoice = "openai-codex"
	}

	if existing.AnthropicToken != "" {
		answers.AnthropicCredential = existing.AnthropicToken
	} else if existing.AnthropicAPIKey != "" {
		answers.AnthropicCredential = existing.AnthropicAPIKey
	}
	if existing.OpenAIKey != "" {
		answers.OpenAIKey = existing.OpenAIKey
	}
	return true
}

func reuseChannels(existing *ExistingConfig, answers *Answers) bool {
	if existing == nil {
		return false
	}
	hasDiscordToken := strings.TrimSpace(existing.DiscordToken) != ""
	hasTelegramToken := strings.TrimSpace(existing.TelegramToken) != ""
	if !hasDiscordToken && !hasTelegramToken {
		return false
	}

	switch {
	case hasDiscordToken && hasTelegramToken:
		answers.ChannelChoice = "both"
	case hasDiscordToken:
		answers.ChannelChoice = "discord"
	default:
		answers.ChannelChoice = "telegram"
	}
	if hasDiscordToken {
		answers.DiscordToken = existing.DiscordToken
	}
	if hasTelegramToken {
		answers.TelegramToken = existing.TelegramToken
	}
	return true
}

func shouldReuseChannelTokenWithoutPrompt(reuseExisting bool, existing *ExistingConfig, token string) bool {
	return reuseExisting && existing != nil && strings.TrimSpace(token) != ""
}

func describeExistingSignals(existing *ExistingConfig) []string {
	if existing == nil {
		return nil
	}
	lines := make([]string, 0, 16)
	secretEntries := make([]DetectedSecretEntry, len(existing.DetectedSecrets))
	copy(secretEntries, existing.DetectedSecrets)
	sort.SliceStable(secretEntries, func(i, j int) bool {
		pi := secretDisplayPriority(secretEntries[i].Path)
		pj := secretDisplayPriority(secretEntries[j].Path)
		if pi != pj {
			return pi < pj
		}
		return secretEntries[i].Path < secretEntries[j].Path
	})
	for _, entry := range secretEntries {
		lines = append(lines, fmt.Sprintf("secrets.%s: %s", entry.Path, maskCredential(entry.Value)))
	}
	if existing.OpenAICodexOAuth != nil {
		expires := "unknown"
		if existing.OpenAICodexOAuth.ExpiresKnown {
			expires = existing.OpenAICodexOAuth.ExpiresAt.UTC().Format("2006-01-02 15:04 MST")
		}
		line := fmt.Sprintf("auth.openai-codex: expires %s", expires)
		if strings.TrimSpace(existing.OpenAICodexOAuth.Email) != "" {
			line += fmt.Sprintf(" (%s)", existing.OpenAICodexOAuth.Email)
		}
		lines = append(lines, line)
	}
	if existing.AnthropicOAuth != nil {
		expires := "unknown"
		if existing.AnthropicOAuth.ExpiresKnown {
			expires = existing.AnthropicOAuth.ExpiresAt.UTC().Format("2006-01-02 15:04 MST")
		}
		line := fmt.Sprintf("auth.anthropic: expires %s", expires)
		if strings.TrimSpace(existing.AnthropicOAuth.Email) != "" {
			line += fmt.Sprintf(" (%s)", existing.AnthropicOAuth.Email)
		}
		lines = append(lines, line)
	}
	if existing.HasMCP {
		presets := cloneSlice(existing.MCPPresets)
		if len(presets) == 0 {
			lines = append(lines, "app.mcp: enabled")
		} else {
			lines = append(lines, "app.mcp.presets: "+strings.Join(presets, ", "))
		}
	}
	return lines
}

func secretDisplayPriority(path string) int {
	path = strings.ToLower(strings.TrimSpace(path))
	switch {
	case strings.HasPrefix(path, "discord."):
		return 0
	case strings.HasPrefix(path, "telegram."):
		return 1
	case strings.HasPrefix(path, "openai."):
		return 2
	case strings.HasPrefix(path, "openai-compatible."):
		return 3
	case strings.HasPrefix(path, "anthropic."):
		return 4
	case strings.HasPrefix(path, "gateway."):
		return 5
	default:
		return 99
	}
}

func buildExistingHighlights(displayConfigDir string, existing *ExistingConfig) []string {
	lines := []string{
		"Existing configuration detected",
		"Reuse saved settings or enter new values.",
	}
	return append(lines, describeExistingSignals(existing)...)
}

func maskCredential(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "(empty)"
	}
	runes := []rune(value)
	switch {
	case len(runes) <= 4:
		return strings.Repeat("*", len(runes))
	case len(runes) <= 8:
		return string(runes[:1]) + strings.Repeat("*", len(runes)-2) + string(runes[len(runes)-1:])
	default:
		return string(runes[:4]) + "..." + string(runes[len(runes)-4:])
	}
}

func summarizeReview(a Answers, configDir, outputDir string) []string {
	providers := strings.Join(providerIDs(a), ", ")
	if providers == "" {
		providers = "none"
	}
	channelSummary := a.ChannelChoice
	if channelSummary == "" {
		channelSummary = "none"
	}
	writeAllow := DeriveWriteToolAllowList(a.DiscordMemberAllowList, a.TelegramAllowList, a.AdditionalWriteToolAllowList)
	writeMode := "disabled"
	if a.EnableWriteToolsForAllowlist && len(writeAllow) > 0 {
		writeMode = fmt.Sprintf("enabled (%d users)", len(writeAllow))
	}
	mcpSummary := "disabled"
	if a.EnableMCP {
		if len(a.MCPPresets) > 0 {
			mcpSummary = "enabled (" + strings.Join(a.MCPPresets, ", ") + ")"
		} else {
			mcpSummary = "enabled"
		}
	}
	return []string{
		fmt.Sprintf("Providers: %s", providers),
		fmt.Sprintf("Channels: %s", channelSummary),
		fmt.Sprintf("MCP: %s", mcpSummary),
		fmt.Sprintf("Gateway: 127.0.0.1:%s -> 8787", a.GatewayPort),
		fmt.Sprintf("Timezone: %s", a.Timezone),
		fmt.Sprintf("Write tools: %s", writeMode),
		fmt.Sprintf("Output app.yaml: %s", displayPath(filepath.Join(configDir, "app.yaml"))),
		fmt.Sprintf("Output secrets.yaml: %s", displayPath(filepath.Join(configDir, "secrets.yaml"))),
		fmt.Sprintf("Output docker-compose.yml: %s", displayPath(filepath.Join(outputDir, "docker-compose.yml"))),
	}
}

func providerIDs(a Answers) []string {
	providers := []string{}
	addAnthropic := a.ProviderChoice == "anthropic" || a.ProviderChoice == "multiple"
	addOpenAI := a.ProviderChoice == "openai" || a.ProviderChoice == "multiple"
	addCodex := a.ProviderChoice == "openai-codex" || a.ProviderChoice == "multiple"
	addCompatible := a.ProviderChoice == "openai-compatible" || a.ProviderChoice == "multiple"
	if addAnthropic {
		providers = append(providers, "anthropic")
	}
	if addOpenAI {
		providers = append(providers, "openai")
	}
	if addCodex {
		providers = append(providers, "openai-codex")
	}
	if addCompatible {
		providers = append(providers, "openai-compatible")
	}
	return providers
}

func parseCSV(v string) []string {
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		s := strings.TrimSpace(p)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "0123456789abcdef0123456789abcdef"
	}
	return hex.EncodeToString(b)
}

func expandHome(path string) string {
	if path == "" || path[0] != '~' {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	if path == "~" {
		return home
	}
	if strings.HasPrefix(path, "~/") {
		return filepath.Join(home, path[2:])
	}
	return path
}

func joinCSV(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return strings.Join(values, ", ")
}

func resetProviderAnswers(a *Answers) {
	if a == nil {
		return
	}
	a.ProviderChoice = "anthropic"
	a.AnthropicCredential = ""
	a.OpenAIKey = ""
	a.OpenAICompatibleKey = ""
	a.OpenAICompatibleBaseURL = "http://host.docker.internal:11434/v1"
	a.AnthropicModel = "claude-opus-4-5"
	a.OpenAIModel = "gpt-5.2"
	a.OpenAICodexModel = "gpt-5.2"
	a.OpenAICompatibleModel = "llama3.2"
}

func resetChannelAnswers(a *Answers) {
	if a == nil {
		return
	}
	a.ChannelChoice = "discord"
	a.DiscordToken = ""
	a.TelegramToken = ""
}

func providerStageMenu() ([]string, []string) {
	return []string{
			"Anthropic (Claude)",
			"OpenAI",
			"OpenAI Codex (OAuth)",
			"OpenAI-compatible",
			"Multiple providers (fallback chain)",
			"Skip now",
		}, []string{
			"Recommended default: fastest way to start with Claude using a key or setup token.",
			"Broad OpenAI model coverage for teams already using OpenAI accounts.",
			"Sign in with OAuth for team-friendly account management.",
			"Use self-hosted or third-party OpenAI-compatible endpoints.",
			"Automatic fallback across providers (trade-offs: cost and consistency).",
			"Keep defaults and continue. You can update provider settings later.",
		}
}

func channelStageMenu() ([]string, []string) {
	return []string{
			"Discord",
			"Telegram",
			"Both",
			"Skip now",
		}, []string{
			"Use Discord bot channel integration.",
			"Use Telegram bot channel integration.",
			"Enable both platforms with one setup.",
			"Skip channel setup for now and continue.",
		}
}

func availableMCPPresets() []string {
	return []string{"playwright"}
}

func mcpPresetDescriptions(presets []string) []string {
	descriptions := make([]string, 0, len(presets))
	for _, preset := range presets {
		switch strings.ToLower(strings.TrimSpace(preset)) {
		case "playwright":
			descriptions = append(descriptions, "Browser automation tools for navigation, extraction, and testing.")
		default:
			descriptions = append(descriptions, "Enable MCP preset: "+preset+".")
		}
	}
	return descriptions
}

func containsString(values []string, target string) bool {
	target = strings.TrimSpace(target)
	if target == "" {
		return false
	}
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), target) {
			return true
		}
	}
	return false
}

func recommendedProviderFromIndex(index int) string {
	switch index {
	case 0:
		return "anthropic"
	case 2:
		return "openai-codex"
	case 3:
		return "openai-compatible"
	case 4:
		return "multiple"
	default:
		return "anthropic"
	}
}

func recommendedProviderIndex(existing *ExistingConfig) int {
	if existing == nil {
		return 0 // Anthropic (Claude)
	}
	connected := connectedProviderIndexes(existing)
	if len(connected) == 0 {
		return 0
	}
	if len(connected) == 1 {
		return connected[0]
	}
	return 4 // Multiple providers
}

func connectedProviderIndexes(existing *ExistingConfig) []int {
	if existing == nil {
		return nil
	}
	indexes := make([]int, 0, 4)
	if strings.TrimSpace(existing.AnthropicAPIKey) != "" || strings.TrimSpace(existing.AnthropicToken) != "" || oauthSessionUsable(existing.AnthropicOAuth) {
		indexes = append(indexes, 0)
	}
	if strings.TrimSpace(existing.OpenAIKey) != "" {
		indexes = append(indexes, 1)
	}
	if oauthSessionUsable(existing.OpenAICodexOAuth) {
		indexes = append(indexes, 2)
	}
	if strings.TrimSpace(existing.OpenAICompatibleKey) != "" {
		indexes = append(indexes, 3)
	}
	return indexes
}

func oauthSessionUsable(detail *OAuthSessionDetail) bool {
	if detail == nil {
		return false
	}
	if !detail.ExpiresKnown {
		return true
	}
	return detail.ExpiresAt.After(time.Now().UTC())
}

func currentHomeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}

func displayPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}

	home := currentHomeDir()
	if home == "" {
		return path
	}

	cleanPath := filepath.Clean(path)
	cleanHome := filepath.Clean(home)
	if cleanPath == cleanHome {
		return "~"
	}

	prefix := cleanHome + string(filepath.Separator)
	if strings.HasPrefix(cleanPath, prefix) {
		rel := strings.TrimPrefix(cleanPath, prefix)
		rel = strings.ReplaceAll(rel, string(filepath.Separator), "/")
		if rel == "" {
			return "~"
		}
		return "~/" + rel
	}

	return path
}
