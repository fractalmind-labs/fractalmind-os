package desktop

import (
	"context"
	"crypto/subtle"
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/pion/webrtc/v4"
)

//go:embed web
var webFS embed.FS

// HTTPConfig configures the signaling + client HTTP surface.
type HTTPConfig struct {
	Server ServerConfig
	// Token, if non-empty, is required as a bearer token on /offer and as a
	// ?token= query param on the client page. Input injection is powerful, so
	// signaling must not be anonymous; deploy behind TLS (or the envd tunnel).
	Token string
}

// Handler returns the HTTP handler serving the mobile client (/) and the
// WebRTC signaling endpoint (POST /offer). A single active session is kept;
// a new offer replaces the previous session.
func Handler(cfg HTTPConfig) http.Handler {
	h := &httpHandler{cfg: cfg}
	sub, _ := fs.Sub(webFS, "web")
	mux := http.NewServeMux()
	mux.HandleFunc("POST /offer", h.handleOffer)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.Handle("GET /", http.FileServer(http.FS(sub)))
	return mux
}

type httpHandler struct {
	cfg     HTTPConfig
	mu      sync.Mutex
	current *Session
}

type offerRequest struct {
	Offer webrtc.SessionDescription `json:"offer"`
}

type answerResponse struct {
	Answer webrtc.SessionDescription `json:"answer"`
}

func (h *httpHandler) authOK(r *http.Request) bool {
	if h.cfg.Token == "" {
		return true
	}
	// Accept either Authorization: Bearer <token> or ?token=<token> (the latter
	// so the mobile page can pass it without custom headers).
	if t := bearer(r.Header.Get("Authorization")); t != "" &&
		subtle.ConstantTimeCompare([]byte(t), []byte(h.cfg.Token)) == 1 {
		return true
	}
	q := r.URL.Query().Get("token")
	return q != "" && subtle.ConstantTimeCompare([]byte(q), []byte(h.cfg.Token)) == 1
}

func bearer(h string) string {
	parts := strings.Fields(strings.TrimSpace(h))
	if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
		return parts[1]
	}
	return ""
}

func (h *httpHandler) handleOffer(w http.ResponseWriter, r *http.Request) {
	if !h.authOK(r) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req offerRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		http.Error(w, "invalid offer", http.StatusBadRequest)
		return
	}
	if req.Offer.Type != webrtc.SDPTypeOffer || req.Offer.SDP == "" {
		http.Error(w, "expected an SDP offer", http.StatusBadRequest)
		return
	}

	// Replace any existing session (single-viewer model).
	h.mu.Lock()
	if h.current != nil {
		h.current.Close()
		h.current = nil
	}
	h.mu.Unlock()

	sess, answer, err := NewSession(context.Background(), h.cfg.Server, req.Offer)
	if err != nil {
		log.Printf("[desktop] session setup failed: %v", err)
		http.Error(w, "session setup failed", http.StatusInternalServerError)
		return
	}
	h.mu.Lock()
	h.current = sess
	h.mu.Unlock()
	go func() {
		<-sess.Done()
		h.mu.Lock()
		if h.current == sess {
			h.current = nil
		}
		h.mu.Unlock()
	}()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(answerResponse{Answer: *answer})
}
