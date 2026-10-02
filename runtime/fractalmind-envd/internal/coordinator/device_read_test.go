package coordinator

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
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
