package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

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

func Logout(_ context.Context, cfg config.Config) error {
	if err := os.MkdirAll(filepath.Dir(cfg.AuthFile), 0o755); err != nil {
		return err
	}
	if _, err := os.Stat(cfg.AuthFile); err == nil {
		return os.Remove(cfg.AuthFile)
	}
	return nil
}

func readToken(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var stored StoredAuth
	if err := json.Unmarshal(data, &stored); err != nil {
		return "", err
	}
	return stored.AccessToken, nil
}

func valueOrNone(v string) string {
	if v == "" {
		return "none"
	}
	return v
}
