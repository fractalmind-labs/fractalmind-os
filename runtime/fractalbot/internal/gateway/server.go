package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/bus"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/channels"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/configv2"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/heartbeat"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/router"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/secrets"
	"github.com/gorilla/websocket"
)

// Server is the gateway: it runs the channels, routes their messages and the
// schedules to agents, and serves the local HTTP API.
type Server struct {
	config       *configv2.Config
	upgrader     websocket.Upgrader
	clients      map[string]*Client
	clientsMutex sync.RWMutex
	httpServer   *http.Server
	channels     *channels.Manager
	router       *router.Router
	messageBus   *bus.MessageBus
	heartbeat    *heartbeat.Scheduler
	redactor     *secrets.Redactor
	startTime    time.Time
}

// Options are what a server needs beyond its configuration.
type Options struct {
	// Secrets are resolved values by secret name.
	Secrets map[string]string
	// Redactor masks secrets in status errors; nil masks token shapes only.
	Redactor *secrets.Redactor
	// Router replaces the default router, for tests.
	Router *router.Router
}

// NewServer creates a gateway for a validated configuration.
func NewServer(cfg *configv2.Config, opts Options) (*Server, error) {
	channelManager := channels.NewManager(cfg, opts.Secrets)
	rt := opts.Router
	if rt == nil {
		rt = router.New(cfg, nil)
	}
	scheduler, err := heartbeat.New(ScheduleConfig(cfg), rt)
	if err != nil {
		return nil, fmt.Errorf("initialize schedules: %w", err)
	}
	if scheduler != nil {
		rt.SetInboundHook(scheduler.ResetForInbound)
	}
	messageBus := bus.New(rt, channelManager, 64, 64)
	messageBus.Start()
	channelManager.SetHandler(messageBus)
	return &Server{
		config: cfg,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin:     buildOriginChecker(cfg.Gateway.AllowedOrigins),
		},
		clients:    make(map[string]*Client),
		channels:   channelManager,
		router:     rt,
		messageBus: messageBus,
		heartbeat:  scheduler,
		redactor:   opts.Redactor,
	}, nil
}

// ScheduleConfig turns the configuration's schedules into the scheduler's
// jobs, each with its agent's runtime and time zone resolved.
func ScheduleConfig(cfg *configv2.Config) *heartbeat.Config {
	out := &heartbeat.Config{
		Enabled:       len(cfg.Schedules.Jobs) > 0,
		StatePath:     cfg.Paths().Schedules(),
		MaxConcurrent: cfg.Schedules.MaxConcurrent,
	}
	for _, id := range sortedJobIDs(cfg) {
		j := cfg.Schedules.Jobs[id]
		agent := cfg.Agents[j.Agent]
		job := heartbeat.JobConfig{
			ID:                 id,
			Runtime:            agent.Runtime,
			Agent:              j.Agent,
			Text:               j.Prompt,
			DispatchMode:       j.Mode,
			TimeoutSeconds:     j.TimeoutSeconds,
			Cron:               j.Cron,
			Timezone:           cfg.JobTimezone(j),
			AgentCronProfiles:  j.Backoff,
			ResetCronOnInbound: j.ResetOnInbound,
			StartIfMissing:     agent.Runtime == configv2.RuntimeAgentManager && cfg.Runtimes.AgentManager.StartIfMissing,
		}
		if j.PromptFile != "" {
			job.PromptFile = cfg.PromptFilePath(j)
		}
		out.Jobs = append(out.Jobs, job)
	}
	return out
}

func sortedJobIDs(cfg *configv2.Config) []string {
	ids := make([]string, 0, len(cfg.Schedules.Jobs))
	for id := range cfg.Schedules.Jobs {
		ids = append(ids, id)
	}
	sortStrings(ids)
	return ids
}

// Start runs the gateway until ctx ends.
func (s *Server) Start(ctx context.Context) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWebSocket)
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/status", s.handleStatus)
	mux.HandleFunc("/api/v1/message/send", s.handleMessageSend)
	mux.HandleFunc("/api/v1/heartbeat/jobs/", s.handleHeartbeatJob)
	if s.startTime.IsZero() {
		s.startTime = time.Now()
	}
	s.httpServer = &http.Server{
		Addr:              net.JoinHostPort(s.config.Gateway.Bind, strconv.Itoa(s.config.Gateway.Port)),
		Handler:           mux,
		ErrorLog:          log.New(os.Stderr, "HTTP: ", log.LstdFlags),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	if err := s.channels.Start(ctx); err != nil {
		return fmt.Errorf("failed to start channels: %w", err)
	}
	if err := s.heartbeat.Start(ctx); err != nil {
		return fmt.Errorf("failed to start schedules: %w", err)
	}
	go func() {
		log.Printf("🌐 HTTP server listening on %s", s.httpServer.Addr)
		if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("HTTP server error: %v", err)
		}
	}()
	<-ctx.Done()
	return nil
}

// Stop shuts the gateway down.
func (s *Server) Stop() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.heartbeat.Stop(ctx); err != nil {
		return fmt.Errorf("failed to stop schedules: %w", err)
	}
	if s.messageBus != nil {
		s.messageBus.Close()
		s.messageBus.Wait()
	}
	if err := s.channels.Stop(); err != nil {
		return fmt.Errorf("failed to stop channels: %w", err)
	}
	for _, client := range s.snapshotClients() {
		client.Close()
	}
	if s.httpServer != nil {
		if err := s.httpServer.Shutdown(ctx); err != nil {
			return fmt.Errorf("server shutdown error: %w", err)
		}
	}
	return nil
}

func buildOriginChecker(allowed []string) func(*http.Request) bool {
	configured := len(allowed) > 0
	allowedSet := make(map[string]struct{})
	for _, origin := range allowed {
		normalized, ok := normalizeOrigin(origin)
		if !ok {
			continue
		}
		allowedSet[normalized] = struct{}{}
	}

	return func(r *http.Request) bool {
		if !configured {
			return true
		}
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin == "" {
			return false
		}
		normalized, ok := normalizeOrigin(origin)
		if !ok {
			return false
		}
		_, ok = allowedSet[normalized]
		return ok
	}
}

func normalizeOrigin(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", false
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", false
	}
	return fmt.Sprintf("%s://%s", strings.ToLower(parsed.Scheme), strings.ToLower(parsed.Host)), true
}

// handleWebSocket handles incoming WebSocket connections
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	conn.SetReadLimit(readLimit)
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	clientID := r.URL.Query().Get("session")
	if clientID == "" {
		clientID = generateClientID()
	}

	client := NewClient(clientID, conn, s)

	s.clientsMutex.Lock()
	s.clients[clientID] = client
	s.clientsMutex.Unlock()

	log.Printf("🔌 Client connected: %s", clientID)

	// Handle client messages
	go client.Handle()
}

// generateClientID generates a unique client ID
func generateClientID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}

// GetAgentManager returns the agent manager
type healthResponse struct {
	Status            string               `json:"status"`
	Uptime            string               `json:"uptime"`
	Channels          []healthChannelEntry `json:"channels"`
	MessagesProcessed int64                `json:"messages_processed"`
}

type healthChannelEntry struct {
	Name    string `json:"name"`
	Running bool   `json:"running"`
}

func (s *Server) uptime() time.Duration {
	if s.startTime.IsZero() {
		return 0
	}
	return time.Since(s.startTime)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	var processed int64
	if s.messageBus != nil {
		stats := s.messageBus.Stats()
		processed = stats.InboundProcessed + stats.OutboundProcessed
	}
	entries := make([]healthChannelEntry, 0)
	for _, ch := range s.channels.List() {
		entries = append(entries, healthChannelEntry{Name: ch.Name(), Running: ch.IsRunning()})
	}
	writeJSON(w, http.StatusOK, healthResponse{Status: "ok", Uptime: s.uptime().String(), Channels: entries, MessagesProcessed: processed})
}

type statusResponse struct {
	Status        string            `json:"status"`
	ActiveClients int               `json:"active_clients"`
	Uptime        string            `json:"uptime"`
	Agents        []agentStatus     `json:"agents"`
	Channels      []channelStatus   `json:"channels"`
	Heartbeat     *heartbeat.Status `json:"heartbeat,omitempty"`
}

// agentStatus is one agent with its channels, runtime presence, last delivery
// and schedules.
type agentStatus struct {
	router.AgentStatus
	Schedules []heartbeat.JobStatus `json:"schedules,omitempty"`
}

type channelStatus struct {
	Ref          string                          `json:"ref"`
	Agents       []string                        `json:"agents"`
	Default      string                          `json:"default,omitempty"`
	Running      bool                            `json:"running"`
	Unavailable  string                          `json:"unavailable,omitempty"`
	Mode         string                          `json:"mode,omitempty"`
	Webhook      *channels.TelegramWebhookStatus `json:"webhook,omitempty"`
	LastError    string                          `json:"last_error,omitempty"`
	LastActivity string                          `json:"last_activity,omitempty"`
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	hb := s.heartbeat.Status()
	resp := statusResponse{
		Status:        "ok",
		ActiveClients: s.activeClients(),
		Uptime:        s.uptime().String(),
		Channels:      s.channelStatus(),
		Heartbeat:     hb,
	}
	for _, a := range s.router.Status(r.Context()) {
		entry := agentStatus{AgentStatus: a}
		if a.LastDelivery != nil {
			last := *a.LastDelivery
			last.Error = s.redact(last.Error)
			entry.LastDelivery = &last
		}
		if hb != nil {
			for _, job := range hb.Jobs {
				if job.Agent == a.Name {
					entry.Schedules = append(entry.Schedules, job)
				}
			}
		}
		resp.Agents = append(resp.Agents, entry)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) redact(text string) string {
	if text == "" {
		return ""
	}
	return s.redactor.Redact(text)
}

func (s *Server) channelStatus() []channelStatus {
	unavailable := s.channels.Unavailable()
	out := make([]channelStatus, 0)
	for _, inst := range s.config.ChannelList() {
		name := inst.Type
		if inst.Type == configv2.ChannelFeishu {
			name = "feishu/" + inst.Name
		}
		st := channelStatus{Ref: inst.Ref, Agents: s.config.AgentsFor(inst.Ref), Default: inst.Sharing.Default, Unavailable: unavailable[inst.Ref]}
		if ch := s.channels.Get(name); ch != nil {
			st.Running = ch.IsRunning()
			if provider, ok := ch.(channels.TelemetryProvider); ok {
				st.LastError = formatStatusTime(provider.LastError())
				st.LastActivity = formatStatusTime(provider.LastActivity())
			}
			if bot, ok := ch.(*channels.TelegramBot); ok {
				st.Mode = bot.Mode()
				webhook := bot.WebhookStatus()
				st.Webhook = &webhook
			}
		}
		out = append(out, st)
	}
	return out
}

type messageSendRequest struct {
	Channel    string   `json:"channel"`
	To         string   `json:"to"`
	Text       string   `json:"text"`
	ThreadTS   string   `json:"thread_ts,omitempty"`
	Images     []string `json:"images,omitempty"`
	ReceiverID string   `json:"receiver_id,omitempty"`
	// Agent is the sending agent. On a channel several agents share, its name
	// prefixes the text so people can tell who replied.
	Agent string `json:"agent,omitempty"`
}

type messageSendResponse struct {
	Status      string `json:"status"`
	Channel     string `json:"channel,omitempty"`
	To          string `json:"to,omitempty"`
	ThreadTS    string `json:"thread_ts,omitempty"`
	ChannelID   string `json:"channel_id,omitempty"`
	ChannelName string `json:"channel_name,omitempty"`
	MessageTS   string `json:"message_ts,omitempty"`
	Error       string `json:"error,omitempty"`
}

func (s *Server) handleMessageSend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSON(w, http.StatusMethodNotAllowed, messageSendResponse{Status: "error", Error: "method not allowed"})
		return
	}
	var request messageSendRequest
	decoder := json.NewDecoder(io.LimitReader(r.Body, 64*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, messageSendResponse{Status: "error", Error: "invalid JSON payload"})
		return
	}
	request.Channel = strings.ToLower(strings.TrimSpace(request.Channel))
	request.To = strings.TrimSpace(request.To)
	request.Text = strings.TrimSpace(request.Text)
	request.ThreadTS = strings.TrimSpace(request.ThreadTS)
	request.ReceiverID = strings.TrimSpace(request.ReceiverID)
	request.Agent = strings.TrimSpace(request.Agent)
	images := make([]string, 0, len(request.Images))
	for _, path := range request.Images {
		if trimmed := strings.TrimSpace(path); trimmed != "" {
			images = append(images, trimmed)
		}
	}
	request.Images = images

	switch {
	case request.Channel == "":
		writeJSON(w, http.StatusBadRequest, messageSendResponse{Status: "error", Error: "channel is required"})
		return
	case request.To == "":
		writeJSON(w, http.StatusBadRequest, messageSendResponse{Status: "error", Error: "to is required"})
		return
	case request.Text == "" && len(request.Images) == 0:
		writeJSON(w, http.StatusBadRequest, messageSendResponse{Status: "error", Error: "text or images is required"})
		return
	case len(request.Images) > 0 && !imageSendChannelSupported(request.Channel):
		writeJSON(w, http.StatusBadRequest, messageSendResponse{Status: "error", Error: fmt.Sprintf("channel %q does not support image attachment yet (issue #374); currently supported: feishu", request.Channel)})
		return
	}
	if request.Agent != "" && request.Text != "" {
		kind, _, _ := strings.Cut(request.Channel, "/")
		ref, ok := s.router.ChannelRef(map[string]interface{}{"channel": kind, "receiver_id": request.ReceiverID})
		if !ok {
			writeJSON(w, http.StatusNotFound, messageSendResponse{Status: "error", Error: "channel is not configured"})
			return
		}
		bound := false
		for _, a := range s.config.AgentsFor(ref) {
			bound = bound || a == request.Agent
		}
		if !bound {
			writeJSON(w, http.StatusBadRequest, messageSendResponse{Status: "error", Error: fmt.Sprintf("agent %q does not use channel %s", request.Agent, ref)})
			return
		}
		if s.router.Shared(ref) {
			request.Text = "[" + request.Agent + "] " + request.Text
		}
	}
	if s.messageBus == nil {
		writeJSON(w, http.StatusServiceUnavailable, messageSendResponse{Status: "error", Error: "message bus unavailable"})
		return
	}
	result, err := s.messageBus.PublishOutbound(r.Context(), request.Channel, channels.OutboundMessage{
		To:         request.To,
		Text:       request.Text,
		ThreadTS:   request.ThreadTS,
		Images:     request.Images,
		ReceiverID: request.ReceiverID,
	})
	if err != nil {
		status := http.StatusBadGateway
		if strings.Contains(err.Error(), "not found") {
			status = http.StatusNotFound
		}
		writeJSON(w, status, messageSendResponse{Status: "error", Error: s.redact(err.Error())})
		return
	}
	resp := messageSendResponse{Status: "ok", Channel: request.Channel, To: request.To, ThreadTS: request.ThreadTS}
	if result != nil {
		resp.ChannelID = result.ChannelID
		resp.ChannelName = result.ChannelName
		resp.MessageTS = result.MessageTS
		if result.ThreadTS != "" {
			resp.ThreadTS = result.ThreadTS
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

type heartbeatCronRequest struct {
	Profile string `json:"profile"`
	Reason  string `json:"reason"`
}

type heartbeatCronResponse struct {
	Status string               `json:"status"`
	Job    *heartbeat.JobStatus `json:"job,omitempty"`
	Error  string               `json:"error,omitempty"`
}

// handleHeartbeatJob routes a job's /cron and /outcome endpoints.
func (s *Server) handleHeartbeatJob(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, "/outcome") {
		s.handleHeartbeatOutcome(w, r)
		return
	}
	s.handleHeartbeatCron(w, r)
}

type heartbeatOutcomeRequest struct {
	RunID   string `json:"run_id"`
	Result  string `json:"result"`
	Summary string `json:"summary,omitempty"`
}

// handleHeartbeatOutcome records what an Agent reports about its latest run.
func (s *Server) handleHeartbeatOutcome(w http.ResponseWriter, r *http.Request) {
	if !isLoopbackRequest(r) {
		writeJSON(w, http.StatusForbidden, heartbeatCronResponse{Status: "error", Error: "heartbeat outcome API is restricted to loopback clients"})
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSON(w, http.StatusMethodNotAllowed, heartbeatCronResponse{Status: "error", Error: "method not allowed"})
		return
	}
	jobID, ok := heartbeatJobIDFromPathWithSuffix(r.URL.Path, "/outcome")
	if !ok {
		writeJSON(w, http.StatusNotFound, heartbeatCronResponse{Status: "error", Error: "heartbeat outcome endpoint not found"})
		return
	}
	heartbeatStatus := s.heartbeat.Status()
	if heartbeatStatus == nil || !heartbeatStatus.Enabled {
		writeJSON(w, http.StatusServiceUnavailable, heartbeatCronResponse{Status: "error", Error: "heartbeat scheduler is disabled"})
		return
	}
	var request heartbeatOutcomeRequest
	decoder := json.NewDecoder(io.LimitReader(r.Body, 64*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, heartbeatCronResponse{Status: "error", Error: "invalid JSON payload"})
		return
	}
	status, err := s.heartbeat.RecordOutcome(jobID, request.RunID, request.Result, request.Summary)
	if err != nil {
		statusCode := http.StatusBadRequest
		switch {
		case strings.Contains(err.Error(), "not found"):
			statusCode = http.StatusNotFound
		case strings.Contains(err.Error(), "not the latest run"):
			statusCode = http.StatusConflict
		}
		writeJSON(w, statusCode, heartbeatCronResponse{Status: "error", Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, heartbeatCronResponse{Status: "ok", Job: &status})
}

func (s *Server) handleHeartbeatCron(w http.ResponseWriter, r *http.Request) {
	if !isLoopbackRequest(r) {
		writeJSON(w, http.StatusForbidden, heartbeatCronResponse{Status: "error", Error: "heartbeat schedule API is restricted to loopback clients"})
		return
	}
	if r.Method != http.MethodPut && r.Method != http.MethodDelete {
		w.Header().Set("Allow", http.MethodPut+", "+http.MethodDelete)
		writeJSON(w, http.StatusMethodNotAllowed, heartbeatCronResponse{Status: "error", Error: "method not allowed"})
		return
	}

	jobID, ok := heartbeatJobIDFromPath(r.URL.Path)
	if !ok {
		writeJSON(w, http.StatusNotFound, heartbeatCronResponse{Status: "error", Error: "heartbeat cron endpoint not found"})
		return
	}
	heartbeatStatus := s.heartbeat.Status()
	if heartbeatStatus == nil || !heartbeatStatus.Enabled {
		writeJSON(w, http.StatusServiceUnavailable, heartbeatCronResponse{Status: "error", Error: "heartbeat scheduler is disabled"})
		return
	}

	var (
		status heartbeat.JobStatus
		err    error
	)
	if r.Method == http.MethodPut {
		var request heartbeatCronRequest
		decoder := json.NewDecoder(io.LimitReader(r.Body, 64*1024))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			writeJSON(w, http.StatusBadRequest, heartbeatCronResponse{Status: "error", Error: "invalid JSON payload"})
			return
		}
		status, err = s.heartbeat.SetProfile(jobID, request.Profile, request.Reason, "local-api")
	} else {
		status, err = s.heartbeat.ResetProfile(jobID, "manual reset", "local-api")
	}
	if err != nil {
		statusCode := http.StatusBadRequest
		if strings.Contains(err.Error(), "not found") {
			statusCode = http.StatusNotFound
		}
		writeJSON(w, statusCode, heartbeatCronResponse{Status: "error", Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, heartbeatCronResponse{Status: "ok", Job: &status})
}

func heartbeatJobIDFromPath(path string) (string, bool) {
	return heartbeatJobIDFromPathWithSuffix(path, "/cron")
}

func heartbeatJobIDFromPathWithSuffix(path, suffix string) (string, bool) {
	const prefix = "/api/v1/heartbeat/jobs/"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	jobID := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	jobID = strings.Trim(jobID, "/")
	if jobID == "" || strings.Contains(jobID, "/") {
		return "", false
	}
	return jobID, true
}

func isLoopbackRequest(r *http.Request) bool {
	if r == nil {
		return false
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err != nil {
		host = strings.Trim(strings.TrimSpace(r.RemoteAddr), "[]")
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// imageSendChannelSupported reports whether a channel can deliver image
// attachments. Feishu is the first implementation (issue #374); others return
// explicit errors instead of silently dropping images.
func imageSendChannelSupported(channel string) bool {
	return channel == "feishu"
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("failed to encode JSON response (status=%s): %v", strconv.Itoa(statusCode), err)
	}
}

func (s *Server) activeClients() int {
	s.clientsMutex.RLock()
	defer s.clientsMutex.RUnlock()
	return len(s.clients)
}

func formatStatusTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}
func (s *Server) snapshotClients() []*Client {
	s.clientsMutex.RLock()
	defer s.clientsMutex.RUnlock()

	clients := make([]*Client, 0, len(s.clients))
	for _, client := range s.clients {
		clients = append(clients, client)
	}
	return clients
}

func (s *Server) removeClient(id string) {
	s.clientsMutex.Lock()
	defer s.clientsMutex.Unlock()
	delete(s.clients, id)
}

func sortStrings(values []string) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
}
