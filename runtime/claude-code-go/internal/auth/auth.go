package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/fractalmind-ai/claude-code-go/internal/client"
	"github.com/fractalmind-ai/claude-code-go/internal/config"
)

type StoredAuth struct {
	AccessToken string `json:"access_token"`
}

type StatusResult struct {
	LoggedIn     bool
	AuthFile     string
	APIBase      string
	Transport    string
	APIKeySource string
}

func Status(cfg config.Config, provider client.Provider) StatusResult {
	return StatusResult{
		LoggedIn:     cfg.APIKey != "",
		AuthFile:     cfg.AuthFile,
		APIBase:      provider.APIBase(),
		Transport:    provider.Name(),
		APIKeySource: cfg.APIKeySource,
	}
}

func (s StatusResult) String() string {
	state := "logged_out"
	if s.LoggedIn {
		state = "logged_in"
	}
	return fmt.Sprintf("status=%s\nauth_file=%s\napi_base=%s\ntransport=%s\napi_key_source=%s", state, s.AuthFile, s.APIBase, s.Transport, valueOrNone(s.APIKeySource))
}

func Login(_ context.Context, cfg config.Config, apiKey string) error {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return fmt.Errorf("api key is required")
	}
	if err := os.MkdirAll(filepath.Dir(cfg.AuthFile), 0o755); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(StoredAuth{AccessToken: apiKey}, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	return os.WriteFile(cfg.AuthFile, payload, 0o600)
}

func Logout(_ context.Context, cfg config.Config) error {
	if err := os.MkdirAll(filepath.Dir(cfg.AuthFile), 0o755); err != nil {
		return err
	}
	if _, err := os.Stat(cfg.AuthFile); err == nil {
		return os.Remove(cfg.AuthFile)
	}
	return nil
}

func valueOrNone(v string) string {
	if v == "" {
		return "none"
	}
	return v
}
