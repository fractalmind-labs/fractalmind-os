package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Dir          string
	AuthFile     string
	APIBase      string
	APIKey       string
	APIKeySource string
	Model        string
	MaxTokens    int
}

type storedAuth struct {
	AccessToken string `json:"access_token"`
}

func Load() (Config, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return Config{}, err
	}
	base := firstNonEmpty(
		os.Getenv("CLAUDE_CODE_API_BASE"),
		os.Getenv("ANTHROPIC_BASE_URL"),
		"https://api.anthropic.com",
	)
	model := firstNonEmpty(os.Getenv("CLAUDE_CODE_MODEL"), "claude-sonnet-4-5")
	maxTokens, err := parsePositiveInt(firstNonEmpty(os.Getenv("CLAUDE_CODE_MAX_TOKENS"), "32"), "CLAUDE_CODE_MAX_TOKENS")
	if err != nil {
		return Config{}, err
	}
	cfgDir := filepath.Join(dir, "claude-code-go")
	authFile := filepath.Join(cfgDir, "auth.json")
	apiKey, source, err := resolveAPIKey(authFile)
	if err != nil {
		return Config{}, err
	}
	return Config{
		Dir:          cfgDir,
		AuthFile:     authFile,
		APIBase:      base,
		APIKey:       apiKey,
		APIKeySource: source,
		Model:        model,
		MaxTokens:    maxTokens,
	}, nil
}

func resolveAPIKey(authFile string) (string, string, error) {
	if key := strings.TrimSpace(os.Getenv("CLAUDE_CODE_API_KEY")); key != "" {
		return key, "api_key_env", nil
	}
	if key := strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY")); key != "" {
		return key, "api_key_env", nil
	}
	if key := strings.TrimSpace(os.Getenv("ANTHROPIC_AUTH_TOKEN")); key != "" {
		return key, "anthropic_auth_env", nil
	}
	if key := strings.TrimSpace(os.Getenv("CLAUDE_CODE_OAUTH_TOKEN")); key != "" {
		return key, "oauth_env", nil
	}
	key, err := loadAPIKeyFromAuthFile(authFile)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", "", nil
		}
		return "", "", err
	}
	if key == "" {
		return "", "", nil
	}
	return key, "auth_file", nil
}

func loadAPIKeyFromAuthFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var stored storedAuth
	if err := json.Unmarshal(data, &stored); err != nil {
		return "", err
	}
	return stored.AccessToken, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func parsePositiveInt(raw string, field string) (int, error) {
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", field, err)
	}
	if value <= 0 {
		return 0, fmt.Errorf("invalid %s: must be > 0", field)
	}
	return value, nil
}

func ParsePositiveIntForCLI(raw string, field string) (int, error) {
	return parsePositiveInt(raw, field)
}
