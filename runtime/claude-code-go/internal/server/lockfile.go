package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type lockInfo struct {
	PID       int    `json:"pid"`
	Host      string `json:"host,omitempty"`
	Port      int    `json:"port,omitempty"`
	Unix      string `json:"unix,omitempty"`
	HTTPURL   string `json:"http_url,omitempty"`
	StartedAt string `json:"started_at,omitempty"`
}

func defaultLockfilePath() (string, error) {
	if override := strings.TrimSpace(os.Getenv("CLAUDE_CODE_GO_SERVER_LOCKFILE")); override != "" {
		return override, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home dir: %w", err)
	}
	return filepath.Join(home, ".claude", "claude-code-go-server.lock.json"), nil
}

func probeRunningServer(lockfilePath string) (*lockInfo, error) {
	data, err := os.ReadFile(lockfilePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("read server lockfile: %w", err)
	}
	var info lockInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return nil, fmt.Errorf("decode server lockfile: %w", err)
	}
	if info.PID <= 0 {
		return nil, nil
	}
	if processAlive(info.PID) {
		return &info, nil
	}
	return nil, nil
}

func writeServerLock(lockfilePath string, info lockInfo) error {
	if err := os.MkdirAll(filepath.Dir(lockfilePath), 0o755); err != nil {
		return fmt.Errorf("create lockfile dir: %w", err)
	}
	payload, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal server lockfile: %w", err)
	}
	return os.WriteFile(lockfilePath, append(payload, '\n'), 0o600)
}

func removeServerLock(lockfilePath string) error {
	if strings.TrimSpace(lockfilePath) == "" {
		return nil
	}
	if err := os.Remove(lockfilePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove server lockfile: %w", err)
	}
	return nil
}

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func currentProcessID() int {
	if raw := strings.TrimSpace(os.Getenv("CLAUDE_CODE_GO_SERVER_PID_OVERRIDE")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			return parsed
		}
	}
	return os.Getpid()
}

func nowUTC() string {
	if raw := strings.TrimSpace(os.Getenv("CLAUDE_CODE_GO_SERVER_STARTED_AT")); raw != "" {
		return raw
	}
	return time.Now().UTC().Format(time.RFC3339)
}
