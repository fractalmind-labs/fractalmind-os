package agent

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRunClaudeDesktopRelayOnceDeliversAndArchivesEnvelope(t *testing.T) {
	inbox := filepath.Join(t.TempDir(), "inbox")
	if err := os.MkdirAll(inbox, 0700); err != nil {
		t.Fatal(err)
	}
	queuedPath := filepath.Join(inbox, "test-envelope.json")
	if err := os.WriteFile(queuedPath, []byte(`{"prompt":"hello from FractalBot"}`), 0600); err != nil {
		t.Fatal(err)
	}

	socketPath, listener, closeSocket := newClaudeDesktopRelayTestSocket(t)
	defer closeSocket()

	type receivedFrames struct {
		auth claudeDesktopRelayAuthFrame
		user claudeDesktopRelayUserFrame
		err  error
	}
	received := make(chan receivedFrames, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			received <- receivedFrames{err: err}
			return
		}
		defer conn.Close()
		decoder := json.NewDecoder(conn)
		var frames receivedFrames
		if err := decoder.Decode(&frames.auth); err != nil {
			frames.err = err
			received <- frames
			return
		}
		frames.err = decoder.Decode(&frames.user)
		received <- frames
	}()

	const token = "session-secret"
	var logs strings.Builder
	err := RunClaudeDesktopRelay(context.Background(), ClaudeDesktopRelayOptions{
		InboxPath:  inbox,
		SocketPath: socketPath,
		Token:      token,
		Once:       true,
		Logf: func(format string, args ...interface{}) {
			logs.WriteString(format)
		},
	})
	if err != nil {
		t.Fatalf("RunClaudeDesktopRelay: %v", err)
	}

	select {
	case frames := <-received:
		if frames.err != nil {
			t.Fatalf("decode relay frames: %v", frames.err)
		}
		if frames.auth.Type != "auth" || frames.auth.Token != token {
			t.Fatalf("unexpected auth frame: %#v", frames.auth)
		}
		if frames.user.Type != "user" || frames.user.Message.Role != "user" || frames.user.Message.Content != "hello from FractalBot" {
			t.Fatalf("unexpected user frame: %#v", frames.user)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for relay frames")
	}

	if _, err := os.Stat(queuedPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("queued envelope still exists: %v", err)
	}
	if _, err := os.Stat(filepath.Join(inbox, "done", filepath.Base(queuedPath))); err != nil {
		t.Fatalf("delivered envelope was not archived: %v", err)
	}
	if strings.Contains(logs.String(), token) {
		t.Fatal("relay logged the session token")
	}
}

func TestRunClaudeDesktopRelayQuarantinesInvalidEnvelope(t *testing.T) {
	inbox := filepath.Join(t.TempDir(), "inbox")
	if err := os.MkdirAll(inbox, 0700); err != nil {
		t.Fatal(err)
	}
	queuedPath := filepath.Join(inbox, "broken.json")
	if err := os.WriteFile(queuedPath, []byte(`{"prompt":`), 0600); err != nil {
		t.Fatal(err)
	}
	socketPath, _, closeSocket := newClaudeDesktopRelayTestSocket(t)
	defer closeSocket()

	err := RunClaudeDesktopRelay(context.Background(), ClaudeDesktopRelayOptions{
		InboxPath:  inbox,
		SocketPath: socketPath,
		Token:      "session-secret",
		Once:       true,
	})
	if err != nil {
		t.Fatalf("RunClaudeDesktopRelay: %v", err)
	}
	if _, err := os.Stat(filepath.Join(inbox, "failed", filepath.Base(queuedPath))); err != nil {
		t.Fatalf("invalid envelope was not quarantined: %v", err)
	}
}

func TestRunClaudeDesktopRelayRejectsSecondRelayForInbox(t *testing.T) {
	inbox := filepath.Join(t.TempDir(), "inbox")
	socketPath, _, closeSocket := newClaudeDesktopRelayTestSocket(t)
	defer closeSocket()

	ctx, cancel := context.WithCancel(context.Background())
	firstDone := make(chan error, 1)
	go func() {
		firstDone <- RunClaudeDesktopRelay(ctx, ClaudeDesktopRelayOptions{
			InboxPath:    inbox,
			SocketPath:   socketPath,
			Token:        "session-secret",
			PollInterval: 10 * time.Millisecond,
		})
	}()

	lockPath := filepath.Join(inbox, ".relay.lock", "owner.json")
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, err := os.Stat(lockPath); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("first relay did not acquire the lock")
		}
		time.Sleep(10 * time.Millisecond)
	}

	err := RunClaudeDesktopRelay(context.Background(), ClaudeDesktopRelayOptions{
		InboxPath:  inbox,
		SocketPath: socketPath,
		Token:      "session-secret",
		Once:       true,
	})
	if !errors.Is(err, ErrClaudeDesktopRelayAlreadyRunning) {
		t.Fatalf("expected relay lock error, got %v", err)
	}

	cancel()
	select {
	case err := <-firstDone:
		if err != nil {
			t.Fatalf("first relay: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("first relay did not stop")
	}
}

func newClaudeDesktopRelayTestSocket(t *testing.T) (string, net.Listener, func()) {
	t.Helper()
	tmp, err := os.CreateTemp("/tmp", "fractalbot-relay-test-")
	if err != nil {
		t.Fatal(err)
	}
	socketPath := tmp.Name() + ".sock"
	if err := tmp.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(tmp.Name()); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(socketPath, 0600); err != nil {
		listener.Close()
		t.Fatal(err)
	}
	return socketPath, listener, func() {
		_ = listener.Close()
		_ = os.Remove(socketPath)
	}
}
