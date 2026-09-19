package ws

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-ai/fractalmind-envd/internal/wsauth"
	"github.com/gorilla/websocket"
)

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

// fakeCoordinator serves one connection and runs the coordinator side of the
// handshake using the documented protocol. If forgeProof is true it signs the
// worker nonce with a *different* key than it claims (impostor gateway).
func fakeCoordinator(t *testing.T, coord *edSigner, forgeProof bool) string {
	t.Helper()
	up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))

		var init wsauth.InitPayload
		if err := readRaw(conn, wsauth.MsgAuthInit, &init); err != nil {
			return
		}
		clientNonce, _ := wsauth.DecodeNonce(init.ClientNonce)
		serverNonce, serverNonceHex, _ := wsauth.NewNonce()

		proofSigner := wsauth.Signer(coord)
		if forgeProof {
			proofSigner = newEdSigner(t) // real signature, but wrong identity claim below
		}
		proof := wsauth.Prove(proofSigner, clientNonce)
		if forgeProof {
			proof.Address = coord.Address() // claim the pinned identity we cannot sign for
			proof.PublicKey = hexPub(coord)
		}
		writeRaw(t, conn, wsauth.MsgAuthChallenge, wsauth.ChallengePayload{ServerNonce: serverNonceHex, Proof: proof})

		var resp wsauth.ResponsePayload
		if err := readRaw(conn, wsauth.MsgAuthResponse, &resp); err != nil {
			return
		}
		if _, err := wsauth.VerifyProof(resp.Proof, serverNonce); err != nil {
			writeRaw(t, conn, wsauth.MsgAuthError, wsauth.ErrorPayload{Reason: "bad worker proof"})
			return
		}
		writeRaw(t, conn, wsauth.MsgAuthOK, struct{}{})
	}))
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

func hexPub(s *edSigner) string {
	p := wsauth.Prove(s, make([]byte, wsauth.NonceSize))
	return p.PublicKey
}

func readRaw(conn *websocket.Conn, want string, out interface{}) error {
	var raw Message
	if err := conn.ReadJSON(&raw); err != nil {
		return err
	}
	if raw.Type != want {
		return errUnexpected
	}
	return json.Unmarshal(raw.Payload, out)
}

func writeRaw(t *testing.T, conn *websocket.Conn, typ string, payload interface{}) {
	t.Helper()
	data, _ := json.Marshal(payload)
	if err := conn.WriteJSON(Message{Type: typ, Payload: data}); err != nil {
		t.Logf("write %s: %v", typ, err)
	}
}

var errUnexpected = &wsErr{"unexpected message type"}

type wsErr struct{ s string }

func (e *wsErr) Error() string { return e.s }

func dialAndAuth(t *testing.T, url string, c *Client) error {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	return c.authenticate(conn)
}

func TestClientAuthSuccessWithPin(t *testing.T) {
	coord := newEdSigner(t)
	worker := newEdSigner(t)
	url := fakeCoordinator(t, coord, false)

	c := NewClient(url, time.Second)
	c.SetAuth(worker, coord.Address()) // pin the real coordinator
	if err := dialAndAuth(t, url, c); err != nil {
		t.Fatalf("expected successful auth, got %v", err)
	}
}

func TestClientAuthSuccessWithoutPin(t *testing.T) {
	coord := newEdSigner(t)
	worker := newEdSigner(t)
	url := fakeCoordinator(t, coord, false)

	c := NewClient(url, time.Second)
	c.SetAuth(worker, "") // no pin: authenticates but does not pin
	if err := dialAndAuth(t, url, c); err != nil {
		t.Fatalf("expected successful auth without pin, got %v", err)
	}
}

func TestClientRejectsWrongPin(t *testing.T) {
	coord := newEdSigner(t)
	worker := newEdSigner(t)
	other := newEdSigner(t)
	url := fakeCoordinator(t, coord, false)

	c := NewClient(url, time.Second)
	c.SetAuth(worker, other.Address()) // pin a different coordinator
	if err := dialAndAuth(t, url, c); err == nil {
		t.Fatal("expected worker to reject a coordinator whose address does not match the pin")
	}
}

func TestClientRejectsForgedCoordinatorProof(t *testing.T) {
	coord := newEdSigner(t)
	worker := newEdSigner(t)
	url := fakeCoordinator(t, coord, true) // impostor: claims coord identity it cannot sign for

	c := NewClient(url, time.Second)
	c.SetAuth(worker, coord.Address())
	if err := dialAndAuth(t, url, c); err == nil {
		t.Fatal("expected worker to reject a coordinator that cannot prove its claimed identity")
	}
}
