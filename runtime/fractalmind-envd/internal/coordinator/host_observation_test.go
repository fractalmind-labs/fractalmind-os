package coordinator

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/heartbeat"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/ws"
)

func TestHostObservationRequiresCurrentConnectionAndSingleSequence(t *testing.T) {
	for _, mode := range []string{"valid", "replayed", "wrong session", "wrong key", "revoked authority", "unsigned heartbeat", "missing registration", "invalid signature"} {
		t.Run(mode, func(t *testing.T) {
			m := NewManager(time.Second)
			signer := newEdSigner(t)
			conn := &nodeConn{address: signer.Address(), public: signer.PublicKeyBytes(), sessionNonce: strings.Repeat("a", 64)}
			m.SetHostObservationAuthority(func(context.Context, heartbeat.Signed, []byte) error {
				if mode == "revoked authority" {
					return fmt.Errorf("revoked")
				}
				return nil
			})
			m.nodes[conn.address] = &connectedNode{nodeSnapshot: nodeSnapshot{ID: conn.address, HostID: conn.address}, conn: conn}
			full := func(v string) string { return "0x" + strings.Repeat(v, 64) }
			payload := heartbeat.NewPayload(conn.address, "actual-host", nil, time.Now())
			signed, err := heartbeat.Sign(signer, heartbeat.Scope{ChainIdentifier: "TestChain", OrganizationID: full("1"), MembershipID: full("2"), MembershipVersion: "1", BindingID: full("3"), BindingVersion: "1", HostAddress: conn.address}, conn.sessionNonce, 1, payload.Timestamp.UnixMilli()+60_000, payload)
			if err != nil {
				t.Fatal(err)
			}
			typ := "host_observation"
			switch mode {
			case "wrong session":
				conn.sessionNonce = strings.Repeat("b", 64)
			case "wrong key":
				conn.public = newEdSigner(t).pub
			case "unsigned heartbeat":
				typ = "heartbeat"
			case "missing registration":
				delete(m.nodes, conn.address)
			case "invalid signature":
				signed.Signature = strings.Repeat("0", 128)
			}
			raw, _ := json.Marshal(signed)
			if typ == "heartbeat" {
				raw, _ = json.Marshal(payload)
			}
			message := ws.Message{Type: typ, Payload: raw}
			_, err = m.handleMessage(conn.address, conn, message)
			if mode == "valid" || mode == "replayed" {
				if err != nil {
					t.Fatal(err)
				}
				got, ok := m.FindNode(conn.address)
				if !ok || got.HostObservation == nil || got.HostObservation.Signature != signed.Signature || got.LastHeartbeat == nil {
					t.Fatal("original Host evidence not retained")
				}
				got.HostObservation.Signature = "mutated"
				current, _ := m.FindNode(conn.address)
				if current.HostObservation.Signature != signed.Signature {
					t.Fatal("snapshot leaked mutable Host envelope")
				}
				if mode == "replayed" {
					if _, err = m.handleMessage(conn.address, conn, message); err == nil {
						t.Fatal("replay accepted")
					}
				}
			} else if err == nil {
				t.Fatal("invalid Host observation accepted")
			}
		})
	}
}
