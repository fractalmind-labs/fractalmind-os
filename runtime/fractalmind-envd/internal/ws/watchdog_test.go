package ws

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// A peer that reads data but never sends pong simulates a half-open path:
// ordinary writes may succeed, but the return path provides no liveness proof.
func TestWatchdogReconnectsAndReregistersAfterMissingPong(t *testing.T) {
	registrations := make(chan int, 10)
	var connections atomic.Int32
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		n := connections.Add(1)
		conn.SetPingHandler(func(string) error { return nil })
		for {
			var msg Message
			if err := conn.ReadJSON(&msg); err != nil {
				return
			}
			if msg.Type == "register" {
				registrations <- int(n)
			}
		}
	}))
	t.Cleanup(srv.Close)
	c := NewClient("ws"+strings.TrimPrefix(srv.URL, "http"), 10*time.Millisecond)
	c.pingInterval = 20 * time.Millisecond
	c.pongTimeout = 120 * time.Millisecond
	c.OnConnect(func() { _ = c.Send("register", map[string]string{"hostname": "test"}) })
	t.Cleanup(c.Close)
	go c.Connect()
	for want := 1; want <= 2; want++ {
		select {
		case got := <-registrations:
			if got != want {
				t.Fatalf("registration connection = %d, want %d", got, want)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("registration %d not received", want)
		}
	}
}

func TestWatchdogKeepsResponsiveConnection(t *testing.T) {
	registered := make(chan struct{}, 1)
	var connections atomic.Int32
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		connections.Add(1)
		for {
			var msg Message
			if err := conn.ReadJSON(&msg); err != nil {
				return
			}
			if msg.Type == "register" {
				select {
				case registered <- struct{}{}:
				default:
				}
			}
		}
	}))
	t.Cleanup(srv.Close)
	c := NewClient("ws"+strings.TrimPrefix(srv.URL, "http"), 10*time.Millisecond)
	c.pingInterval = 20 * time.Millisecond
	c.pongTimeout = 120 * time.Millisecond
	c.OnConnect(func() { _ = c.Send("register", map[string]string{"hostname": "test"}) })
	t.Cleanup(c.Close)
	go c.Connect()
	select {
	case <-registered:
	case <-time.After(2 * time.Second):
		t.Fatal("registration not received")
	}
	time.Sleep(400 * time.Millisecond)
	if got := connections.Load(); got != 1 {
		t.Fatalf("healthy peer reconnected %d times", got-1)
	}
}
