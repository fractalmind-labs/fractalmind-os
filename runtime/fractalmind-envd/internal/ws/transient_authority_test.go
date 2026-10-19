package ws

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestBriefAuthorityOutageDropsFrameWithinGraceAndClosesAfter(t *testing.T) {
	messages := make(chan Message, 4)
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
	var answer error
	c.validateConnection = func(context.Context) error { return answer }
	if err := c.Send("heartbeat", map[string]string{"n": "1"}); err != nil {
		t.Fatal(err)
	}
	<-messages
	answer = status.Error(codes.DeadlineExceeded, "context deadline exceeded")
	if c.Send("heartbeat", map[string]string{"n": "2"}) == nil {
		t.Fatal("an unverified frame was sent")
	}
	select {
	case <-closed:
		t.Fatal("a brief RPC timeout closed the connection")
	case <-messages:
		t.Fatal("an unverified frame was sent")
	case <-time.After(100 * time.Millisecond):
	}
	c.grace.Now = func() time.Time { return time.Now().Add(3 * time.Minute) }
	if c.Send("heartbeat", map[string]string{"n": "3"}) == nil {
		t.Fatal("an unverified frame was sent")
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("an outage past the grace window kept the connection open")
	}
}

func TestReceivedFrameSkippedDuringBriefOutageIsNotDispatched(t *testing.T) {
	up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		_ = writeMsg(conn, "command", CommandPayload{Command: "signed_command", RequestID: "during-outage"})
		<-release
		_ = writeMsg(conn, "command", CommandPayload{Command: "signed_command", RequestID: "after-recovery"})
		var message Message
		_ = conn.ReadJSON(&message)
	}))
	defer server.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	c := NewClient("unused", time.Hour)
	c.SetAuth(newEdSigner(t), "")
	defer c.cancel()
	c.grace.Succeeded()
	outage := make(chan struct{})
	c.validateConnection = func(context.Context) error {
		select {
		case <-outage:
			return nil
		default:
			close(outage)
			return status.Error(codes.Unavailable, "fullnode unavailable")
		}
	}
	dispatched := make(chan CommandPayload, 2)
	c.OnCommand(func(command CommandPayload) { dispatched <- command })
	go c.readLoop(conn)
	<-outage
	close(release)
	select {
	case command := <-dispatched:
		if command.RequestID != "after-recovery" {
			t.Fatalf("a command received during the outage was dispatched: %s", command.RequestID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the connection did not survive the brief outage")
	}
}
