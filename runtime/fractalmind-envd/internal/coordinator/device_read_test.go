package coordinator

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/blake2b"
)

func deviceReadFixture(t *testing.T) (*DeviceReadAuth, *edSigner, DeviceReadRequest, *string) {
	t.Helper()
	device := newEdSigner(t)
	pin := "current"
	full := func(n string) string { return "0x" + strings.Repeat(n, 64) }
	r := DeviceReadRequest{HumanID: full("1"), GrantID: full("2"), DeviceAddress: device.Address(), OrganizationID: full("3"), BindingID: full("4"), Method: "GET", Path: "/api/sentinels"}
	a, err := NewDeviceReadAuth("pinnedChain", r.OrganizationID, r.BindingID, newEdSigner(t), func(_ context.Context, _ DeviceReadRequest) (string, error) {
		if pin == "revoked" {
			return "", fmt.Errorf("revoked")
		}
		return pin, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return a, device, r, &pin
}

func TestDeviceCommandChallengeBindsBodySignerScopeAndSingleDispatch(t *testing.T) {
	for _, mode := range []string{"valid", "replay", "body changed", "wrong signature", "foreign signer", "foreign host", "scope downgrade", "read-only phone", "revoked", "expired", "query", "lost authority during output"} {
		t.Run(mode, func(t *testing.T) {
			a, d, request, pin := deviceReadFixture(t)
			host := "0x" + strings.Repeat("5", 64)
			now := time.Now().UnixMilli()
			command := nodecommand.NodeCommand{Version: "1", CommandID: "cmd-native", Signer: d.Address(), Target: nodecommand.Target{OrganizationID: request.OrganizationID, NodeID: host, AgentID: "agent-native"}, Action: "assign", Scope: "control", Capability: nodecommand.CapabilityRef{ID: "0x" + strings.Repeat("6", 64), RevocationVersion: 1}, Nonce: "cmd-nonce", IssuedAtMS: now, ExpiresAtMS: now + 60_000, IdempotencyKey: "cmd-native", Payload: json.RawMessage(`{}`)}
			command.PayloadHash = nodecommand.HashPayload(command.Payload)
			signer := d
			if mode == "foreign signer" {
				signer = newEdSigner(t)
				command.Signer = signer.Address()
			}
			if mode == "foreign host" {
				command.Target.NodeID = "0x" + strings.Repeat("7", 64)
			}
			signing, err := command.SigningBytes()
			if err != nil {
				t.Fatal(err)
			}
			command.Signature = "ed25519:" + hex.EncodeToString(signer.pub) + ":" + hex.EncodeToString(ed25519.Sign(signer.priv, signing))
			if mode == "wrong signature" {
				command.Signature = "ed25519:" + hex.EncodeToString(signer.pub) + ":" + strings.Repeat("0", 128)
			}
			body, err := json.Marshal(map[string]any{"node_command": command})
			if err != nil {
				t.Fatal(err)
			}
			request.Method = "POST"
			request.Path = "/api/sentinels/" + host + "/command"
			request.CommandScope = "control"
			hash := sha256.Sum256(body)
			request.CommandHash = hex.EncodeToString(hash[:])
			if mode == "scope downgrade" {
				request.CommandScope = "observation"
			}
			if request.RequiredDeviceAction() != 2 && mode != "scope downgrade" {
				t.Fatal("control transport did not require operate")
			}
			if mode == "read-only phone" {
				a.verify = func(_ context.Context, r DeviceReadRequest) (string, error) {
					if r.RequiredDeviceAction() == 2 {
						return "", fmt.Errorf("missing operate grant")
					}
					return "read-only", nil
				}
				raw, _ := json.Marshal(request)
				w := httptest.NewRecorder()
				a.issue(w, httptest.NewRequest("POST", "/api/device-challenge", strings.NewReader(string(raw))))
				if w.Code != 403 {
					t.Fatal("read-only phone obtained control challenge")
				}
				return
			}
			challenge := issueRead(t, a, request)
			if mode == "body changed" {
				body = append(body, ' ')
			}
			if mode == "revoked" {
				*pin = "revoked"
			}
			if mode == "expired" {
				a.now = func() time.Time { return time.UnixMilli(challenge.ExpiresAtMS) }
			}
			incoming := httptest.NewRequest("POST", request.Path, strings.NewReader(string(body)))
			incoming.Header.Set("Authorization", proofRead(t, d, challenge))
			if mode == "query" {
				incoming.URL.RawQuery = "changed=1"
			}
			calls := 0
			handler := a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				exact, err := io.ReadAll(r.Body)
				if err != nil || string(exact) != string(body) {
					t.Fatal("forwarded command bytes differ")
				}
				if mode == "lost authority during output" {
					*pin = "revoked"
				}
				w.Write([]byte(`{"dispatched":true}`))
			}))
			output := httptest.NewRecorder()
			handler.ServeHTTP(output, incoming)
			if mode == "valid" || mode == "replay" {
				if output.Code != 200 || calls != 1 {
					t.Fatal(output.Code, output.Body.String(), calls)
				}
				if strings.Contains(output.Body.String(), `"dispatched"`) {
					t.Fatal("unsigned raw response returned")
				}
				if mode == "replay" {
					incoming.Body = io.NopCloser(strings.NewReader(string(body)))
					again := httptest.NewRecorder()
					handler.ServeHTTP(again, incoming)
					if again.Code != 403 || calls != 1 {
						t.Fatal("command was dispatched twice")
					}
				}
			} else if output.Code != 403 || mode != "lost authority during output" && calls != 0 || mode == "lost authority during output" && calls != 1 {
				t.Fatal(mode, output.Code, calls)
			}
		})
	}
}
func issueRead(t *testing.T, a *DeviceReadAuth, r DeviceReadRequest) DeviceReadChallenge {
	t.Helper()
	raw, _ := json.Marshal(r)
	response := httptest.NewRecorder()
	a.issue(response, httptest.NewRequest("POST", "/api/device-challenge", strings.NewReader(string(raw))))
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	var c DeviceReadChallenge
	if json.Unmarshal(response.Body.Bytes(), &c) != nil {
		t.Fatal("invalid challenge")
	}
	return c
}
func proofRead(t *testing.T, d *edSigner, c DeviceReadChallenge) string {
	t.Helper()
	msg := []byte(deviceProofText(c))
	data := []byte{3, 0, 0}
	n := uint32(len(msg))
	for n >= 128 {
		data = append(data, byte(n)|128)
		n >>= 7
	}
	data = append(data, byte(n))
	data = append(data, msg...)
	hash := blake2b.Sum256(data)
	sig := append([]byte{0}, ed25519.Sign(d.priv, hash[:])...)
	sig = append(sig, d.pub...)
	raw, _ := json.Marshal(readProof{Nonce: c.Nonce, Signature: base64.StdEncoding.EncodeToString(sig)})
	return "FractalMind " + base64.RawURLEncoding.EncodeToString(raw)
}
func TestDeviceReadSingleUseScopeAndCurrentAuthority(t *testing.T) {
	for _, mode := range []string{"valid", "replay", "path changed", "query", "signature changed", "expired", "revoked", "version changed", "change during output", "unsigned", "bearer", "write method"} {
		t.Run(mode, func(t *testing.T) {
			a, d, r, pin := deviceReadFixture(t)
			c := issueRead(t, a, r)
			auth := proofRead(t, d, c)
			request := httptest.NewRequest("GET", r.Path, nil)
			request.Header.Set("Authorization", auth)
			switch mode {
			case "path changed":
				request.URL.Path = "/api/health"
			case "query":
				request.URL.RawQuery = "secret=1"
			case "signature changed":
				request.Header.Set("Authorization", proofRead(t, newEdSigner(t), c))
			case "expired":
				a.now = func() time.Time { return time.UnixMilli(c.ExpiresAtMS) }
			case "revoked":
				*pin = "revoked"
			case "version changed":
				*pin = "different"
			case "unsigned":
				request.Header.Del("Authorization")
			case "bearer":
				request.Header.Set("Authorization", "Bearer legacy-token")
			case "write method":
				request.Method = "POST"
			}
			called := false
			handler := a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				called = true
				if mode == "change during output" {
					*pin = "revoked"
				}
				w.Write([]byte(`{"private":"observation"}`))
			}))
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if mode == "valid" || mode == "replay" {
				if response.Code != 200 || !called {
					t.Fatal(response.Code, response.Body.String())
				}
				if strings.Contains(response.Body.String(), `"private"`) {
					t.Fatal("unsigned raw directory body returned")
				}
				if mode == "replay" {
					again := httptest.NewRecorder()
					handler.ServeHTTP(again, request)
					if again.Code != 403 {
						t.Fatal("proof replayed")
					}
				}
			} else if response.Code != 403 || strings.Contains(response.Body.String(), "observation") {
				t.Fatal("unauthorized data escaped", response.Code)
			}
		})
	}
}
func TestDeviceReadRejectsUnscopedChallengeAndExcessCapacity(t *testing.T) {
	a, _, r, _ := deviceReadFixture(t)
	rawRequest, _ := json.Marshal(r)
	for _, body := range []string{string(rawRequest) + strings.Repeat(" ", 2049), string(rawRequest) + "{}"} {
		w := httptest.NewRecorder()
		a.issue(w, httptest.NewRequest("POST", "/api/device-challenge", strings.NewReader(body)))
		if w.Code != 400 {
			t.Fatal("oversized or trailing challenge body admitted")
		}
	}
	for _, mutate := range []func(*DeviceReadRequest){func(r *DeviceReadRequest) { r.BindingID = "0xwrong" }, func(r *DeviceReadRequest) { r.OrganizationID = "0xforeign" }, func(r *DeviceReadRequest) { r.Method = "POST" }, func(r *DeviceReadRequest) { r.Path = "/api/sentinels/display-name" }} {
		bad := r
		mutate(&bad)
		raw, _ := json.Marshal(bad)
		w := httptest.NewRecorder()
		a.issue(w, httptest.NewRequest("POST", "/api/device-challenge", strings.NewReader(string(raw))))
		if w.Code != 400 {
			t.Fatal("invalid scope admitted")
		}
	}
	for i := 0; i < 256; i++ {
		issueRead(t, a, r)
	}
	raw, _ := json.Marshal(r)
	w := httptest.NewRecorder()
	a.issue(w, httptest.NewRequest("POST", "/api/device-challenge", strings.NewReader(string(raw))))
	if w.Code != 429 {
		t.Fatal("unbounded pending read challenges")
	}
}
