package coordinator

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-ai/fractalmind-envd/internal/ws"
	"github.com/fractalmind-ai/fractalmind-envd/internal/wsauth"
	"github.com/gorilla/websocket"
)

// edSigner is a test Signer backed by an Ed25519 key (mirrors sui.Keypair).
type edSigner struct {
	priv ed25519.PrivateKey
	pub  ed25519.PublicKey
}

func newEdSigner(t *testing.T) *edSigner {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	return &edSigner{priv: priv, pub: pub}
}

func (s *edSigner) Sign(data []byte) []byte { return ed25519.Sign(s.priv, data) }
func (s *edSigner) PublicKeyBytes() []byte  { return s.pub }
func (s *edSigner) Address() string         { return wsauth.DeriveAddress(s.pub) }

// coordTestServer starts an httptest server whose /ws handler drives the real
// Manager.HandleConnection. Returns the ws:// URL.
func coordTestServer(t *testing.T, m *Manager) string {
	t.Helper()
	up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		m.HandleConnection(conn)
	}))
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

// runWorkerHandshake performs the worker side of the handshake against a real
// coordinator, using the documented wire protocol. Returns the verified
// coordinator address and any error.
func runWorkerHandshake(t *testing.T, url string, worker wsauth.Signer) (string, error) {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))

	clientNonce, clientNonceHex, _ := wsauth.NewNonce()
	writeWSMsg(t, conn, wsauth.MsgAuthInit, wsauth.InitPayload{ClientNonce: clientNonceHex})

	var ch wsauth.ChallengePayload
	if err := readWSMsg(conn, wsauth.MsgAuthChallenge, &ch); err != nil {
		return "", err
	}
	coordAddr, err := wsauth.VerifyProof(ch.Proof, clientNonce)
	if err != nil {
		return "", err
	}
	serverNonce, _ := wsauth.DecodeNonce(ch.ServerNonce)
	writeWSMsg(t, conn, wsauth.MsgAuthResponse, wsauth.ResponsePayload{Proof: wsauth.Prove(worker, serverNonce)})

	var raw ws.Message
	if err := conn.ReadJSON(&raw); err != nil {
		return "", err
	}
	if raw.Type != wsauth.MsgAuthOK {
		return coordAddr, &authRejected{raw.Type}
	}
	return coordAddr, nil
}

type authRejected struct{ typ string }

func (e *authRejected) Error() string { return "auth rejected: " + e.typ }

func writeWSMsg(t *testing.T, conn *websocket.Conn, typ string, payload interface{}) {
	t.Helper()
	data, _ := json.Marshal(payload)
	if err := conn.WriteJSON(ws.Message{Type: typ, Payload: data}); err != nil {
		t.Fatalf("write %s: %v", typ, err)
	}
}

func readWSMsg(conn *websocket.Conn, want string, out interface{}) error {
	var raw ws.Message
	if err := conn.ReadJSON(&raw); err != nil {
		return err
	}
	if raw.Type != want {
		return &authRejected{raw.Type}
	}
	return json.Unmarshal(raw.Payload, out)
}

func TestCoordinatorAuthSuccess(t *testing.T) {
	coord := newEdSigner(t)
	worker := newEdSigner(t)
	m := NewManager(time.Second)
	m.SetAuth(coord, nil) // empty allowlist = any authenticated identity
	url := coordTestServer(t, m)

	coordAddr, err := runWorkerHandshake(t, url, worker)
	if err != nil {
		t.Fatalf("handshake failed: %v", err)
	}
	if coordAddr != coord.Address() {
		t.Fatalf("worker saw coordinator %s, want %s", coordAddr, coord.Address())
	}
}

func TestCoordinatorAuthEnforcesAllowlist(t *testing.T) {
	coord := newEdSigner(t)
	worker := newEdSigner(t)
	allowed := newEdSigner(t)
	m := NewManager(time.Second)
	m.SetAuth(coord, []string{allowed.Address()}) // worker not listed
	url := coordTestServer(t, m)

	if _, err := runWorkerHandshake(t, url, worker); err == nil {
		t.Fatal("expected coordinator to reject a worker outside allowed_signers")
	}
}

func TestCoordinatorAuthAcceptsAllowlisted(t *testing.T) {
	coord := newEdSigner(t)
	worker := newEdSigner(t)
	m := NewManager(time.Second)
	m.SetAuth(coord, []string{worker.Address()})
	url := coordTestServer(t, m)

	if _, err := runWorkerHandshake(t, url, worker); err != nil {
		t.Fatalf("expected allowlisted worker to be accepted, got %v", err)
	}
}
