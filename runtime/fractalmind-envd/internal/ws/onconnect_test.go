package ws

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-ai/fractalmind-envd/internal/wsauth"
	"github.com/gorilla/websocket"
)

// TestOnConnectRegistersAfterSlowAuth runs the full Connect loop against a
// coordinator whose handshake is slower than any fixed post-connect delay
// could reliably cover. OnConnect must fire only once auth has completed, and
// a Send issued from the hook must reach the coordinator.
func TestOnConnectRegistersAfterSlowAuth(t *testing.T) {
	coord := newEdSigner(t)
	worker := newEdSigner(t)

	got := make(chan Message, 1)
	up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))

		var init wsauth.InitPayload
		if err := readRaw(conn, wsauth.MsgAuthInit, &init); err != nil {
			return
		}
		clientNonce, _ := wsauth.DecodeNonce(init.ClientNonce)
		serverNonce, serverNonceHex, _ := wsauth.NewNonce()
		writeRaw(t, conn, wsauth.MsgAuthChallenge, wsauth.ChallengePayload{
			ServerNonce: serverNonceHex,
			Proof:       wsauth.Prove(coord, clientNonce),
		})

		var resp wsauth.ResponsePayload
		if err := readRaw(conn, wsauth.MsgAuthResponse, &resp); err != nil {
			return
		}
		if _, err := wsauth.VerifyProof(resp.Proof, serverNonce); err != nil {
			writeRaw(t, conn, wsauth.MsgAuthError, wsauth.ErrorPayload{Reason: "bad worker proof"})
			return
		}
		// Simulate a high-latency link: hold auth_ok back so the handshake
		// finishes well after connection establishment.
		time.Sleep(300 * time.Millisecond)
		writeRaw(t, conn, wsauth.MsgAuthOK, struct{}{})

		var msg Message
		if err := conn.ReadJSON(&msg); err != nil {
			return
		}
		got <- msg
	}))
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http")

	c := NewClient(url, time.Second)
	c.SetAuth(worker, coord.Address())
	c.OnConnect(func() {
		if err := c.Send("register", map[string]string{"hostname": "test"}); err != nil {
			t.Errorf("send from OnConnect failed: %v", err)
		}
	})
	t.Cleanup(c.Close)
	go c.Connect()

	select {
	case msg := <-got:
		if msg.Type != "register" {
			t.Fatalf("expected register as first post-auth message, got %q", msg.Type)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("register never reached the coordinator")
	}
}
