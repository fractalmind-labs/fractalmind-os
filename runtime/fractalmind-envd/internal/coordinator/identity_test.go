package coordinator

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/heartbeat"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/ws"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/wsauth"
	"github.com/gorilla/websocket"
)

func authenticatedWorker(t *testing.T, url string, worker wsauth.Signer) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, nonce, _ := wsauth.NewNonce()
	writeWSMsg(t, conn, wsauth.MsgAuthInit, wsauth.InitPayload{ClientNonce: nonce})
	var challenge wsauth.ChallengePayload
	if err = readWSMsg(conn, wsauth.MsgAuthChallenge, &challenge); err != nil {
		t.Fatal(err)
	}
	serverNonce, err := wsauth.DecodeNonce(challenge.ServerNonce)
	if err != nil {
		t.Fatal(err)
	}
	writeWSMsg(t, conn, wsauth.MsgAuthResponse, wsauth.ResponsePayload{Proof: wsauth.Prove(worker, serverNonce)})
	var ok struct{}
	if err = readWSMsg(conn, wsauth.MsgAuthOK, &ok); err != nil {
		t.Fatal(err)
	}
	return conn
}

func TestAuthenticatedWorkerCannotClaimAnotherHost(t *testing.T) {
	m := NewManager(time.Second)
	m.SetAuth(newEdSigner(t), nil)
	worker := newEdSigner(t)
	conn := authenticatedWorker(t, coordTestServer(t, m), worker)
	writeWSMsg(t, conn, "register", registerPayload{HostID: newEdSigner(t).Address(), Hostname: "victim"})
	var msg ws.Message
	if err := conn.ReadJSON(&msg); err == nil {
		t.Fatal("forged registration stayed connected")
	}
	if len(m.ListNodes()) != 0 {
		t.Fatal("forged worker installed a directory entry")
	}
}

func TestCurrentAuthorityRecheckedOnHeartbeatAndRouting(t *testing.T) {
	for _, mode := range []string{"heartbeat", "command", "desktop", "handshake"} {
		t.Run(mode, func(t *testing.T) {
			m := NewManager(100 * time.Millisecond)
			coord, worker := newEdSigner(t), newEdSigner(t)
			m.SetAuth(coord, nil)
			var revoked atomic.Bool
			if mode == "handshake" {
				revoked.Store(true)
			}
			m.SetWorkerAuthority(func(_ context.Context, address string, public []byte) error {
				if address != worker.Address() || len(public) != 32 {
					return fmt.Errorf("foreign signer")
				}
				if revoked.Load() {
					return fmt.Errorf("chain membership no longer current")
				}
				return nil
			})
			url := coordTestServer(t, m)
			if mode == "handshake" {
				if _, err := runWorkerHandshake(t, url, worker); err == nil {
					t.Fatal("unadmitted signer passed auth")
				}
				return
			}
			conn := authenticatedWorker(t, url, worker)
			writeWSMsg(t, conn, "register", registerPayload{HostID: worker.Address(), Hostname: "display-name"})
			deadline := time.Now().Add(time.Second)
			for len(m.ListNodes()) == 0 && time.Now().Before(deadline) {
				time.Sleep(time.Millisecond)
			}
			if len(m.ListNodes()) != 1 {
				t.Fatal("authorized worker not registered")
			}
			if _, found := m.FindNode("display-name"); found {
				t.Fatal("hostname treated as chain identity")
			}
			revoked.Store(true)
			switch mode {
			case "heartbeat":
				writeWSMsg(t, conn, "heartbeat", heartbeat.Payload{HostID: worker.Address()})
				var msg ws.Message
				if conn.ReadJSON(&msg) == nil {
					t.Fatal("revoked heartbeat survived")
				}
			case "command":
				if _, err := m.SendCommand(worker.Address(), "signed_command", "", "{}"); err == nil {
					t.Fatal("revoked routing accepted")
				}
			case "desktop":
				if _, _, err := m.SendDesktopSignal(worker.Address(), "GET", "/status", nil); err == nil {
					t.Fatal("revoked desktop accepted")
				}
			}
		})
	}
}

func TestResponseAndCleanupAreBoundToOriginalConnection(t *testing.T) {
	m := NewManager(time.Second)
	original, other := &nodeConn{}, &nodeConn{}
	pending := &pendingCommand{conn: original, resultCh: make(chan map[string]interface{}, 1)}
	signal := &pendingSignal{conn: original, resultCh: make(chan desktopSignalResult, 1)}
	m.pendingCommands["cmd"] = pending
	m.pendingSignals["sig"] = signal
	for _, msg := range []ws.Message{{Type: "command_result", Payload: mustRawJSON(commandResultPayload{RequestID: "cmd"})}, {Type: "desktop_signal_result", Payload: mustRawJSON(desktopSignalResult{RequestID: "sig", Status: 200})}} {
		if _, err := m.handleMessage("other", other, msg); err != nil {
			t.Fatal(err)
		}
	}
	if len(m.pendingCommands) != 1 || len(m.pendingSignals) != 1 || len(pending.resultCh) != 0 || len(signal.resultCh) != 0 {
		t.Fatal("unrelated worker completed another request")
	}
	m.nodes["host"] = &connectedNode{conn: other}
	m.removeConnection("host", original)
	if len(m.nodes) != 1 {
		t.Fatal("old disconnect deleted current connection")
	}
}
