package coordinator

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/heartbeat"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/ws"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestBriefAuthorityOutageSkipsFrameAndRevocationStillCloses(t *testing.T) {
	m := NewManager(time.Second)
	signer := newEdSigner(t)
	var answer error
	m.SetWorkerAuthority(func(context.Context, string, []byte) error { return answer })
	conn := &nodeConn{address: signer.Address(), public: signer.PublicKeyBytes()}
	m.nodes[conn.address] = &connectedNode{nodeSnapshot: nodeSnapshot{ID: conn.address, HostID: conn.address}, conn: conn}
	beat, _ := json.Marshal(heartbeat.Payload{HostID: conn.address})
	message := ws.Message{Type: "heartbeat", Payload: beat}
	timeout := status.Error(codes.DeadlineExceeded, "context deadline exceeded")

	answer = timeout
	if _, err := m.handleMessage(conn.address, conn, message); err == nil || errors.Is(err, errSkipFrame) {
		t.Fatal("a connection with no successful authority read must fail closed")
	}
	answer = nil
	if _, err := m.handleMessage(conn.address, conn, message); err != nil {
		t.Fatal(err)
	}
	answer = timeout
	if _, err := m.handleMessage(conn.address, conn, message); !errors.Is(err, errSkipFrame) {
		t.Fatalf("a brief RPC timeout after a successful read should skip one frame, got %v", err)
	}
	answer = errors.New("chain membership no longer current")
	if _, err := m.handleMessage(conn.address, conn, message); err == nil || errors.Is(err, errSkipFrame) {
		t.Fatal("revocation must close the connection")
	}
	answer = timeout
	conn.grace.Now = func() time.Time { return time.Now().Add(3 * time.Minute) }
	if _, err := m.handleMessage(conn.address, conn, message); err == nil || errors.Is(err, errSkipFrame) {
		t.Fatal("an outage longer than the grace window must close the connection")
	}
}

func TestStaleOrUnreadableObservationIsDroppedWithoutClosing(t *testing.T) {
	for _, mode := range []string{"stale", "authority timeout"} {
		t.Run(mode, func(t *testing.T) {
			m := NewManager(time.Second)
			signer := newEdSigner(t)
			conn := &nodeConn{address: signer.Address(), public: signer.PublicKeyBytes(), sessionNonce: strings.Repeat("a", 64)}
			m.SetHostObservationAuthority(func(context.Context, heartbeat.Signed, []byte) error {
				if mode == "authority timeout" {
					return status.Error(codes.Unavailable, "fullnode unavailable")
				}
				return nil
			})
			m.nodes[conn.address] = &connectedNode{nodeSnapshot: nodeSnapshot{ID: conn.address, HostID: conn.address}, conn: conn}
			observed := time.Now()
			if mode == "stale" {
				observed = observed.Add(-2 * time.Minute)
			}
			full := func(v string) string { return "0x" + strings.Repeat(v, 64) }
			payload := heartbeat.NewPayload(conn.address, "host", nil, observed)
			payload.Timestamp = observed // an observation that sat queued while the Host reconnected
			signed, err := heartbeat.Sign(signer, heartbeat.Scope{ChainIdentifier: "TestChain", OrganizationID: full("1"), MembershipID: full("2"), MembershipVersion: "1", BindingID: full("3"), BindingVersion: "1", HostAddress: conn.address}, conn.sessionNonce, 1, payload.Timestamp.UnixMilli()+60_000, payload)
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := json.Marshal(signed)
			if _, err = m.handleMessage(conn.address, conn, ws.Message{Type: "host_observation", Payload: raw}); !errors.Is(err, errSkipFrame) {
				t.Fatalf("expected the frame to be skipped, got %v", err)
			}
			if node, _ := m.FindNode(conn.address); node.HostObservation != nil || conn.observationSequence != 0 {
				t.Fatal("a skipped observation must not be recorded or advance the sequence")
			}
		})
	}
}
