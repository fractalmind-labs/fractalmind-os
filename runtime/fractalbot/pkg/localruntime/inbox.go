package localruntime

import (
	"bufio"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// InboxVersion is the on-disk envelope version this package writes.
const InboxVersion = 1

// MaxInboxFileBytes is the largest envelope file a consumer accepts.
const MaxInboxFileBytes = 4 << 20

// Envelope is a delivery's routing context. Field names are part of the inbox
// protocol.
type Envelope struct {
	ID            string       `json:"id"`
	ReceivedAt    string       `json:"received_at"`
	Source        string       `json:"source,omitempty"` // "heartbeat" for schedules
	JobID         string       `json:"job_id,omitempty"`
	RunID         string       `json:"run_id,omitempty"`
	ScheduledAt   string       `json:"scheduled_at,omitempty"`
	ExpiresAt     string       `json:"expires_at,omitempty"`
	CoalesceKey   string       `json:"coalesce_key,omitempty"`
	Channel       string       `json:"channel"`
	ChatID        string       `json:"chat_id,omitempty"`
	ThreadTS      string       `json:"thread_ts,omitempty"`
	UserID        string       `json:"user_id,omitempty"`
	Username      string       `json:"username,omitempty"`
	SelectedAgent string       `json:"selected_agent"`
	Text          string       `json:"text"`
	BodyMode      string       `json:"body_mode,omitempty"`
	BodyFile      string       `json:"body_file,omitempty"`
	Attachments   []Attachment `json:"attachments,omitempty"`
}

// Attachment is a file that came with a message.
type Attachment struct {
	Type     string `json:"type"`
	Filename string `json:"filename"`
	URL      string `json:"url"`
	Channel  string `json:"channel"`
	MimeType string `json:"mimeType,omitempty"`
}

// inboxFile is one envelope file.
type inboxFile struct {
	Version  int      `json:"version"`
	Envelope Envelope `json:"envelope"`
	Prompt   string   `json:"prompt"`
}

// inboxFileName names an envelope file. Requests with a coalesce key share one
// name, so a newer wakeup replaces one still waiting instead of piling up.
func inboxFileName(env Envelope) string {
	if key := strings.TrimSpace(env.CoalesceKey); key != "" {
		digest := sha256.Sum256([]byte(key))
		return fmt.Sprintf("heartbeat-%x.json", digest[:12])
	}
	return fmt.Sprintf("%s-%s.json", time.Now().UTC().Format("20060102T150405.000000000Z"), env.ID)
}

// WriteInbox commits one envelope to an inbox atomically and returns its path.
// The directory and file are owner-only.
func WriteInbox(inbox string, env Envelope, prompt string) (string, error) {
	if strings.TrimSpace(inbox) == "" {
		return "", errors.New("inbox path is required")
	}
	if strings.TrimSpace(prompt) == "" {
		return "", errors.New("prompt is empty")
	}
	if err := os.MkdirAll(inbox, 0o700); err != nil {
		return "", fmt.Errorf("create inbox: %w", err)
	}
	name := inboxFileName(env)
	tmp, err := os.CreateTemp(inbox, "."+name+"-*.tmp")
	if err != nil {
		return "", fmt.Errorf("create inbox temp file: %w", err)
	}
	tmpPath := tmp.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return "", fmt.Errorf("set inbox permissions: %w", err)
	}
	enc := json.NewEncoder(tmp)
	enc.SetIndent("", "  ")
	if err := enc.Encode(inboxFile{Version: InboxVersion, Envelope: env, Prompt: prompt}); err != nil {
		_ = tmp.Close()
		return "", fmt.Errorf("encode envelope: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return "", fmt.Errorf("close envelope: %w", err)
	}
	final := filepath.Join(inbox, name)
	if err := os.Rename(tmpPath, final); err != nil {
		return "", fmt.Errorf("commit envelope: %w", err)
	}
	return final, nil
}

// ReadInboxFile reads one envelope file's prompt. Files without a version are
// version 1.
func ReadInboxFile(path string) (Envelope, string, error) {
	f, err := os.Open(path)
	if err != nil {
		return Envelope{}, "", fmt.Errorf("open envelope: %w", err)
	}
	defer f.Close()
	data, err := io.ReadAll(bufio.NewReader(io.LimitReader(f, MaxInboxFileBytes+1)))
	if err != nil {
		return Envelope{}, "", fmt.Errorf("read envelope: %w", err)
	}
	if len(data) > MaxInboxFileBytes {
		return Envelope{}, "", fmt.Errorf("envelope exceeds %d bytes", MaxInboxFileBytes)
	}
	var file inboxFile
	if err := json.Unmarshal(data, &file); err != nil {
		return Envelope{}, "", fmt.Errorf("decode envelope: %w", err)
	}
	if file.Version > InboxVersion {
		return Envelope{}, "", fmt.Errorf("envelope version %d is newer than %d", file.Version, InboxVersion)
	}
	if strings.TrimSpace(file.Prompt) == "" {
		return Envelope{}, "", errors.New("envelope prompt is empty")
	}
	return file.Envelope, file.Prompt, nil
}

// relayLock records the relay that consumes an inbox: `<inbox>/.relay.lock/
// owner.json`. A lock whose process or socket is gone is stale.
type relayLock struct {
	PID        int    `json:"pid"`
	SocketPath string `json:"socket_path"`
}

func lockDir(inbox string) string { return filepath.Join(inbox, ".relay.lock") }

func readRelayLock(inbox string) (relayLock, error) {
	data, err := os.ReadFile(filepath.Join(lockDir(inbox), "owner.json"))
	if err != nil {
		return relayLock{}, err
	}
	var owner relayLock
	if err := json.Unmarshal(data, &owner); err != nil {
		return relayLock{}, err
	}
	if owner.PID <= 0 || strings.TrimSpace(owner.SocketPath) == "" {
		return relayLock{}, errors.New("invalid relay lock")
	}
	return owner, nil
}

func (owner relayLock) live() bool {
	return processIsAlive(owner.PID) && socketIsLive(owner.SocketPath)
}

// RelayRunning reports whether a live relay consumes an inbox.
func RelayRunning(inbox string) bool {
	if strings.TrimSpace(inbox) == "" {
		return false
	}
	owner, err := readRelayLock(inbox)
	return err == nil && owner.live()
}

// ErrRelayRunning reports that another live relay holds the inbox.
var ErrRelayRunning = errors.New("a relay already consumes this inbox")

// acquireRelayLock takes the inbox for this process, replacing a stale lock.
func acquireRelayLock(inbox, socketPath string) (func(), error) {
	dir := lockDir(inbox)
	for attempt := 0; attempt < 2; attempt++ {
		err := os.Mkdir(dir, 0o700)
		if err == nil {
			data, _ := json.Marshal(relayLock{PID: os.Getpid(), SocketPath: socketPath})
			if err := os.WriteFile(filepath.Join(dir, "owner.json"), data, 0o600); err != nil {
				_ = os.RemoveAll(dir)
				return nil, fmt.Errorf("write relay lock: %w", err)
			}
			return func() {
				if owner, err := readRelayLock(inbox); err == nil && owner.PID == os.Getpid() {
					_ = os.RemoveAll(dir)
				}
			}, nil
		}
		if !errors.Is(err, os.ErrExist) {
			return nil, fmt.Errorf("create relay lock: %w", err)
		}
		if owner, err := readRelayLock(inbox); err == nil && owner.live() {
			return nil, fmt.Errorf("%w (pid %d)", ErrRelayRunning, owner.PID)
		}
		if err := os.RemoveAll(dir); err != nil {
			return nil, fmt.Errorf("remove stale relay lock: %w", err)
		}
	}
	return nil, errors.New("acquire relay lock")
}

func socketIsLive(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	info, err := os.Lstat(path)
	return err == nil && info.Mode()&os.ModeSymlink == 0 && info.Mode()&os.ModeSocket != 0
}
