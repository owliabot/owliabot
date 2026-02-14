package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type DetectedSecretEntry struct {
	Path  string
	Value string
}

type OAuthSessionDetail struct {
	FilePath     string
	ExpiresAt    time.Time
	ExpiresKnown bool
	Email        string
}

type ExistingConfig struct {
	AnthropicAPIKey         string
	AnthropicToken          string
	OpenAIKey               string
	OpenAICompatibleKey     string
	DiscordToken            string
	TelegramToken           string
	GatewayToken            string
	Timezone                string
	AnthropicModel          string
	OpenAIModel             string
	OpenAICodexModel        string
	OpenAICompatibleModel   string
	OpenAICompatibleBaseURL string
	DiscordChannelAllowList []string
	DiscordMemberAllowList  []string
	TelegramAllowList       []string
	WriteToolAllowList      []string
	GatewayPort             string
	HasOAuthAnthropic       bool
	HasOAuthCodex           bool
	DetectedSecrets         []DetectedSecretEntry
	AnthropicOAuth          *OAuthSessionDetail
	OpenAICodexOAuth        *OAuthSessionDetail
	HasMCP                  bool
	MCPPresets              []string
}

type providerEntry struct {
	ID      string
	Model   string
	BaseURL string
}

func (e *ExistingConfig) hasAny() bool {
	if e == nil {
		return false
	}
	return e.AnthropicAPIKey != "" ||
		e.AnthropicToken != "" ||
		e.OpenAIKey != "" ||
		e.OpenAICompatibleKey != "" ||
		e.DiscordToken != "" ||
		e.TelegramToken != "" ||
		e.GatewayToken != "" ||
		e.Timezone != "" ||
		e.AnthropicModel != "" ||
		e.OpenAIModel != "" ||
		e.OpenAICodexModel != "" ||
		e.OpenAICompatibleModel != "" ||
		e.OpenAICompatibleBaseURL != "" ||
		len(e.DiscordChannelAllowList) > 0 ||
		len(e.DiscordMemberAllowList) > 0 ||
		len(e.TelegramAllowList) > 0 ||
		len(e.WriteToolAllowList) > 0 ||
		e.GatewayPort != "" ||
		e.HasOAuthAnthropic ||
		e.HasOAuthCodex ||
		e.HasMCP ||
		len(e.DetectedSecrets) > 0 ||
		e.AnthropicOAuth != nil ||
		e.OpenAICodexOAuth != nil
}

func DetectExistingConfig(configDir string) (*ExistingConfig, error) {
	cfg := &ExistingConfig{}
	secretsPath := filepath.Join(configDir, "secrets.yaml")
	raw, err := os.ReadFile(secretsPath)
	if err == nil {
		parseSecretsYAML(string(raw), cfg)
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	appPath := filepath.Join(configDir, "app.yaml")
	appRaw, err := os.ReadFile(appPath)
	if err == nil {
		parseAppYAML(string(appRaw), cfg)
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}

	cfg.AnthropicOAuth = detectOAuthSessionDetail(
		filepath.Join(configDir, "auth", "auth-anthropic.json"),
		filepath.Join(configDir, "auth", "anthropic.json"),
	)
	cfg.OpenAICodexOAuth = detectOAuthSessionDetail(
		filepath.Join(configDir, "auth", "auth-openai-codex.json"),
		filepath.Join(configDir, "auth", "openai-codex.json"),
	)
	cfg.HasOAuthAnthropic = cfg.AnthropicOAuth != nil
	cfg.HasOAuthCodex = cfg.OpenAICodexOAuth != nil

	if !cfg.hasAny() {
		return nil, nil
	}
	return cfg, nil
}

func parseSecretsYAML(raw string, out *ExistingConfig) {
	section := ""
	for _, line := range strings.Split(raw, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		if !strings.HasPrefix(line, " ") && strings.HasSuffix(trimmed, ":") {
			section = strings.TrimSuffix(trimmed, ":")
			continue
		}

		if section == "" {
			continue
		}
		parts := strings.SplitN(trimmed, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		value := strings.Trim(strings.TrimSpace(parts[1]), `"'`)
		if value == "" {
			continue
		}

		switch section {
		case "anthropic":
			if key == "apiKey" {
				out.AnthropicAPIKey = value
				out.DetectedSecrets = append(out.DetectedSecrets, DetectedSecretEntry{Path: "anthropic.apiKey", Value: value})
			}
			if key == "token" {
				out.AnthropicToken = value
				out.DetectedSecrets = append(out.DetectedSecrets, DetectedSecretEntry{Path: "anthropic.token", Value: value})
			}
		case "openai":
			if key == "apiKey" {
				out.OpenAIKey = value
				out.DetectedSecrets = append(out.DetectedSecrets, DetectedSecretEntry{Path: "openai.apiKey", Value: value})
			}
		case "openai-compatible":
			if key == "apiKey" {
				out.OpenAICompatibleKey = value
				out.DetectedSecrets = append(out.DetectedSecrets, DetectedSecretEntry{Path: "openai-compatible.apiKey", Value: value})
			}
		case "discord":
			if key == "token" {
				out.DiscordToken = value
				out.DetectedSecrets = append(out.DetectedSecrets, DetectedSecretEntry{Path: "discord.token", Value: value})
			}
		case "telegram":
			if key == "token" {
				out.TelegramToken = value
				out.DetectedSecrets = append(out.DetectedSecrets, DetectedSecretEntry{Path: "telegram.token", Value: value})
			}
		case "gateway":
			if key == "token" {
				out.GatewayToken = value
				out.DetectedSecrets = append(out.DetectedSecrets, DetectedSecretEntry{Path: "gateway.token", Value: value})
			}
		}
	}
}

func parseAppYAML(raw string, out *ExistingConfig) {
	section := ""
	subsection := ""
	listKey := ""
	var currentProvider *providerEntry
	providers := map[string]*providerEntry{}

	for _, line := range strings.Split(raw, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		indent := len(line) - len(strings.TrimLeft(line, " "))

		if indent == 0 {
			subsection = ""
			listKey = ""
			if strings.HasSuffix(trimmed, ":") {
				section = strings.TrimSuffix(trimmed, ":")
				if section != "providers" {
					currentProvider = nil
				}
				continue
			}
			if key, value, ok := splitKeyValue(trimmed); ok && key == "timezone" {
				out.Timezone = value
			}
			continue
		}

		switch section {
		case "providers":
			if strings.HasPrefix(trimmed, "-") {
				item := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
				currentProvider = &providerEntry{}
				if key, value, ok := splitKeyValue(item); ok {
					applyProviderField(currentProvider, key, value)
				}
				if currentProvider.ID != "" {
					providers[strings.ToLower(currentProvider.ID)] = currentProvider
				}
				continue
			}
			if currentProvider == nil {
				continue
			}
			if key, value, ok := splitKeyValue(trimmed); ok {
				applyProviderField(currentProvider, key, value)
			}
			if currentProvider.ID != "" {
				providers[strings.ToLower(currentProvider.ID)] = currentProvider
			}
		case "discord":
			if indent == 2 && strings.HasSuffix(trimmed, ":") {
				listKey = strings.TrimSuffix(trimmed, ":")
				continue
			}
			if indent >= 4 && strings.HasPrefix(trimmed, "-") {
				value := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
				value = strings.Trim(value, `"'`)
				if value == "" {
					continue
				}
				switch listKey {
				case "channelAllowList":
					out.DiscordChannelAllowList = append(out.DiscordChannelAllowList, value)
				case "memberAllowList":
					out.DiscordMemberAllowList = append(out.DiscordMemberAllowList, value)
				}
			}
		case "telegram":
			if indent == 2 && strings.HasSuffix(trimmed, ":") {
				listKey = strings.TrimSuffix(trimmed, ":")
				continue
			}
			if indent >= 4 && strings.HasPrefix(trimmed, "-") {
				value := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
				value = strings.Trim(value, `"'`)
				if value == "" {
					continue
				}
				if listKey == "allowList" {
					out.TelegramAllowList = append(out.TelegramAllowList, value)
				}
			}
		case "gateway":
			if indent == 2 && strings.HasSuffix(trimmed, ":") {
				subsection = strings.TrimSuffix(trimmed, ":")
				continue
			}
			if subsection == "http" && indent >= 4 {
				if key, value, ok := splitKeyValue(trimmed); ok {
					if key == "port" {
						if _, err := strconv.Atoi(value); err == nil {
							out.GatewayPort = value
						}
					}
				}
			}
		case "security":
			if indent == 2 && strings.HasSuffix(trimmed, ":") {
				listKey = strings.TrimSuffix(trimmed, ":")
				continue
			}
			if indent >= 4 && strings.HasPrefix(trimmed, "-") {
				value := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
				value = strings.Trim(value, `"'`)
				if value == "" {
					continue
				}
				if listKey == "writeToolAllowList" {
					out.WriteToolAllowList = append(out.WriteToolAllowList, value)
				}
			}
		case "mcp":
			if indent == 2 && strings.HasSuffix(trimmed, ":") {
				subsection = strings.TrimSuffix(trimmed, ":")
				continue
			}
			if indent == 2 {
				if key, value, ok := splitKeyValue(trimmed); ok && key == "autoStart" {
					out.HasMCP = strings.EqualFold(value, "true")
				}
				continue
			}
			if indent >= 4 && subsection == "presets" && strings.HasPrefix(trimmed, "-") {
				preset := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
				preset = strings.Trim(preset, `"'`)
				if preset != "" {
					out.MCPPresets = append(out.MCPPresets, preset)
					out.HasMCP = true
				}
			}
		}
	}

	if provider := providers["anthropic"]; provider != nil {
		out.AnthropicModel = provider.Model
	}
	if provider := providers["openai"]; provider != nil {
		out.OpenAIModel = provider.Model
	}
	if provider := providers["openai-codex"]; provider != nil {
		out.OpenAICodexModel = provider.Model
	}
	if provider := providers["openai-compatible"]; provider != nil {
		out.OpenAICompatibleModel = provider.Model
		out.OpenAICompatibleBaseURL = provider.BaseURL
	}
}

func splitKeyValue(raw string) (string, string, bool) {
	parts := strings.SplitN(raw, ":", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	key := strings.TrimSpace(parts[0])
	if key == "" {
		return "", "", false
	}
	value := strings.Trim(strings.TrimSpace(parts[1]), `"'`)
	return key, value, true
}

func applyProviderField(provider *providerEntry, key, value string) {
	if provider == nil {
		return
	}
	switch key {
	case "id":
		provider.ID = value
	case "model":
		provider.Model = value
	case "baseUrl":
		provider.BaseURL = value
	}
}

func detectOAuthSessionDetail(candidates ...string) *OAuthSessionDetail {
	for _, path := range candidates {
		if !fileExists(path) {
			continue
		}
		detail := &OAuthSessionDetail{FilePath: path}
		raw, err := os.ReadFile(path)
		if err != nil {
			return detail
		}
		var payload map[string]any
		if err := json.Unmarshal(raw, &payload); err != nil {
			return detail
		}
		if email, ok := payload["email"].(string); ok {
			detail.Email = strings.TrimSpace(email)
		}
		if expiresAt, ok := parseOAuthExpiry(payload["expires"]); ok {
			detail.ExpiresKnown = true
			detail.ExpiresAt = expiresAt
		}
		return detail
	}
	return nil
}

func parseOAuthExpiry(raw any) (time.Time, bool) {
	switch value := raw.(type) {
	case float64:
		return epochToTime(int64(value))
	case int64:
		return epochToTime(value)
	case int:
		return epochToTime(int64(value))
	case string:
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return time.Time{}, false
		}
		if unixMs, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
			return epochToTime(unixMs)
		}
		parsed, err := time.Parse(time.RFC3339, trimmed)
		if err != nil {
			return time.Time{}, false
		}
		return parsed, true
	default:
		return time.Time{}, false
	}
}

func epochToTime(value int64) (time.Time, bool) {
	if value <= 0 {
		return time.Time{}, false
	}
	// OAuth libraries usually store milliseconds since epoch.
	if value > 9_999_999_999 {
		return time.UnixMilli(value).UTC(), true
	}
	return time.Unix(value, 0).UTC(), true
}

func fileExists(path string) bool {
	st, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !st.IsDir()
}
