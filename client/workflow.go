package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

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
