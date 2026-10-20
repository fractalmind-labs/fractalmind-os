package localruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ClaudeDesktop delivers through the agent's inbox. A relay started inside the
// agent's Claude Desktop session (RunRelay) moves each envelope into that
// session over its messaging socket, so delivery waits durably while the
// session is closed and starts work as soon as it is open.
type ClaudeDesktop struct{}

func (ClaudeDesktop) Name() string { return "claudeDesktop" }

func (ClaudeDesktop) Capabilities() Capabilities {
	return Capabilities{DurableQueue: true, WakesIdle: true, PresenceKnown: true}
}

func (ClaudeDesktop) Deliver(_ context.Context, target Target, req Request) Result {
	if req.Mode != Assign {
		return failed(req, errors.New("claudeDesktop supports assign only"))
	}
	path, err := WriteInbox(target.Inbox, req.Envelope, req.Prompt)
	if err != nil {
		return failed(req, err)
	}
	return Result{Status: Queued, EnvelopeID: req.Envelope.ID, Location: path}
}

// Presence is Online while a live relay consumes the agent's inbox.
func (ClaudeDesktop) Presence(_ context.Context, target Target) Presence {
	if RelayRunning(target.Inbox) {
		return Online
	}
	return Offline
}

// RelayOptions configure one relay.
type RelayOptions struct {
	Inbox string
	// SocketPath and Token are the session's CLAUDE_CODE_MESSAGING_SOCKET and
	// CLAUDE_CODE_MESSAGING_TOKEN.
	SocketPath   string
	Token        string
	PollInterval time.Duration
	// Once processes what is queued and returns.
	Once bool
	Logf func(string, ...any)
}

const (
	defaultRelayPoll         = 500 * time.Millisecond
	relayWriteTimeout        = 2 * time.Second
	relayDoneDir             = "done"
	relayFailedDir           = "failed"
	messagingSocketPermsMask = 0o077
)

// RunRelay moves envelopes from an inbox into a Claude Desktop session until
// the context ends or the session's socket disappears. One relay holds an
// inbox at a time; a second returns ErrRelayRunning.
func RunRelay(ctx context.Context, opts RelayOptions) error {
	inbox := strings.TrimSpace(opts.Inbox)
	switch {
	case inbox == "":
		return errors.New("relay inbox is required")
	case strings.TrimSpace(opts.SocketPath) == "":
		return errors.New("CLAUDE_CODE_MESSAGING_SOCKET is required")
	case strings.TrimSpace(opts.Token) == "":
		return errors.New("CLAUDE_CODE_MESSAGING_TOKEN is required")
	}
	if err := checkMessagingSocket(opts.SocketPath); err != nil {
		return err
	}
	for _, dir := range []string{inbox, filepath.Join(inbox, relayDoneDir), filepath.Join(inbox, relayFailedDir)} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("create %s: %w", dir, err)
		}
		if err := os.Chmod(dir, 0o700); err != nil {
			return fmt.Errorf("secure %s: %w", dir, err)
		}
	}
	release, err := acquireRelayLock(inbox, opts.SocketPath)
	if err != nil {
		return err
	}
	defer release()

	poll := opts.PollInterval
	if poll <= 0 {
		poll = defaultRelayPoll
	}
	logf := opts.Logf
	if logf == nil {
		logf = func(string, ...any) {}
	}
	for {
		n, err := relayOnce(inbox, opts.SocketPath, opts.Token, logf)
		if err != nil {
			if opts.Once {
				return err
			}
			logf("relay delivery failed: %v", err)
		}
		if opts.Once {
			logf("relay processed %d envelope(s)", n)
			return nil
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(poll):
		}
		if err := checkMessagingSocket(opts.SocketPath); err != nil {
			logf("Claude Desktop messaging socket closed; relay exiting")
			return nil
		}
	}
}

// relayOnce delivers queued envelopes in name order. A delivered envelope
// moves to done/, an unreadable one to failed/; a socket error stops the pass
// and leaves the rest queued.
func relayOnce(inbox, socketPath, token string, logf func(string, ...any)) (int, error) {
	entries, err := os.ReadDir(inbox)
	if err != nil {
		return 0, fmt.Errorf("read inbox: %w", err)
	}
	n := 0
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		path := filepath.Join(inbox, entry.Name())
		info, err := os.Lstat(path)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return n, err
		}
		if !info.Mode().IsRegular() {
			logf("relay ignored non-regular inbox entry %s", entry.Name())
			continue
		}
		_, prompt, err := ReadInboxFile(path)
		if err != nil {
			if moveErr := os.Rename(path, filepath.Join(inbox, relayFailedDir, entry.Name())); moveErr != nil && !errors.Is(moveErr, os.ErrNotExist) {
				return n, fmt.Errorf("quarantine invalid envelope: %w", moveErr)
			}
			logf("relay quarantined invalid envelope %s: %v", entry.Name(), err)
			continue
		}
		if err := sendToSession(socketPath, token, prompt); err != nil {
			return n, err
		}
		if err := os.Rename(path, filepath.Join(inbox, relayDoneDir, entry.Name())); err != nil {
			return n, fmt.Errorf("archive delivered envelope: %w", err)
		}
		n++
		logf("relay delivered %s", entry.Name())
	}
	return n, nil
}

func sendToSession(socketPath, token, prompt string) error {
	conn, err := net.DialTimeout("unix", socketPath, relayWriteTimeout)
	if err != nil {
		return fmt.Errorf("connect to the Claude Desktop messaging socket: %w", err)
	}
	defer conn.Close()
	if err := conn.SetWriteDeadline(time.Now().Add(relayWriteTimeout)); err != nil {
		return err
	}
	enc := json.NewEncoder(conn)
	if err := enc.Encode(map[string]string{"type": "auth", "token": token}); err != nil {
		return fmt.Errorf("authenticate to the messaging socket: %w", err)
	}
	frame := map[string]any{"type": "user", "message": map[string]string{"role": "user", "content": prompt}}
	if err := enc.Encode(frame); err != nil {
		return fmt.Errorf("write to the messaging socket: %w", err)
	}
	return nil
}

func checkMessagingSocket(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect the Claude Desktop messaging socket: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || info.Mode()&os.ModeSocket == 0 {
		return errors.New("CLAUDE_CODE_MESSAGING_SOCKET must be a Unix socket, not a symlink")
	}
	if info.Mode().Perm()&messagingSocketPermsMask != 0 {
		return fmt.Errorf("messaging socket permissions %04o are too broad", info.Mode().Perm())
	}
	return checkSocketOwner(info)
}
