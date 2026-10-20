package router

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// selectionStore keeps each conversation's /use choice on shared channels,
// keyed by channel instance and chat, so it survives restarts.
type selectionStore struct {
	path string
	mu   sync.Mutex
	data map[string]string
	read bool
}

func newSelectionStore(path string) *selectionStore { return &selectionStore{path: path} }

func selectionKey(ref, chat string) string { return ref + "|" + chat }

func (s *selectionStore) load() {
	if s.read {
		return
	}
	s.read = true
	s.data = map[string]string{}
	if raw, err := os.ReadFile(s.path); err == nil {
		_ = json.Unmarshal(raw, &s.data)
	}
}

func (s *selectionStore) get(ref, chat string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	return s.data[selectionKey(ref, chat)]
}

// set records a choice; an empty agent returns the conversation to the
// channel's default.
func (s *selectionStore) set(ref, chat, agent string) error {
	if chat == "" {
		return errors.New("this message has no conversation to remember a choice for")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	if agent == "" {
		delete(s.data, selectionKey(ref, chat))
	} else {
		s.data[selectionKey(ref, chat)] = agent
	}
	raw, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
