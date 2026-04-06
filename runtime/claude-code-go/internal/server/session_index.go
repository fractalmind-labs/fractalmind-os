package server

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type sessionIndexEntry struct {
	SessionID           string `json:"sessionId"`
	TranscriptSessionID string `json:"transcriptSessionId"`
	CWD                 string `json:"cwd"`
	Status              string `json:"status"`
	BackendStatus       string `json:"backendStatus,omitempty"`
	BackendPID          int    `json:"backendPid,omitempty"`
	BackendStartedAt    int64  `json:"backendStartedAt,omitempty"`
	BackendStoppedAt    int64  `json:"backendStoppedAt,omitempty"`
	BackendExitCode     int    `json:"backendExitCode,omitempty"`
	PermissionMode      string `json:"permissionMode,omitempty"`
	CreatedAt           int64  `json:"createdAt"`
	LastActiveAt        int64  `json:"lastActiveAt"`
}

type sessionIndexStore struct {
	path string
	mu   sync.Mutex
}

func defaultSessionIndexPath() (string, error) {
	if override := strings.TrimSpace(os.Getenv("CLAUDE_CODE_GO_SERVER_SESSION_INDEX")); override != "" {
		return override, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home dir: %w", err)
	}
	return filepath.Join(home, ".claude", "claude-code-go-server-sessions.json"), nil
}

func newSessionIndexStore(path string) *sessionIndexStore {
	return &sessionIndexStore{path: path}
}

func (s *sessionIndexStore) upsert(sessionKey string, entry sessionIndexEntry) error {
	if s == nil || strings.TrimSpace(s.path) == "" || strings.TrimSpace(sessionKey) == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	index, err := s.readLocked()
	if err != nil {
		return err
	}
	index[sessionKey] = entry
	return s.writeLocked(index)
}

func (s *sessionIndexStore) touch(sessionKey, cwd string) error {
	if s == nil || strings.TrimSpace(s.path) == "" || strings.TrimSpace(sessionKey) == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	index, err := s.readLocked()
	if err != nil {
		return err
	}
	entry, ok := index[sessionKey]
	if !ok {
		entry = newSessionIndexEntry(sessionKey, cwd)
	} else {
		entry.CWD = cwd
		entry.Status = "running"
		entry.LastActiveAt = time.Now().UnixMilli()
	}
	index[sessionKey] = entry
	return s.writeLocked(index)
}

func (s *sessionIndexStore) setStatus(sessionKey, cwd, status string) error {
	if s == nil || strings.TrimSpace(s.path) == "" || strings.TrimSpace(sessionKey) == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	index, err := s.readLocked()
	if err != nil {
		return err
	}
	entry, ok := index[sessionKey]
	if !ok {
		entry = newSessionIndexEntry(sessionKey, cwd)
	}
	if strings.TrimSpace(cwd) != "" {
		entry.CWD = cwd
	}
	if strings.TrimSpace(status) != "" {
		entry.Status = status
	}
	entry.LastActiveAt = time.Now().UnixMilli()
	index[sessionKey] = entry
	return s.writeLocked(index)
}

func (s *sessionIndexStore) setBackendSnapshot(sessionKey, cwd string, snap backendSnapshot) error {
	if s == nil || strings.TrimSpace(s.path) == "" || strings.TrimSpace(sessionKey) == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	index, err := s.readLocked()
	if err != nil {
		return err
	}
	entry, ok := index[sessionKey]
	if !ok {
		entry = newSessionIndexEntry(sessionKey, cwd)
	}
	if strings.TrimSpace(cwd) != "" {
		entry.CWD = cwd
	}
	entry.BackendStatus = snap.Status
	entry.BackendPID = snap.PID
	entry.BackendStartedAt = snap.StartedAt
	entry.BackendStoppedAt = snap.StoppedAt
	entry.BackendExitCode = snap.ExitCode
	entry.LastActiveAt = time.Now().UnixMilli()
	index[sessionKey] = entry
	return s.writeLocked(index)
}

func (s *sessionIndexStore) get(sessionKey string) (sessionIndexEntry, bool, error) {
	if s == nil || strings.TrimSpace(s.path) == "" || strings.TrimSpace(sessionKey) == "" {
		return sessionIndexEntry{}, false, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	index, err := s.readLocked()
	if err != nil {
		return sessionIndexEntry{}, false, err
	}
	entry, ok := index[sessionKey]
	return entry, ok, nil
}

func (s *sessionIndexStore) setAllStatuses(status string) error {
	if s == nil || strings.TrimSpace(s.path) == "" || strings.TrimSpace(status) == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	index, err := s.readLocked()
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	for sessionKey, entry := range index {
		entry.Status = status
		entry.LastActiveAt = now
		index[sessionKey] = entry
	}
	return s.writeLocked(index)
}

func (s *sessionIndexStore) readLocked() (map[string]sessionIndexEntry, error) {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return nil, fmt.Errorf("create session index dir: %w", err)
	}
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]sessionIndexEntry{}, nil
		}
		return nil, fmt.Errorf("read session index: %w", err)
	}
	var parsed map[string]sessionIndexEntry
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, fmt.Errorf("decode session index: %w", err)
	}
	if parsed == nil {
		parsed = map[string]sessionIndexEntry{}
	}
	return parsed, nil
}

func (s *sessionIndexStore) writeLocked(index map[string]sessionIndexEntry) error {
	payload, err := json.MarshalIndent(index, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal session index: %w", err)
	}
	return os.WriteFile(s.path, append(payload, '\n'), 0o600)
}

func newSessionIndexEntry(sessionID, cwd string) sessionIndexEntry {
	now := time.Now().UnixMilli()
	return sessionIndexEntry{
		SessionID:           sessionID,
		TranscriptSessionID: sessionID,
		CWD:                 cwd,
		Status:              "starting",
		CreatedAt:           now,
		LastActiveAt:        now,
	}
}
