package ws

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/gorilla/websocket"
)

func TestReceivedCommandRechecksSnapshotOnceBeforeDispatchAndRejectsRevocation(t *testing.T) {
	advance := make(chan struct{})
	up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		if writeMsg(conn, "command", CommandPayload{Command: "signed_command", RequestID: "original"}) != nil {
			return
		}
		<-advance
		_ = writeMsg(conn, "command", CommandPayload{Command: "signed_command", RequestID: "revoked"})
		var message Message
		_ = conn.ReadJSON(&message)
	}))
	defer server.Close()
	defer func() {
		select {
		case <-advance:
		default:
			close(advance)
		}
	}()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	c := NewClient("unused", time.Hour)
	c.SetAuth(newEdSigner(t), "")
	defer c.cancel()
	var checks atomic.Int32
	c.validateConnection = func(context.Context) error {
		switch checks.Add(1) {
		case 1:
			return nodecommand.ErrChainSnapshotChanged
		case 2:
			return nil
		default:
			return errors.New("membership revoked")
		}
	}
	dispatched := make(chan CommandPayload, 2)
	c.OnCommand(func(command CommandPayload) { dispatched <- command })
	finished := make(chan struct{})
	go func() { c.readLoop(conn); close(finished) }()
	select {
	case command := <-dispatched:
		if command.RequestID != "original" || checks.Load() != 2 {
			t.Fatal("original command dispatched without fresh authority")
		}
	case <-time.After(time.Second):
		close(advance)
		t.Fatal("original received command lost during snapshot race")
	}
	close(advance)
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("revocation did not stop dispatch")
	}
	select {
	case <-dispatched:
		t.Fatal("revoked command dispatched")
	default:
	}
}

func TestSnapshotRaceDropsFrameWithoutDisconnectAndRevocationStillCloses(t *testing.T) {
	messages := make(chan Message, 2)
	closed := make(chan struct{})
	up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		defer close(closed)
		for {
			var message Message
			if conn.ReadJSON(&message) != nil {
				return
			}
			messages <- message
		}
	}))
	defer server.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	c := NewClient("unused", time.Hour)
	c.SetAuth(newEdSigner(t), "")
	c.conn = conn
	defer conn.Close()
	defer c.cancel()
	check := nodecommand.ErrChainSnapshotChanged
	c.validateConnection = func(context.Context) error { return check }
	if !errors.Is(c.Send("heartbeat", map[string]string{"state": "unverified"}), nodecommand.ErrChainSnapshotChanged) {
		t.Fatal("snapshot race became permission")
	}
	select {
	case <-closed:
		t.Fatal("snapshot race disconnected current transport")
	case <-messages:
		t.Fatal("unverified frame sent")
	default:
	}
	check = nil
	if err := c.Send("verified", map[string]string{"state": "fresh"}); err != nil {
		t.Fatal(err)
	}
	select {
	case message := <-messages:
		if message.Type != "verified" {
			t.Fatal("unverified heartbeat leaked")
		}
	case <-time.After(time.Second):
		t.Fatal("fresh read could not use original socket")
	}
	check = errors.New("membership revoked")
	if c.Send("must-not-send", nil) == nil {
		t.Fatal("revocation became permission")
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("revoked transport not closed")
	}
	select {
	case <-messages:
		t.Fatal("revoked frame sent")
	default:
	}
}

func TestCloseCancelsChainLookupBeforeDial(t *testing.T) {
	c := NewClient("ws://must-not-dial.invalid", time.Hour)
	started := make(chan struct{})
	c.SetChainAuthority(func(ctx context.Context) (string, string, error) {
		close(started)
		<-ctx.Done()
		return "", "", ctx.Err()
	}, nil)
	finished := make(chan struct{})
	go func() { c.Connect(); close(finished) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("chain lookup did not start")
	}
	c.Close()
	c.Close()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("closed Host waited for retry instead of canceling chain lookup")
	}
}
