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
	mux.HandleFunc("GET /ice", h.handleICE)
	mux.HandleFunc("GET /status", h.handleStatus)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.Handle("GET /", http.FileServer(http.FS(sub)))
	return corsMiddleware(mux)
}

// corsMiddleware allows a browser served from a different origin (e.g. an
// Agent Console web build on another host) to call the signaling endpoints.
// Auth is the bearer/query token, not the origin, so allowing any origin is
// safe here; the OPTIONS preflight must be answered before the method-based
// mux, which would otherwise 405 it.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type iceServerJSON struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// handleICE returns the server's ICE servers so the browser peer uses the same
// STUN/TURN as the pion side. Without this the client only has STUN and cannot
// traverse symmetric (cellular CGNAT) NATs even when the server has TURN.
// It is token-gated like /offer: the response can carry TURN credentials, so an
// unauthenticated caller must not be able to read them (TURN relay abuse).
func (h *httpHandler) handleICE(w http.ResponseWriter, r *http.Request) {
	if !h.authOK(r) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	out := make([]iceServerJSON, 0, len(h.cfg.Server.ICEServers))
	for _, s := range h.cfg.Server.ICEServers {
		cred, _ := s.Credential.(string)
		out = append(out, iceServerJSON{URLs: s.URLs, Username: s.Username, Credential: cred})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"iceServers": out})
}

type httpHandler struct {
	cfg     HTTPConfig
	mu      sync.Mutex
	current *Session
	last    *SessionStatus
}

type desktopStatusResponse struct {
	OK          bool           `json:"ok"`
	TURNEnabled bool           `json:"turn_enabled"`
	ICEServers  int            `json:"ice_servers"`
	Session     *SessionStatus `json:"session,omitempty"`
}

type desktopQuality struct {
	EncodeHeight int    `json:"encode_height,omitempty"`
	FPS          int    `json:"fps,omitempty"`
	Bitrate      string `json:"bitrate,omitempty"`
}

type offerRequest struct {
	Offer   webrtc.SessionDescription `json:"offer"`
	Quality *desktopQuality           `json:"quality,omitempty"`
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

func (h *httpHandler) handleStatus(w http.ResponseWriter, r *http.Request) {
	if !h.authOK(r) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	h.mu.Lock()
	current := h.current
	var last *SessionStatus
	if h.last != nil {
		cp := *h.last
		last = &cp
	}
	h.mu.Unlock()
	resp := desktopStatusResponse{
		OK:          true,
		TURNEnabled: hasTURN(h.cfg.Server.ICEServers),
		ICEServers:  len(h.cfg.Server.ICEServers),
	}
	if current != nil {
		st := current.Status()
		resp.Session = &st
	} else if last != nil {
		resp.Session = last
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
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
		st := h.current.Status()
		h.last = &st
		h.current.Close()
		h.current = nil
	}
	h.mu.Unlock()

	srvCfg := h.cfg.Server
	if req.Quality != nil {
		srvCfg.Capture = applyDesktopQuality(srvCfg.Capture, *req.Quality)
	}
	sess, answer, err := NewSession(context.Background(), srvCfg, req.Offer)
	if err != nil {
		log.Printf("[desktop] session setup failed: %v", err)
		http.Error(w, "session setup failed", http.StatusInternalServerError)
		return
	}
	h.mu.Lock()
	h.current = sess
	h.last = nil
	h.mu.Unlock()
	go func() {
		<-sess.Done()
		st := sess.Status()
		h.mu.Lock()
		h.last = &st
		if h.current == sess {
			h.current = nil
		}
		h.mu.Unlock()
	}()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(answerResponse{Answer: *answer})
}

func hasTURN(servers []webrtc.ICEServer) bool {
	for _, srv := range servers {
		for _, u := range srv.URLs {
			if strings.HasPrefix(strings.ToLower(u), "turn:") || strings.HasPrefix(strings.ToLower(u), "turns:") {
				return true
			}
		}
	}
	return false
}

func applyDesktopQuality(cfg CaptureConfig, q desktopQuality) CaptureConfig {
	if q.EncodeHeight > 0 {
		cfg.EncodeHeight = clampInt(q.EncodeHeight, 360, 2160)
	}
	if q.FPS > 0 {
		cfg.FPS = clampInt(q.FPS, 10, 60)
	}
	if q.Bitrate != "" {
		cfg.Bitrate = q.Bitrate
	}
	return cfg
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
