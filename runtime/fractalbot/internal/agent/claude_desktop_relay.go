package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultClaudeDesktopRelayPollInterval = 500 * time.Millisecond
	defaultClaudeDesktopRelayWriteTimeout = 2 * time.Second
	maxClaudeDesktopInboxEnvelopeBytes    = 4 << 20
)

var ErrClaudeDesktopRelayAlreadyRunning = errors.New("Claude Desktop relay already running")

type ClaudeDesktopRelayOptions struct {
	InboxPath    string
	SocketPath   string
	Token        string
	PollInterval time.Duration
	Once         bool
	Logf         func(string, ...interface{})
}

type claudeDesktopRelayLock struct {
	PID        int    `json:"pid"`
	SocketPath string `json:"socket_path"`
}

type claudeDesktopRelayAuthFrame struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

type claudeDesktopRelayUserFrame struct {
	Type    string                           `json:"type"`
	Message claudeDesktopRelayMessagePayload `json:"message"`
}

type claudeDesktopRelayMessagePayload struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func RunClaudeDesktopRelay(ctx context.Context, opts ClaudeDesktopRelayOptions) error {
	inboxPath := strings.TrimSpace(opts.InboxPath)
	if inboxPath == "" {
		return errors.New("Claude Desktop relay inbox path is required")
	}
	socketPath := strings.TrimSpace(opts.SocketPath)
	if socketPath == "" {
		return errors.New("CLAUDE_CODE_MESSAGING_SOCKET is required")
	}
	if strings.TrimSpace(opts.Token) == "" {
		return errors.New("CLAUDE_CODE_MESSAGING_TOKEN is required")
	}
	if err := validateClaudeDesktopMessagingSocket(socketPath); err != nil {
		return err
	}
	if err := os.MkdirAll(inboxPath, 0700); err != nil {
		return fmt.Errorf("create Claude Desktop inbox: %w", err)
	}
	if err := os.Chmod(inboxPath, 0700); err != nil {
		return fmt.Errorf("secure Claude Desktop inbox: %w", err)
	}
	donePath := filepath.Join(inboxPath, "done")
	failedPath := filepath.Join(inboxPath, "failed")
	for _, path := range []string{donePath, failedPath} {
		if err := os.MkdirAll(path, 0700); err != nil {
			return fmt.Errorf("create Claude Desktop relay directory: %w", err)
		}
		if err := os.Chmod(path, 0700); err != nil {
			return fmt.Errorf("secure Claude Desktop relay directory: %w", err)
		}
	}

	release, err := acquireClaudeDesktopRelayLock(inboxPath, socketPath)
	if err != nil {
		return err
	}
	defer release()

	pollInterval := opts.PollInterval
	if pollInterval <= 0 {
		pollInterval = defaultClaudeDesktopRelayPollInterval
	}
	logf := opts.Logf
	if logf == nil {
		logf = func(string, ...interface{}) {}
	}

	for {
		processed, err := relayClaudeDesktopInbox(inboxPath, donePath, failedPath, socketPath, opts.Token, logf)
		if err != nil {
			if opts.Once {
				return err
			}
			logf("Claude Desktop relay delivery failed: %v", err)
		}
		if opts.Once {
			logf("Claude Desktop relay processed %d envelope(s)", processed)
			return nil
		}

		select {
		case <-ctx.Done():
			return nil
		case <-time.After(pollInterval):
		}
		if err := validateClaudeDesktopMessagingSocket(socketPath); err != nil {
			logf("Claude Desktop messaging socket closed; relay exiting")
			return nil
		}
	}
}

func relayClaudeDesktopInbox(inboxPath, donePath, failedPath, socketPath, token string, logf func(string, ...interface{})) (int, error) {
	entries, err := os.ReadDir(inboxPath)
	if err != nil {
		return 0, fmt.Errorf("read Claude Desktop inbox: %w", err)
	}
	processed := 0
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		path := filepath.Join(inboxPath, entry.Name())
		info, err := os.Lstat(path)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return processed, fmt.Errorf("inspect Claude Desktop inbox envelope: %w", err)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			logf("Claude Desktop relay ignored non-regular inbox entry %s", entry.Name())
			continue
		}

		prompt, err := readClaudeDesktopInboxPrompt(path)
		if err != nil {
			failedFile := filepath.Join(failedPath, entry.Name())
			if moveErr := os.Rename(path, failedFile); moveErr != nil && !errors.Is(moveErr, os.ErrNotExist) {
				return processed, fmt.Errorf("quarantine invalid Claude Desktop inbox envelope: %w", moveErr)
			}
			logf("Claude Desktop relay quarantined invalid envelope %s: %v", entry.Name(), err)
			continue
		}
		if err := sendClaudeDesktopRelayPrompt(socketPath, token, prompt); err != nil {
			return processed, err
		}
		if err := os.Rename(path, filepath.Join(donePath, entry.Name())); err != nil {
			return processed, fmt.Errorf("archive delivered Claude Desktop inbox envelope: %w", err)
		}
		processed++
		logf("Claude Desktop relay delivered %s", entry.Name())
	}
	return processed, nil
}

func readClaudeDesktopInboxPrompt(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open envelope: %w", err)
	}
	defer file.Close()

	reader := bufio.NewReader(io.LimitReader(file, maxClaudeDesktopInboxEnvelopeBytes+1))
	data, err := io.ReadAll(reader)
	if err != nil {
		return "", fmt.Errorf("read envelope: %w", err)
	}
	if len(data) > maxClaudeDesktopInboxEnvelopeBytes {
		return "", fmt.Errorf("envelope exceeds %d bytes", maxClaudeDesktopInboxEnvelopeBytes)
	}
	var envelope claudeDesktopInboxEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return "", fmt.Errorf("decode envelope: %w", err)
	}
	if strings.TrimSpace(envelope.Prompt) == "" {
		return "", errors.New("envelope prompt is empty")
	}
	return envelope.Prompt, nil
}

func sendClaudeDesktopRelayPrompt(socketPath, token, prompt string) error {
	conn, err := net.DialTimeout("unix", socketPath, defaultClaudeDesktopRelayWriteTimeout)
	if err != nil {
		return fmt.Errorf("connect to Claude Desktop messaging socket: %w", err)
	}
	defer conn.Close()
	if err := conn.SetWriteDeadline(time.Now().Add(defaultClaudeDesktopRelayWriteTimeout)); err != nil {
		return fmt.Errorf("set Claude Desktop messaging socket deadline: %w", err)
	}
	encoder := json.NewEncoder(conn)
	if err := encoder.Encode(claudeDesktopRelayAuthFrame{Type: "auth", Token: token}); err != nil {
		return fmt.Errorf("authenticate Claude Desktop messaging socket: %w", err)
	}
	frame := claudeDesktopRelayUserFrame{
		Type: "user",
		Message: claudeDesktopRelayMessagePayload{
			Role:    "user",
			Content: prompt,
		},
	}
	if err := encoder.Encode(frame); err != nil {
		return fmt.Errorf("write Claude Desktop relay prompt: %w", err)
	}
	return nil
}

func validateClaudeDesktopMessagingSocket(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect Claude Desktop messaging socket: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || info.Mode()&os.ModeSocket == 0 {
		return errors.New("CLAUDE_CODE_MESSAGING_SOCKET must be a Unix socket, not a symlink")
	}
	if info.Mode().Perm()&0077 != 0 {
		return fmt.Errorf("Claude Desktop messaging socket permissions %04o are too broad", info.Mode().Perm())
	}
	return validateClaudeDesktopMessagingSocketPlatform(info)
}

func acquireClaudeDesktopRelayLock(inboxPath, socketPath string) (func(), error) {
	lockPath := filepath.Join(inboxPath, ".relay.lock")
	for attempt := 0; attempt < 2; attempt++ {
		if err := os.Mkdir(lockPath, 0700); err == nil {
			owner := claudeDesktopRelayLock{PID: os.Getpid(), SocketPath: socketPath}
			data, marshalErr := json.Marshal(owner)
			if marshalErr != nil {
				_ = os.Remove(lockPath)
				return nil, marshalErr
			}
			if writeErr := os.WriteFile(filepath.Join(lockPath, "owner.json"), data, 0600); writeErr != nil {
				_ = os.RemoveAll(lockPath)
				return nil, fmt.Errorf("write Claude Desktop relay lock: %w", writeErr)
			}
			return func() {
				var current claudeDesktopRelayLock
				data, err := os.ReadFile(filepath.Join(lockPath, "owner.json"))
				if err == nil && json.Unmarshal(data, &current) == nil && current.PID == os.Getpid() {
					_ = os.RemoveAll(lockPath)
				}
			}, nil
		} else if !errors.Is(err, os.ErrExist) {
			return nil, fmt.Errorf("create Claude Desktop relay lock: %w", err)
		}

		owner, err := readClaudeDesktopRelayLock(lockPath)
		if err == nil && processIsAlive(owner.PID) && socketIsLive(owner.SocketPath) {
			return nil, fmt.Errorf("%w (pid %d)", ErrClaudeDesktopRelayAlreadyRunning, owner.PID)
		}
		if err := os.RemoveAll(lockPath); err != nil {
			return nil, fmt.Errorf("remove stale Claude Desktop relay lock: %w", err)
		}
	}
	return nil, errors.New("acquire Claude Desktop relay lock")
}

func readClaudeDesktopRelayLock(lockPath string) (claudeDesktopRelayLock, error) {
	data, err := os.ReadFile(filepath.Join(lockPath, "owner.json"))
	if err != nil {
		return claudeDesktopRelayLock{}, err
	}
	var owner claudeDesktopRelayLock
	if err := json.Unmarshal(data, &owner); err != nil {
		return claudeDesktopRelayLock{}, err
	}
	if owner.PID <= 0 || strings.TrimSpace(owner.SocketPath) == "" {
		return claudeDesktopRelayLock{}, errors.New("invalid Claude Desktop relay lock")
	}
	return owner, nil
}

func socketIsLive(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	info, err := os.Lstat(path)
	return err == nil && info.Mode()&os.ModeSymlink == 0 && info.Mode()&os.ModeSocket != 0
}
