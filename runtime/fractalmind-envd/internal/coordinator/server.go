package coordinator

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/fractalmind-ai/fractalmind-envd/internal/heartbeat"
	"github.com/fractalmind-ai/fractalmind-envd/internal/wsauth"
	"github.com/gorilla/websocket"
)

type commandRequest struct {
	Command     string          `json:"command,omitempty"`
	AgentID     string          `json:"agent_id,omitempty"`
	Args        string          `json:"args,omitempty"`
	NodeCommand json.RawMessage `json:"node_command,omitempty"`
}

type sentinelSummary struct {
	ID            string                `json:"id"`
	HostID        string                `json:"host_id"`
	Hostname      string                `json:"hostname"`
	Version       string                `json:"version"`
	ConnectedAt   time.Time             `json:"connected_at"`
	LastHeartbeat *time.Time            `json:"last_heartbeat"`
	AgentCount    int                   `json:"agent_count"`
	UptimeSeconds int64                 `json:"uptime_seconds"`
	System        *heartbeat.SystemInfo `json:"system"`
	DesktopURL    string                `json:"desktop_url,omitempty"`
}

// Server exposes the embedded coordinator REST and WebSocket API.
type Server struct {
	addr         string
	apiToken     string
	manager      *Manager
	upgrader     websocket.Upgrader
	httpServer   *http.Server
	listener     net.Listener
	pingInterval time.Duration
	done         chan struct{}
}

func NewServer(addr string, commandTimeout time.Duration, apiToken string) *Server {
	if addr == "" {
		addr = ":8080"
	}

	return &Server{
		addr:     addr,
		apiToken: strings.TrimSpace(apiToken),
		manager:  NewManager(commandTimeout),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool { return true },
		},
		pingInterval: 30 * time.Second,
		done:         make(chan struct{}),
	}
}

// SetAuth enables control-channel authentication on the worker /ws endpoint,
// using the coordinator's SUI keypair and an optional worker allowlist.
func (s *Server) SetAuth(signer wsauth.Signer, allowedSigners []string) {
	s.manager.SetAuth(signer, allowedSigners)
}

func (s *Server) Start() error {
	listener, err := net.Listen("tcp", s.addr)
	if err != nil {
		return err
	}

	s.listener = listener
	s.httpServer = &http.Server{
		Handler:           s.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		if err := s.httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("[coordinator] http server error: %v", err)
		}
	}()

	go s.pingLoop()

	return nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/sentinels", s.handleListSentinels)
	mux.HandleFunc("GET /api/sentinels/{id}", s.handleGetSentinel)
	mux.HandleFunc("GET /api/sentinels/{id}/agents", s.handleGetAgents)
	mux.HandleFunc("POST /api/sentinels/{id}/command", s.handleCommand)
	mux.HandleFunc("GET /api/sentinels/{id}/desktop/ice", s.handleDesktopICE)
	mux.HandleFunc("GET /api/sentinels/{id}/desktop/status", s.handleDesktopStatus)
	mux.HandleFunc("POST /api/sentinels/{id}/desktop/offer", s.handleDesktopOffer)
	mux.HandleFunc("GET /ws", s.handleWebSocket)
	return s.withAPITokenAuth(mux)
}

func (s *Server) Shutdown(ctx context.Context) error {
	select {
	case <-s.done:
	default:
		close(s.done)
	}

	s.manager.Close()

	if s.httpServer == nil {
		return nil
	}

	return s.httpServer.Shutdown(ctx)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	nodes := s.manager.ListNodes()
	totalAgents := 0
	for _, node := range nodes {
		totalAgents += len(node.Agents)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":       "ok",
		"sentinels":    len(nodes),
		"total_agents": totalAgents,
	})
}

func (s *Server) handleListSentinels(w http.ResponseWriter, _ *http.Request) {
	nodes := s.manager.ListNodes()
	summaries := make([]sentinelSummary, 0, len(nodes))
	for _, node := range nodes {
		summaries = append(summaries, sentinelSummary{
			ID:            node.ID,
			HostID:        node.HostID,
			Hostname:      node.Hostname,
			Version:       node.Version,
			ConnectedAt:   node.ConnectedAt,
			LastHeartbeat: node.LastHeartbeat,
			AgentCount:    len(node.Agents),
			UptimeSeconds: node.UptimeSeconds,
			System:        node.System,
			DesktopURL:    node.DesktopURL,
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"sentinels": summaries,
		"count":     len(summaries),
	})
}

func (s *Server) handleGetSentinel(w http.ResponseWriter, r *http.Request) {
	node, ok := s.manager.FindNode(r.PathValue("id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "sentinel not found"})
		return
	}

	writeJSON(w, http.StatusOK, node)
}

func (s *Server) handleGetAgents(w http.ResponseWriter, r *http.Request) {
	node, ok := s.manager.FindNode(r.PathValue("id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "sentinel not found"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"agents": node.Agents,
		"count":  len(node.Agents),
	})
}

func (s *Server) handleCommand(w http.ResponseWriter, r *http.Request) {
	const maxCommandRequestBytes = 1 << 20
	body, err := io.ReadAll(io.LimitReader(r.Body, maxCommandRequestBytes+1))
	if err != nil || len(body) > maxCommandRequestBytes {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	var req commandRequest
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if _, present := fields["node_command"]; present {
		rawNodeCommand := bytes.TrimSpace(req.NodeCommand)
		if len(rawNodeCommand) == 0 || bytes.Equal(rawNodeCommand, []byte("null")) || rawNodeCommand[0] != '{' {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "node_command must be a JSON object"})
			return
		}
		if _, present := fields["command"]; present {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "node_command cannot be combined with legacy command fields"})
			return
		}
		if _, present := fields["agent_id"]; present {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "node_command cannot be combined with legacy command fields"})
			return
		}
		if _, present := fields["args"]; present {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "node_command cannot be combined with legacy command fields"})
			return
		}
		req.Command = "signed_command"
		req.Args = string(rawNodeCommand)
	}

	if req.Command == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "command or node_command is required"})
		return
	}

	result, err := s.manager.SendCommand(r.PathValue("id"), req.Command, req.AgentID, req.Args)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, context.DeadlineExceeded) {
			status = http.StatusGatewayTimeout
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// handleDesktopICE relays a GET /ice to the target node's envd-desktop server.
func (s *Server) handleDesktopICE(w http.ResponseWriter, r *http.Request) {
	s.relayDesktop(w, r, http.MethodGet, "/ice", nil)
}

// handleDesktopStatus relays a GET /status to the target node's envd-desktop server.
func (s *Server) handleDesktopStatus(w http.ResponseWriter, r *http.Request) {
	s.relayDesktop(w, r, http.MethodGet, "/status", nil)
}

// handleDesktopOffer relays a POST /offer (SDP) to the target node.
func (s *Server) handleDesktopOffer(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	s.relayDesktop(w, r, http.MethodPost, "/offer", body)
}

func (s *Server) relayDesktop(w http.ResponseWriter, r *http.Request, method, path string, body []byte) {
	status, respBody, err := s.manager.SendDesktopSignal(r.PathValue("id"), method, path, body)
	if err != nil {
		httpStatus := http.StatusBadGateway
		if strings.Contains(err.Error(), "not found") {
			httpStatus = http.StatusNotFound
		} else if strings.Contains(err.Error(), "timed out") {
			httpStatus = http.StatusGatewayTimeout
		}
		writeJSON(w, httpStatus, map[string]string{"error": err.Error()})
		return
	}
	if status == 0 {
		status = http.StatusBadGateway
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(respBody)
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[coordinator] websocket upgrade failed: %v", err)
		return
	}

	s.manager.HandleConnection(conn)
}

func (s *Server) pingLoop() {
	ticker := time.NewTicker(s.pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.manager.PingAll()
		case <-s.done:
			return
		}
	}
}

func (s *Server) withAPITokenAuth(next http.Handler) http.Handler {
	if s.apiToken == "" {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}

		if !validBearerToken(r.Header.Get("Authorization"), s.apiToken) {
			w.Header().Set("WWW-Authenticate", "Bearer")
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		next.ServeHTTP(w, r)
	})
}

func validBearerToken(authHeader, expectedToken string) bool {
	parts := strings.Fields(strings.TrimSpace(authHeader))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return false
	}

	return subtle.ConstantTimeCompare([]byte(parts[1]), []byte(expectedToken)) == 1
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("[coordinator] write response failed: %v", err)
	}
}
