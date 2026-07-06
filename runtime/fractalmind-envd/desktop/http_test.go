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
