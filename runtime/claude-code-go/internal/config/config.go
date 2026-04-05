package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

type Config struct {
	Dir          string
	AuthFile     string
	APIBase      string
	APIKey       string
	APIKeySource string
}

type storedAuth struct {
	AccessToken string `json:"access_token"`
}

func Load() (Config, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return Config{}, err
	}
	base := os.Getenv("CLAUDE_CODE_API_BASE")
	if base == "" {
		base = "https://api.anthropic.com"
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
	}, nil
}

func resolveAPIKey(authFile string) (string, string, error) {
	if key := firstNonEmpty(os.Getenv("CLAUDE_CODE_API_KEY"), os.Getenv("ANTHROPIC_API_KEY")); key != "" {
		return key, "env", nil
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
