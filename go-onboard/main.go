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
	"os/exec"
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
	tty, err := openTTYDevice()
	if err == nil && tty != nil {
		return tty, true, bufio.NewReader(tty)
	}
	return os.Stdin, false, bufio.NewReader(os.Stdin)
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

func (w *wizardSession) runWizard(opts cliOptions) (Answers, error) {
	const maxSetupStage = 4

	answers := Answers{
		ProviderChoice:               "anthropic",
		AnthropicModel:               "claude-opus-4-5",
		OpenAIModel:                  "gpt-5.2",
		OpenAICodexModel:             "gpt-5.2",
		OpenAICompatibleModel:        "llama3.2",
		OpenAICompatibleBaseURL:      "http://host.docker.internal:11434/v1",
		ChannelChoice:                "discord",
		GatewayPort:                  "8787",
		GatewayToken:                 randomHex(16),
		Timezone:                     "UTC",
		EnableWriteToolsForAllowlist: true,
	}

	configDir := expandHome(strings.TrimSpace(opts.ConfigDir))
	outputDir := expandHome(strings.TrimSpace(opts.OutputDir))
	displayConfigDir := displayPath(configDir)
	displayOutputDir := displayPath(outputDir)

	if err := w.ensureDockerReady(displayConfigDir, displayOutputDir); err != nil {
		return Answers{}, err
	}

	existing, err := DetectExistingConfig(configDir)
	if err != nil {
		return Answers{}, err
	}
	reuseExisting := false
	stage := 0

	for {
		switch stage {
		case 0:
			w.stepIndex = 0
			highlights := []string{
				"Mode: Docker setup",
				fmt.Sprintf("Config directory: %s", displayConfigDir),
				fmt.Sprintf("Output directory: %s", displayOutputDir),
			}
			if existing != nil {
				highlights = buildExistingHighlights(displayConfigDir, existing)
				reuseChoice, askErr := w.askOptionWithDetails(
					"Welcome",
					"Reuse saved setup from this machine?",
					[]string{"Yes", "No"},
					[]string{
						"Recommended: continue with detected settings.",
						"Start fresh and enter new values manually.",
					},
					0,
					0,
					highlights,
				)
				if askErr != nil {
					if errors.Is(askErr, errBackRequested) {
						continue
					}
					if _, jump := asStepJumpRequested(askErr); jump {
						continue
					}
					return Answers{}, askErr
				}
				reuseExisting = reuseChoice == 0
				if reuseExisting {
					w.conversation = append(w.conversation, "Assistant: Great, I'll reuse what we already trust.")
				} else {
					w.conversation = append(w.conversation, "Assistant: Got it. We'll enter fresh values.")
				}
			} else {
				_, err = w.askOption(
					"Welcome",
					"No existing configuration was found. Continue with a fresh setup?",
					[]string{"Continue"},
					0,
					highlights,
				)
				if err != nil {
					if errors.Is(err, errBackRequested) {
						continue
					}
					if _, jump := asStepJumpRequested(err); jump {
						continue
					}
					return Answers{}, err
				}
			}
			stage = 1

		case 1:
			w.stepIndex = 1
			reusedProviders := false
			if reuseExisting && existing != nil {
				reusedProviders = reuseProviders(existing, &answers)
				if reusedProviders {
					w.conversation = append(w.conversation, "Assistant: Reused your saved provider settings.")
				}
			}
			if !reusedProviders {
				resetProviderAnswers(&answers)
				providerOptions, providerDetails := providerStageMenu()
				providerChoice, askErr := w.askOptionWithDetails(
					"Provider",
					"Which AI provider should OwliaBot use?",
					providerOptions,
					providerDetails,
					recommendedProviderIndex(existing),
					recommendedProviderIndex(existing),
					[]string{"Choose the AI provider OwliaBot should use for this workspace."},
				)
				if askErr != nil {
					if errors.Is(askErr, errBackRequested) {
						stage = 0
						continue
					}
					if target, jump := asStepJumpRequested(askErr); jump {
						stage = clamp(0, target, maxSetupStage)
						continue
					}
					return Answers{}, askErr
				}
				switch providerChoice {
				case 1:
					answers.ProviderChoice = "openai"
				case 2:
					answers.ProviderChoice = "openai-codex"
				case 3:
					answers.ProviderChoice = "openai-compatible"
				case 4:
					answers.ProviderChoice = "multiple"
				case 5:
					answers.ProviderChoice = recommendedProviderFromIndex(recommendedProviderIndex(existing))
					w.conversation = append(w.conversation, "Assistant: Provider setup skipped for now. Defaults were kept.")
					break
				default:
					answers.ProviderChoice = "anthropic"
				}

				if providerChoice == 5 {
					stage = 2
					continue
				}

				if answers.ProviderChoice == "anthropic" || answers.ProviderChoice == "multiple" {
					credential, inputErr := w.askInput(
						"Provider",
						"Anthropic setup token or API key (optional)",
						answers.AnthropicCredential,
						[]string{
							"Leave blank to use environment variables.",
							fmt.Sprintf("Saved securely in %s", displayPath(filepath.Join(configDir, "secrets.yaml"))),
						},
					)
					if inputErr != nil {
						if target, jump := asStepJumpRequested(inputErr); jump {
							stage = clamp(0, target, maxSetupStage)
							continue
						}
						return Answers{}, inputErr
					}
					answers.AnthropicCredential = credential
					model, modelErr := w.askModelWithOptions(
						"Provider",
						"Choose an Anthropic model",
						answers.AnthropicModel,
						anthropicModelPresets,
						[]string{"Model selection uses quick options. Choose Custom for manual input."},
					)
					if modelErr != nil {
						if target, jump := asStepJumpRequested(modelErr); jump {
							stage = clamp(0, target, maxSetupStage)
							continue
						}
						return Answers{}, modelErr
					}
					answers.AnthropicModel = model
				}

				if answers.ProviderChoice == "openai" || answers.ProviderChoice == "multiple" {
					key, keyErr := w.askInput(
						"Provider",
						"OpenAI API key (optional)",
						answers.OpenAIKey,
						[]string{
							"Leave blank to use environment variables.",
							fmt.Sprintf("Saved securely in %s", displayPath(filepath.Join(configDir, "secrets.yaml"))),
						},
					)
					if keyErr != nil {
						if target, jump := asStepJumpRequested(keyErr); jump {
							stage = clamp(0, target, maxSetupStage)
							continue
						}
						return Answers{}, keyErr
					}
					answers.OpenAIKey = key
					model, modelErr := w.askModelWithOptions(
						"Provider",
						"Choose an OpenAI model",
						answers.OpenAIModel,
						openAIModelPresets,
						[]string{"Model selection uses quick options. Choose Custom for manual input."},
					)
					if modelErr != nil {
						if target, jump := asStepJumpRequested(modelErr); jump {
							stage = clamp(0, target, maxSetupStage)
							continue
						}
						return Answers{}, modelErr
					}
					answers.OpenAIModel = model
				}

				if answers.ProviderChoice == "openai-codex" || answers.ProviderChoice == "multiple" {
					model, modelErr := w.askModelWithOptions(
						"Provider",
						"Choose an OpenAI Codex model",
						answers.OpenAICodexModel,
						openAICodexModelPresets,
						[]string{"Model selection uses quick options. Choose Custom for manual input."},
					)
					if modelErr != nil {
						if target, jump := asStepJumpRequested(modelErr); jump {
							stage = clamp(0, target, maxSetupStage)
							continue
						}
						return Answers{}, modelErr
					}
					answers.OpenAICodexModel = model
					runOAuth, oauthErr := w.askYN(
						"Provider",
						"Start OpenAI Codex OAuth now?",
						false,
						[]string{"You can complete Device Code login during onboarding (before Docker startup)."},
					)
					if oauthErr != nil {
						if errors.Is(oauthErr, errBackRequested) {
							stage = 1
							continue
						}
						if target, jump := asStepJumpRequested(oauthErr); jump {
							stage = clamp(0, target, maxSetupStage)
							continue
						}
						return Answers{}, oauthErr
					}
					if runOAuth {
						if err := handleOpenAICodexOAuthNowFn(w, configDir); err != nil {
							if errors.Is(err, errBackRequested) {
								stage = 1
								continue
							}
							if target, jump := asStepJumpRequested(err); jump {
								stage = clamp(0, target, maxSetupStage)
								continue
							}
							return Answers{}, err
						}
						w.conversation = append(w.conversation, "Assistant: Great. I'll guide you into the Device Code OAuth flow now.")
					} else {
						w.conversation = append(w.conversation, "Assistant: We'll keep OAuth as a next step.")
					}
				}

				if answers.ProviderChoice == "openai-compatible" || answers.ProviderChoice == "multiple" {
					baseURL, baseErr := w.askInput("Provider", "OpenAI-compatible base URL", answers.OpenAICompatibleBaseURL, nil)
					if baseErr != nil {
						if target, jump := asStepJumpRequested(baseErr); jump {
							stage = clamp(0, target, maxSetupStage)
							continue
						}
						return Answers{}, baseErr
					}
					answers.OpenAICompatibleBaseURL = baseURL
					model, modelErr := w.askModelWithOptions(
						"Provider",
						"Choose an OpenAI-compatible model",
						answers.OpenAICompatibleModel,
						openAICompatibleModelPresets,
						[]string{"Model selection uses quick options. Choose Custom for manual input."},
					)
					if modelErr != nil {
						if target, jump := asStepJumpRequested(modelErr); jump {
							stage = clamp(0, target, maxSetupStage)
							continue
						}
						return Answers{}, modelErr
					}
					answers.OpenAICompatibleModel = model
					key, keyErr := w.askInput(
						"Provider",
						"OpenAI-compatible API key (optional)",
						answers.OpenAICompatibleKey,
						[]string{
							"Leave blank if your endpoint does not require a key.",
							fmt.Sprintf("Saved securely in %s", displayPath(filepath.Join(configDir, "secrets.yaml"))),
						},
					)
					if keyErr != nil {
						if target, jump := asStepJumpRequested(keyErr); jump {
							stage = clamp(0, target, maxSetupStage)
							continue
						}
						return Answers{}, keyErr
					}
					answers.OpenAICompatibleKey = key
				}
			}
			w.conversation = append(w.conversation, fmt.Sprintf("Assistant: Provider set to `%s`.", answers.ProviderChoice))
			stage = 2

		case 2:
			w.stepIndex = 2
			reusedChannels := false
			if reuseExisting && existing != nil {
				reusedChannels = reuseChannels(existing, &answers)
				if reusedChannels {
					w.conversation = append(w.conversation, "Assistant: Channel tokens were reused from existing secrets.")
				}
			}
			if !reusedChannels {
				resetChannelAnswers(&answers)
				channelOptions, channelDetails := channelStageMenu()
				channelChoice, chErr := w.askOptionWithDetails(
					"Channels",
					"Which chat channels should be enabled?",
					channelOptions,
					channelDetails,
					0,
					0,
					[]string{"This stage only handles platform/token selection."},
				)
				if chErr != nil {
					if errors.Is(chErr, errBackRequested) {
						stage = 1
						continue
					}
					if target, jump := asStepJumpRequested(chErr); jump {
						stage = clamp(0, target, maxSetupStage)
						continue
					}
					return Answers{}, chErr
				}
				if channelChoice == 1 {
					answers.ChannelChoice = "telegram"
				} else if channelChoice == 2 {
					answers.ChannelChoice = "both"
				} else if channelChoice == 3 {
					answers.ChannelChoice = "none"
					answers.DiscordChannelAllowList = nil
					answers.DiscordMemberAllowList = nil
					answers.TelegramAllowList = nil
					answers.AdditionalWriteToolAllowList = nil
					answers.EnableWriteToolsForAllowlist = false
					w.conversation = append(w.conversation, "Assistant: Channels skipped for now.")
					stage = 3
					continue
				} else {
					answers.ChannelChoice = "discord"
				}

				if hasDiscord(answers.ChannelChoice) {
					if shouldReuseChannelTokenWithoutPrompt(reuseExisting, existing, existing.DiscordToken) {
						answers.DiscordToken = existing.DiscordToken
						w.conversation = append(w.conversation, "Assistant: Reusing saved Discord connection.")
					} else {
						discordToken, tokenErr := w.askInput("Channels", "Discord bot token (optional)", answers.DiscordToken, []string{"Message Content Intent must be enabled in Discord developer portal."})
						if tokenErr != nil {
							if target, jump := asStepJumpRequested(tokenErr); jump {
								stage = clamp(0, target, maxSetupStage)
								continue
							}
							return Answers{}, tokenErr
						}
						answers.DiscordToken = discordToken
					}
				}
				if hasTelegram(answers.ChannelChoice) {
					if shouldReuseChannelTokenWithoutPrompt(reuseExisting, existing, existing.TelegramToken) {
						answers.TelegramToken = existing.TelegramToken
						w.conversation = append(w.conversation, "Assistant: Reusing saved Telegram connection.")
					} else {
						telegramToken, tokenErr := w.askInput("Channels", "Telegram bot token (optional)", answers.TelegramToken, []string{"Create a Telegram bot token with @BotFather."})
						if tokenErr != nil {
							if target, jump := asStepJumpRequested(tokenErr); jump {
								stage = clamp(0, target, maxSetupStage)
								continue
							}
							return Answers{}, tokenErr
						}
						answers.TelegramToken = telegramToken
					}
				}
			}
			w.conversation = append(w.conversation, fmt.Sprintf("Assistant: Channels set to `%s`.", answers.ChannelChoice))
			if reuseExisting && existing != nil && strings.TrimSpace(existing.GatewayToken) != "" {
				answers.GatewayToken = existing.GatewayToken
			}
			answers.DiscordChannelAllowList = nil
			answers.DiscordMemberAllowList = nil
			answers.TelegramAllowList = nil
			answers.AdditionalWriteToolAllowList = nil
			answers.EnableWriteToolsForAllowlist = false
			stage = 3

		case 3:
			w.stepIndex = 3
			presets := availableMCPPresets()
			defaultSelected := []int{}
			if reuseExisting && existing != nil && existing.HasMCP {
				if len(existing.MCPPresets) == 0 {
					for i := range presets {
						defaultSelected = append(defaultSelected, i)
					}
				} else {
					for i, preset := range presets {
						if containsString(existing.MCPPresets, preset) {
							defaultSelected = append(defaultSelected, i)
						}
					}
				}
			}
			selectedIndexes, mcpErr := w.askMultiSelectWithDetails(
				"MCP",
				"Select MCP presets to enable",
				presets,
				mcpPresetDescriptions(presets),
				defaultSelected,
				[]string{"Available presets: " + strings.Join(presets, ", ")},
			)
			if mcpErr != nil {
				if errors.Is(mcpErr, errBackRequested) {
					stage = 2
					continue
				}
				if target, jump := asStepJumpRequested(mcpErr); jump {
					stage = clamp(0, target, maxSetupStage)
					continue
				}
				return Answers{}, mcpErr
			}
			if len(selectedIndexes) > 0 {
				selectedPresets := make([]string, 0, len(selectedIndexes))
				for _, idx := range selectedIndexes {
					if idx >= 0 && idx < len(presets) {
						selectedPresets = append(selectedPresets, presets[idx])
					}
				}
				answers.EnableMCP = len(selectedPresets) > 0
				answers.MCPPresets = cloneSlice(selectedPresets)
				if answers.EnableMCP {
					w.conversation = append(w.conversation, "Assistant: MCP enabled for "+strings.Join(selectedPresets, ", ")+".")
				}
			} else {
				answers.EnableMCP = false
				answers.MCPPresets = nil
				w.conversation = append(w.conversation, "Assistant: MCP skipped for now.")
			}
			stage = 4

		case 4:
			w.stepIndex = 4
			reviewLines := summarizeReview(answers, configDir, outputDir)
			confirm, confirmErr := w.askOption(
				"Review",
				"Everything looks ready. Start initialization now?",
				[]string{"Start initialization", "Cancel"},
				0,
				reviewLines,
			)
			if confirmErr != nil {
				if errors.Is(confirmErr, errBackRequested) {
					stage = 3
					continue
				}
				if target, jump := asStepJumpRequested(confirmErr); jump {
					stage = clamp(0, target, maxSetupStage)
					continue
				}
				return Answers{}, confirmErr
			}
			if confirm != 0 {
				return Answers{}, errors.New("cancelled by user")
			}
			return answers, nil
		}
	}
}

func (w *wizardSession) ensureDockerReady(displayConfigDir, displayOutputDir string) error {
	for {
		status := detectDockerStatus()
		if status.Installed && status.Running {
			return nil
		}

		highlights := buildDockerHighlights(displayConfigDir, displayOutputDir, status)
		if !status.Installed {
			choice, err := w.askOptionWithDetails(
				"Welcome",
				"Docker is required for initialization. What would you like to do?",
				[]string{"Retry check", "Show install steps", "Exit onboarding"},
				[]string{
					"Retry after installing Docker.",
					"Show quick install guidance for Docker Desktop.",
					"Exit now and run onboarding later.",
				},
				0,
				0,
				highlights,
			)
			if err != nil {
				if _, jump := asStepJumpRequested(err); jump {
					continue
				}
				return err
			}
			switch choice {
			case 0:
				continue
			case 1:
				w.conversation = append(
					w.conversation,
					"Assistant: Install Docker Desktop from https://docs.docker.com/get-docker/.",
					"Assistant: After installation, re-run the Docker check.",
				)
				continue
			default:
				return errors.New("cancelled by user")
			}
		}

		choice, err := w.askOptionWithDetails(
			"Welcome",
			"Docker is installed, but the Docker engine is not running. What would you like to do?",
			[]string{"Retry check", "Show start steps", "Exit onboarding"},
			[]string{
				"Retry after starting Docker Desktop / Docker daemon.",
				"Show quick steps to start Docker on your OS.",
				"Exit now and run onboarding later.",
			},
			0,
			0,
			highlights,
		)
		if err != nil {
			if _, jump := asStepJumpRequested(err); jump {
				continue
			}
			return err
		}
		switch choice {
		case 0:
			continue
		case 1:
			w.conversation = append(
				w.conversation,
				"Assistant: macOS/Windows: open Docker Desktop and wait until status is running.",
				"Assistant: Linux: run `sudo systemctl start docker`, then retry.",
			)
			continue
		default:
			return errors.New("cancelled by user")
		}
	}
}

func (w *wizardSession) runPostActions(result applyResult) bool {
	lastAction := ""
	buildHighlights := func() []string {
		highlights := []string{
			fmt.Sprintf("Gateway URL: http://localhost:%s", result.GatewayPort),
			fmt.Sprintf("Config directory: %s", displayPath(result.ConfigDir)),
			fmt.Sprintf("Default image: %s", normalizeImageRef(result.Image)),
		}
		if strings.TrimSpace(lastAction) != "" {
			highlights = append(highlights, "Last action: "+lastAction)
		}
		return highlights
	}

	for {
		choice, err := w.askOptionWithDetails(
			"Complete",
			"Initialization finished. What do you want to do next?",
			[]string{
				"Start OwliaBot now",
				"Start with specific tag/version",
				"Show start command",
				"Show open-directory command",
				"Exit",
			},
			[]string{
				"Recommended. Starts OwliaBot with the configured image and checks for updates.",
				"Enter a tag like `latest` or `v1.2.3`, then start with that image.",
				"Print the exact command without running it.",
				"Print a command to open the output directory.",
				"Leave onboarding.",
			},
			0,
			0,
			buildHighlights(),
		)
		if err != nil {
			if _, jump := asStepJumpRequested(err); jump {
				continue
			}
			return false
		}
		switch choice {
		case 0:
			imageRef, resolveErr := w.resolveImageForLaunch(result.Image, false)
			if resolveErr != nil {
				lastAction = fmt.Sprintf("Start cancelled (%v)", resolveErr)
				w.conversation = append(w.conversation, fmt.Sprintf("Assistant: Start cancelled (%v).", resolveErr))
				continue
			}
			highlights := []string{
				fmt.Sprintf("Image: %s", imageRef),
				fmt.Sprintf("Output directory: %s", displayPath(result.OutputDir)),
			}
			if err := w.runSpinner(
				"Complete",
				highlights,
				func() error { return startDockerComposeFn(result.OutputDir, imageRef) },
			); err != nil {
				lastAction = fmt.Sprintf("Failed to start container (%v)", err)
				w.conversation = append(w.conversation, fmt.Sprintf("Assistant: Failed to start container: %v", err))
				continue
			}
			lastAction = fmt.Sprintf("Container started (%s)", imageRef)
			w.conversation = append(w.conversation, fmt.Sprintf("Assistant: Container started with image `%s`.", imageRef))
			return true
		case 1:
			imageRef, resolveErr := w.resolveImageForLaunch(result.Image, true)
			if resolveErr != nil {
				lastAction = fmt.Sprintf("Start cancelled (%v)", resolveErr)
				w.conversation = append(w.conversation, fmt.Sprintf("Assistant: Start cancelled (%v).", resolveErr))
				continue
			}
			highlights := []string{
				fmt.Sprintf("Image: %s", imageRef),
				fmt.Sprintf("Output directory: %s", displayPath(result.OutputDir)),
			}
			if err := w.runSpinner(
				"Complete",
				highlights,
				func() error { return startDockerComposeFn(result.OutputDir, imageRef) },
			); err != nil {
				lastAction = fmt.Sprintf("Failed to start container (%v)", err)
				w.conversation = append(w.conversation, fmt.Sprintf("Assistant: Failed to start container: %v", err))
				continue
			}
			lastAction = fmt.Sprintf("Container started (%s)", imageRef)
			w.conversation = append(w.conversation, fmt.Sprintf("Assistant: Container started with image `%s`.", imageRef))
			return true
		case 2:
			lastAction = fmt.Sprintf("Run command copied: OWLIABOT_IMAGE=%s docker compose up -d", normalizeImageRef(result.Image))
			w.conversation = append(
				w.conversation,
				fmt.Sprintf("Assistant: Run `OWLIABOT_IMAGE=%s docker compose up -d`", normalizeImageRef(result.Image)),
			)
		case 3:
			lastAction = fmt.Sprintf("Open command copied: open %s", displayPath(result.OutputDir))
			w.conversation = append(w.conversation, fmt.Sprintf("Assistant: Run `open %s`", displayPath(result.OutputDir)))
		default:
			clearTerminalViewFn()
			return false
		}
	}
}

func printRunningNotice(gatewayPort, outputDir string) {
	url := fmt.Sprintf("http://localhost:%s", strings.TrimSpace(gatewayPort))
	if strings.TrimSpace(gatewayPort) == "" {
		url = "http://localhost:8787"
	}
	// Ensure we leave the dashboard canvas and print a plain terminal summary.
	disableMouseTracking()
	fmt.Print("\033[2J\033[H")
	brand := brandASCIIColor()
	for _, line := range runningNoticeBannerLines() {
		fmt.Printf("%s%s%s%s\n", ansiBold, ansiRGB(brand), line, ansiReset)
	}
	fmt.Printf("\n%s OwliaBot is Running\n", ansiGreen+"✓"+ansiReset)
	fmt.Printf("%s %s\n", ansiDim+"Gateway:"+ansiReset, url)
	fmt.Printf("%s %s\n\n", ansiDim+"Output:"+ansiReset, displayPath(outputDir))
}

func clearTerminalView() {
	disableMouseTracking()
	fmt.Print("\033[2J\033[H")
}

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

	cmd := exec.Command("node", "--import", "tsx", "src/entry.ts", "auth", "setup", "openai-codex")
	cmd.Dir = root
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
	if filepath.Base(cwd) == "go-onboard" {
		return filepath.Dir(cwd)
	}
	if fileExists(filepath.Join(cwd, "go-onboard")) && fileExists(filepath.Join(cwd, "src", "entry.ts")) {
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

func (w *wizardSession) askOption(title, question string, options []string, defaultIndex int, highlights []string) (int, error) {
	return w.askOptionWithDetails(title, question, options, nil, defaultIndex, -1, highlights)
}

func (w *wizardSession) askOptionWithDetails(
	title, question string,
	options []string,
	optionDetails []string,
	defaultIndex int,
	recommendedIndex int,
	highlights []string,
) (int, error) {
	if len(options) == 0 {
		return 0, errors.New("options cannot be empty")
	}
	if defaultIndex < 0 || defaultIndex >= len(options) {
		defaultIndex = 0
	}
	if recommendedIndex < 0 || recommendedIndex >= len(options) {
		recommendedIndex = -1
	}
	defer func() {
		w.showHelp = false
	}()

	if canUseRawOptionInput(w.input) {
		if choice, err, ok := w.askOptionRaw(title, question, options, optionDetails, defaultIndex, recommendedIndex, highlights); ok {
			if err == nil || !isInputEOF(err) {
				return choice, err
			}
			w.errorText = "Session restored."
			return w.askOptionLineBuffered(title, question, options, optionDetails, defaultIndex, recommendedIndex, highlights)
		}
	}

	return w.askOptionLineBuffered(title, question, options, optionDetails, defaultIndex, recommendedIndex, highlights)
}

func (w *wizardSession) askMultiSelectWithDetails(
	title, question string,
	options []string,
	optionDetails []string,
	defaultSelected []int,
	highlights []string,
) ([]int, error) {
	if len(options) == 0 {
		return nil, nil
	}
	selected := make([]bool, len(options))
	for _, idx := range defaultSelected {
		if idx >= 0 && idx < len(selected) {
			selected[idx] = true
		}
	}

	cursor := 0
	for i, isSelected := range selected {
		if isSelected {
			cursor = i
			break
		}
	}

	for {
		renderedOptions := make([]string, 0, len(options)+1)
		renderedDetails := make([]string, 0, len(options)+1)
		for i, option := range options {
			marker := " "
			stateText := "Not selected."
			if selected[i] {
				marker = "x"
				stateText = "Selected."
			}
			renderedOptions = append(renderedOptions, fmt.Sprintf("[%s] %s", marker, option))
			detail := ""
			if i < len(optionDetails) {
				detail = strings.TrimSpace(optionDetails[i])
			}
			if detail == "" {
				renderedDetails = append(renderedDetails, stateText)
			} else {
				renderedDetails = append(renderedDetails, detail+" "+stateText)
			}
		}
		renderedOptions = append(renderedOptions, "Done")
		renderedDetails = append(renderedDetails, "Confirm current selection and continue.")

		choice, err := w.askOptionWithDetails(
			title,
			question,
			renderedOptions,
			renderedDetails,
			clamp(0, cursor, len(renderedOptions)-1),
			-1,
			highlights,
		)
		if err != nil {
			return nil, err
		}
		if choice == len(options) {
			result := make([]int, 0, len(options))
			for i, isSelected := range selected {
				if isSelected {
					result = append(result, i)
				}
			}
			return result, nil
		}
		selected[choice] = !selected[choice]
		cursor = choice
	}
}

func (w *wizardSession) askOptionLineBuffered(
	title, question string,
	options []string,
	optionDetails []string,
	defaultIndex int,
	recommendedIndex int,
	highlights []string,
) (int, error) {
	selected := defaultIndex
	for {
		w.renderOptionPrompt(title, question, options, optionDetails, optionInputHint(true), "", selected, recommendedIndex, highlights, "", false, true)
		raw, err := w.reader.ReadString('\n')
		if err != nil {
			if isInputEOF(err) && w.ownsInput {
				w.errorText = "Please choose an option."
				w.reader = bufio.NewReader(w.input)
				continue
			}
			if w.recoverInputOnEOF(err) {
				w.errorText = "Session restored."
				continue
			}
			return 0, err
		}
		raw = strings.TrimSpace(raw)
		if strings.EqualFold(raw, "esc") || strings.EqualFold(raw, "back") {
			return 0, errBackRequested
		}
		if next, moved := applyLineBufferedNavigationInput(raw, selected, len(options)); moved {
			selected = next
			w.errorText = ""
			continue
		}
		if raw == "?" {
			w.showHelp = !w.showHelp
			w.errorText = ""
			continue
		}
		if isArrowUpInput(raw) {
			if selected > 0 {
				selected--
			}
			w.errorText = ""
			continue
		}
		if isArrowDownInput(raw) {
			if selected < len(options)-1 {
				selected++
			}
			w.errorText = ""
			continue
		}
		if raw == "" {
			w.errorText = ""
			return selected, nil
		}
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > len(options) {
			w.errorText = fmt.Sprintf("Please enter a number between 1 and %d.", len(options))
			continue
		}
		w.errorText = ""
		return n - 1, nil
	}
}

func (w *wizardSession) askOptionRaw(
	title, question string,
	options []string,
	optionDetails []string,
	defaultIndex int,
	recommendedIndex int,
	highlights []string,
) (int, error, bool) {
	restoreState, ok := enableRawInputMode(w.input)
	if !ok {
		return 0, nil, false
	}
	defer func() {
		if restoreState != nil {
			restoreState()
		}
	}()

	input := ""
	selected := defaultIndex
	escapeState := 0 // 0=none,1=ESC,2=ESC[,3=ESC[< mouse
	mouseSeq := ""

	for {
		w.renderOptionPrompt(title, question, options, optionDetails, optionInputHint(false), input, selected, recommendedIndex, highlights, "", true, false)

		b := make([]byte, 8)
		nRead, err := w.input.Read(b)
		if err != nil {
			if w.recoverInputOnEOF(err) {
				if restoreState != nil {
					restoreState()
				}
				nextRestore, nextOK := enableRawInputMode(w.input)
				if !nextOK {
					return 0, err, true
				}
				restoreState = nextRestore
				input = ""
				escapeState = 0
				mouseSeq = ""
				w.errorText = "Session restored."
				continue
			}
			return 0, err, true
		}
		if nRead == 0 {
			if escapeState == 1 {
				return 0, errBackRequested, true
			}
			if escapeState != 0 {
				escapeState = 0
				mouseSeq = ""
			}
			continue
		}

		for _, ch := range b[:nRead] {
			if escapeState == 1 {
				if isArrowEscapeLeader(ch) {
					escapeState = 2
					continue
				}
				escapeState = 0
				continue
			}
			if escapeState == 2 {
				switch ch {
				case '<':
					escapeState = 3
					mouseSeq = "<"
					continue
				case 'A':
					escapeState = 0
					if selected > 0 {
						selected--
					}
				case 'B':
					escapeState = 0
					if selected < len(options)-1 {
						selected++
					}
				default:
					escapeState = 0
				}
				input = ""
				w.errorText = ""
				continue
			}
			if escapeState == 3 {
				mouseSeq += string(ch)
				if ch != 'm' && ch != 'M' {
					continue
				}
				escapeState = 0
				msg, ok := parseMouseSGR(mouseSeq)
				mouseSeq = ""
				if !ok {
					continue
				}
				idx, hit := resolveMouseOptionClick(msg, len(options))
				if !hit {
					if w.canJourneyJump() {
						if target, jump := resolveMouseJourneyClick(msg, len(w.steps), w.stepIndex); jump {
							return 0, stepJumpRequestedError{step: target}, true
						}
					}
					continue
				}
				selected = idx
				w.errorText = ""
				input = ""
				return selected, nil, true
			}

			switch ch {
			case 3:
				return 0, errors.New("cancelled by user"), true
			case 27:
				escapeState = 1
			case 13, 10:
				if strings.TrimSpace(input) == "" {
					w.errorText = ""
					return selected, nil, true
				}
				n, err := strconv.Atoi(input)
				if err != nil || n < 1 || n > len(options) {
					w.errorText = fmt.Sprintf("Please enter a number between 1 and %d.", len(options))
					input = ""
					continue
				}
				w.errorText = ""
				return n - 1, nil, true
			case 127, 8:
				if len(input) > 0 {
					input = input[:len(input)-1]
				}
			case '?':
				w.showHelp = !w.showHelp
				w.errorText = ""
			default:
				if ch >= '0' && ch <= '9' {
					if len(input) < 3 {
						input += string(ch)
					}
				}
			}
		}

		if strings.TrimSpace(input) != "" {
			n, err := strconv.Atoi(input)
			if err == nil && n >= 1 && n <= len(options) {
				selected = n - 1
				w.errorText = ""
			}
		}
	}
}

func canUseRawOptionInput(input *os.File) bool {
	if input == nil {
		return false
	}
	fi, err := input.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}

func enableRawInputMode(input *os.File) (func(), bool) {
	if input == nil {
		return nil, false
	}

	stateCmd := exec.Command("stty", "-g")
	stateCmd.Stdin = input
	rawState, err := stateCmd.Output()
	if err != nil {
		return nil, false
	}
	saved := strings.TrimSpace(string(rawState))
	if saved == "" {
		return nil, false
	}

	// Use cbreak-like mode instead of `raw` to keep output post-processing.
	// `stty raw` disables OPOST, which breaks newline rendering in our TUI.
	enableCmd := exec.Command("stty", rawInputSttyArgs()...)
	enableCmd.Stdin = input
	if err := enableCmd.Run(); err != nil {
		return nil, false
	}
	enableMouseTracking()

	restore := func() {
		disableMouseTracking()
		restoreCmd := exec.Command("stty", saved)
		restoreCmd.Stdin = input
		_ = restoreCmd.Run()
	}
	return restore, true
}

func rawInputSttyArgs() []string {
	return []string{"-icanon", "-echo", "min", "0", "time", "1"}
}

func enableMouseTracking() {
	fmt.Print("\033[?1000h\033[?1006h")
}

func disableMouseTracking() {
	fmt.Print("\033[?1000l\033[?1006l")
}

func parseMouseSGR(seq string) (zone.MouseMsg, bool) {
	// Sequence format after ESC[< ... is "<cb;cx;cym|M"
	if len(seq) < 5 || seq[0] != '<' {
		return zone.MouseMsg{}, false
	}
	actionCh := seq[len(seq)-1]
	if actionCh != 'm' && actionCh != 'M' {
		return zone.MouseMsg{}, false
	}

	parts := strings.Split(seq[1:len(seq)-1], ";")
	if len(parts) != 3 {
		return zone.MouseMsg{}, false
	}

	cb, err := strconv.Atoi(parts[0])
	if err != nil {
		return zone.MouseMsg{}, false
	}
	cx, err := strconv.Atoi(parts[1])
	if err != nil {
		return zone.MouseMsg{}, false
	}
	cy, err := strconv.Atoi(parts[2])
	if err != nil {
		return zone.MouseMsg{}, false
	}
	if cx <= 0 || cy <= 0 {
		return zone.MouseMsg{}, false
	}

	buttonCode := cb & 0b11
	button := zone.MouseButtonNone
	switch buttonCode {
	case 0:
		button = zone.MouseButtonLeft
	case 1:
		button = zone.MouseButtonMiddle
	case 2:
		button = zone.MouseButtonRight
	case 3:
		button = zone.MouseButtonNone
	}

	action := zone.MouseActionPress
	if actionCh == 'm' {
		action = zone.MouseActionRelease
	}
	if cb&32 != 0 {
		action = zone.MouseActionMotion
	}

	return zone.MouseMsg{
		X:      cx - 1,
		Y:      cy - 1,
		Button: button,
		Action: action,
		Alt:    cb&8 != 0,
		Ctrl:   cb&16 != 0,
		Shift:  cb&4 != 0,
	}, true
}

func resolveMouseOptionClick(msg zone.MouseMsg, optionsCount int) (int, bool) {
	if msg.Button != zone.MouseButtonLeft {
		return 0, false
	}
	if msg.Action != zone.MouseActionPress && msg.Action != zone.MouseActionRelease {
		return 0, false
	}

	for i := 0; i < optionsCount; i++ {
		z := zone.Get(optionZoneID(i))
		if z != nil && z.InBounds(msg) {
			return i, true
		}
	}
	return 0, false
}

func resolveMouseJourneyClick(msg zone.MouseMsg, stepsCount int, activeStep int) (int, bool) {
	if msg.Button != zone.MouseButtonLeft {
		return 0, false
	}
	if msg.Action != zone.MouseActionPress && msg.Action != zone.MouseActionRelease {
		return 0, false
	}
	if stepsCount <= 0 {
		return 0, false
	}
	if activeStep < 0 {
		activeStep = 0
	}
	if activeStep >= stepsCount {
		activeStep = stepsCount - 1
	}

	for i := 0; i <= activeStep; i++ {
		z := zone.Get(journeyZoneID(i))
		if z != nil && z.InBounds(msg) {
			return i, true
		}
	}
	return 0, false
}

func (w *wizardSession) askInput(title, question string, defaultValue string, highlights []string) (string, error) {
	// Text input is intentionally line-buffered for reliability across tmux/script/bun wrappers.
	// Raw mode can drop visual echo in some pseudo-tty setups, making users think input was ignored.
	return w.askInputLineBuffered(title, question, defaultValue, highlights)
}

func (w *wizardSession) askInputLineBuffered(title, question string, defaultValue string, highlights []string) (string, error) {
	setLineInputModeFn(w.input)
	for {
		q := question
		if strings.TrimSpace(defaultValue) != "" {
			q = fmt.Sprintf("%s (default: %s)", question, defaultValue)
		}
		w.render(title, q, nil, "Type text and press Enter (click Journey to jump back)", "", -1, highlights, "", false)
		raw, err := w.reader.ReadString('\n')
		if err != nil {
			if w.recoverInputOnEOF(err) {
				w.errorText = "Session restored."
				continue
			}
			return "", err
		}
		raw = strings.TrimSpace(raw)
		if raw == "" {
			w.errorText = ""
			return defaultValue, nil
		}
		w.errorText = ""
		return raw, nil
	}
}

func setLineInputMode(input *os.File) {
	if input == nil {
		return
	}
	cmd := exec.Command("stty", "icanon", "echo")
	cmd.Stdin = input
	_ = cmd.Run()
}

func (w *wizardSession) askInputRaw(title, question string, defaultValue string, highlights []string) (string, error, bool) {
	restoreState, ok := enableRawInputMode(w.input)
	if !ok {
		return "", nil, false
	}
	defer restoreState()

	input := ""
	escapeState := 0 // 0=none,1=ESC,2=ESC[,3=ESC[< mouse
	mouseSeq := ""

	for {
		q := question
		if strings.TrimSpace(defaultValue) != "" {
			q = fmt.Sprintf("%s (default: %s)", question, defaultValue)
		}
		w.render(title, q, nil, "Type text and press Enter (click Journey to jump back)", input, -1, highlights, "", false)

		b := make([]byte, 8)
		nRead, err := w.input.Read(b)
		if err != nil {
			return "", err, true
		}
		if nRead == 0 {
			if escapeState != 0 {
				escapeState = 0
				mouseSeq = ""
			}
			continue
		}

		for _, ch := range b[:nRead] {
			changed := false
			if escapeState == 1 {
				if ch == '[' {
					escapeState = 2
					continue
				}
				escapeState = 0
				continue
			}
			if escapeState == 2 {
				if ch == '<' {
					escapeState = 3
					mouseSeq = "<"
					continue
				}
				escapeState = 0
				continue
			}
			if escapeState == 3 {
				mouseSeq += string(ch)
				if ch != 'm' && ch != 'M' {
					continue
				}
				escapeState = 0
				msg, ok := parseMouseSGR(mouseSeq)
				mouseSeq = ""
				if !ok {
					continue
				}
				if w.canJourneyJump() {
					if target, jump := resolveMouseJourneyClick(msg, len(w.steps), w.stepIndex); jump {
						return "", stepJumpRequestedError{step: target}, true
					}
				}
				continue
			}

			switch ch {
			case 3:
				return "", errors.New("cancelled by user"), true
			case 27:
				escapeState = 1
			case 13, 10:
				if strings.TrimSpace(input) == "" {
					w.errorText = ""
					return defaultValue, nil, true
				}
				w.render(title, q, nil, "Type text and press Enter (click Journey to jump back)", input, -1, highlights, "", false)
				w.errorText = ""
				return strings.TrimSpace(input), nil, true
			case 127, 8:
				if len(input) > 0 {
					input = input[:len(input)-1]
					changed = true
				}
			default:
				if ch >= 32 && ch != 127 {
					input += string(ch)
					changed = true
				}
			}
			if changed {
				w.render(title, q, nil, "Type text and press Enter (click Journey to jump back)", input, -1, highlights, "", false)
			}
		}
	}
}

func (w *wizardSession) askYN(title, question string, defaultYes bool, highlights []string) (bool, error) {
	defaultIndex := 1
	if defaultYes {
		defaultIndex = 0
	}
	choice, err := w.askOption(title, question, []string{"Yes", "No"}, defaultIndex, highlights)
	if err != nil {
		return false, err
	}
	return choice == 0, nil
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

	if err := os.MkdirAll(configDir, 0o755); err != nil {
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
	composeYAML := BuildDockerComposeYAML(configDir, a.Timezone, a.GatewayPort, opts.Image)

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
		GatewayPort: strings.TrimSpace(a.GatewayPort),
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

func optionInputHint(lineBuffered bool) string {
	if lineBuffered {
		return "Type up/down or number + Enter to confirm."
	}
	return "Use arrows to choose, Enter to confirm (number shortcuts work)."
}

func applyLineBufferedNavigationInput(raw string, selected int, optionsCount int) (int, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" || optionsCount <= 0 {
		return selected, false
	}

	if strings.EqualFold(raw, "up") {
		if selected > 0 {
			selected--
		}
		return selected, true
	}
	if strings.EqualFold(raw, "down") {
		if selected < optionsCount-1 {
			selected++
		}
		return selected, true
	}

	return applyEmbeddedArrowMoves(raw, selected, optionsCount)
}

func isArrowUpInput(raw string) bool {
	raw = strings.TrimSpace(raw)
	return strings.EqualFold(raw, "up") || isSingleArrowInput(raw, true)
}

func isArrowDownInput(raw string) bool {
	raw = strings.TrimSpace(raw)
	return strings.EqualFold(raw, "down") || isSingleArrowInput(raw, false)
}

func isArrowEscapeLeader(ch byte) bool {
	return ch == '[' || ch == 'O'
}

func isArrowParamChar(ch byte) bool {
	return (ch >= '0' && ch <= '9') || ch == ';'
}

func moveSelection(selected int, optionsCount int, up bool) int {
	if up {
		if selected > 0 {
			return selected - 1
		}
		return selected
	}
	if selected < optionsCount-1 {
		return selected + 1
	}
	return selected
}

func parseAnsiArrowToken(raw string, start int) (next int, up bool, ok bool) {
	if start+2 >= len(raw) || raw[start] != 0x1b || !isArrowEscapeLeader(raw[start+1]) {
		return start, false, false
	}
	if raw[start+1] == 'O' {
		dir := raw[start+2]
		if dir == 'A' || dir == 'B' {
			return start + 3, dir == 'A', true
		}
		return start, false, false
	}
	i := start + 2
	for i < len(raw) && isArrowParamChar(raw[i]) {
		i++
	}
	if i < len(raw) && (raw[i] == 'A' || raw[i] == 'B') {
		return i + 1, raw[i] == 'A', true
	}
	return start, false, false
}

func parseCaretArrowToken(raw string, start int) (next int, up bool, ok bool) {
	if start+2 >= len(raw) || raw[start] != '^' || raw[start+1] != '[' || !isArrowEscapeLeader(raw[start+2]) {
		return start, false, false
	}
	if raw[start+2] == 'O' {
		if start+3 < len(raw) && (raw[start+3] == 'A' || raw[start+3] == 'B') {
			return start + 4, raw[start+3] == 'A', true
		}
		return start, false, false
	}
	i := start + 3
	for i < len(raw) && isArrowParamChar(raw[i]) {
		i++
	}
	if i < len(raw) && (raw[i] == 'A' || raw[i] == 'B') {
		return i + 1, raw[i] == 'A', true
	}
	return start, false, false
}

func isSingleArrowInput(raw string, up bool) bool {
	next, parsedUp, ok := parseAnsiArrowToken(raw, 0)
	if ok && next == len(raw) {
		return parsedUp == up
	}
	next, parsedUp, ok = parseCaretArrowToken(raw, 0)
	return ok && next == len(raw) && parsedUp == up
}

func applyEmbeddedArrowMoves(raw string, selected int, optionsCount int) (int, bool) {
	moved := false
	for i := 0; i < len(raw); {
		if next, up, ok := parseAnsiArrowToken(raw, i); ok {
			selected = moveSelection(selected, optionsCount, up)
			moved = true
			i = next
			continue
		}
		if next, up, ok := parseCaretArrowToken(raw, i); ok {
			selected = moveSelection(selected, optionsCount, up)
			moved = true
			i = next
			continue
		}
		i++
	}
	return selected, moved
}
