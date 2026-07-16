package desktop

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pion/webrtc/v4"
)

func TestOfferRequiresAuth(t *testing.T) {
	h := Handler(HTTPConfig{Token: "secret"})
	srv := httptest.NewServer(h)
	defer srv.Close()

	body, _ := json.Marshal(offerRequest{Offer: webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: "x"}})
	// No token -> 401.
	resp, err := http.Post(srv.URL+"/offer", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no-token offer: got %d, want 401", resp.StatusCode)
	}
	// Wrong token -> 401.
	req, _ := http.NewRequest("POST", srv.URL+"/offer", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer nope")
	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong-token offer: got %d, want 401", resp.StatusCode)
	}
}

func TestOfferRejectsNonOffer(t *testing.T) {
	h := Handler(HTTPConfig{}) // no token
	srv := httptest.NewServer(h)
	defer srv.Close()

	// An answer where an offer is expected -> 400.
	body, _ := json.Marshal(offerRequest{Offer: webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: "x"}})
	resp, err := http.Post(srv.URL+"/offer", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("non-offer: got %d, want 400", resp.StatusCode)
	}
}

func TestHealthAndClientServed(t *testing.T) {
	h := Handler(HTTPConfig{})
	srv := httptest.NewServer(h)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/healthz")
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("healthz: err=%v status=%v", err, resp.StatusCode)
	}
	resp, err = http.Get(srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	page, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(page), "envd desktop") {
		t.Fatal("client page not served from embedded FS")
	}
}

func TestCORSHeadersAndPreflight(t *testing.T) {
	h := Handler(HTTPConfig{})
	srv := httptest.NewServer(h)
	defer srv.Close()

	// A cross-origin browser fetch must see an allow-origin header.
	resp, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("allow-origin = %q, want *", got)
	}

	// The POST /offer preflight (OPTIONS) must be answered, not 405'd by the
	// method-based mux.
	req, _ := http.NewRequest(http.MethodOptions, srv.URL+"/offer", nil)
	req.Header.Set("Origin", "https://console.example.com")
	req.Header.Set("Access-Control-Request-Method", "POST")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want 204", resp.StatusCode)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("preflight allow-origin = %q, want *", got)
	}
}

func TestBearerParse(t *testing.T) {
	if bearer("Bearer abc") != "abc" {
		t.Fatal("bearer parse failed")
	}
	if bearer("Basic abc") != "" {
		t.Fatal("non-bearer should be empty")
	}
	if bearer("") != "" {
		t.Fatal("empty should be empty")
	}
}

func TestICERequiresAuth(t *testing.T) {
	h := Handler(HTTPConfig{Token: "secret"})
	srv := httptest.NewServer(h)
	defer srv.Close()
	// No token -> 401 (ICE response can carry TURN credentials).
	resp, err := http.Get(srv.URL + "/ice")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("/ice without token: got %d, want 401", resp.StatusCode)
	}
	// With token -> 200.
	resp, err = http.Get(srv.URL + "/ice?token=secret")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("/ice with token: got %d, want 200", resp.StatusCode)
	}
}

func TestApplyDesktopQuality(t *testing.T) {
	cfg := CaptureConfig{FPS: 25, Bitrate: "4M", EncodeHeight: 720}
	got := applyDesktopQuality(cfg, desktopQuality{EncodeHeight: 1080, FPS: 30, Bitrate: "10M"})
	if got.EncodeHeight != 1080 || got.FPS != 30 || got.Bitrate != "10M" {
		t.Fatalf("quality override = %+v", got)
	}
	got = applyDesktopQuality(cfg, desktopQuality{EncodeHeight: 9999, FPS: 999, Bitrate: "12M"})
	if got.EncodeHeight != 2160 || got.FPS != 60 || got.Bitrate != "12M" {
		t.Fatalf("quality clamp = %+v", got)
	}
	got = applyDesktopQuality(cfg, desktopQuality{EncodeHeight: 1, FPS: 1})
	if got.EncodeHeight != 360 || got.FPS != 10 {
		t.Fatalf("quality lower clamp = %+v", got)
	}
}
