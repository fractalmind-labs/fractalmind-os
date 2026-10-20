package gateway

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/channels"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/configv2"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/router"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/secrets"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/pkg/localruntime"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/pkg/protocol"
)

// recordingAdapter accepts every delivery.
type recordingAdapter struct {
	mu  sync.Mutex
	got []localruntime.Request
}

func (a *recordingAdapter) Name() string { return "agentManager" }
func (a *recordingAdapter) Capabilities() localruntime.Capabilities {
	return localruntime.Capabilities{}
}
func (a *recordingAdapter) Deliver(_ context.Context, _ localruntime.Target, r localruntime.Request) localruntime.Result {
	a.mu.Lock()
	a.got = append(a.got, r)
	a.mu.Unlock()
	return localruntime.Result{Status: localruntime.Delivered, EnvelopeID: r.Envelope.ID}
}
func (a *recordingAdapter) Presence(context.Context, localruntime.Target) localruntime.Presence {
	return localruntime.Online
}

// testConfig has two agentManager agents sharing telegram.main, slack.main
// for ops only, and one schedule for cloudbank.
func testConfig(t *testing.T) *configv2.Config {
	t.Helper()
	dir := t.TempDir()
	for _, ws := range []string{"cloudbank", "ops"} {
		if err := os.MkdirAll(filepath.Join(dir, ws), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	yaml := `version: 2
dataDir: ` + filepath.Join(dir, "data") + `
timezone: Asia/Shanghai
channels:
  telegram:
    main: {botToken: secret:telegram-main, default: cloudbank}
  slack:
    main: {botToken: secret:slack-bot, appToken: secret:slack-app}
agents:
  cloudbank:
    workspace: ` + filepath.Join(dir, "cloudbank") + `
    runtime: agentManager
    channels: [telegram.main]
  ops:
    workspace: ` + filepath.Join(dir, "ops") + `
    runtime: agentManager
    channels: [telegram.main, slack.main]
schedules:
  maxConcurrent: 1
  jobs:
    cloudbank-main:
      agent: cloudbank
      cron: "*/10 * * * *"
      prompt: secret heartbeat instruction
      backoff: {idle: "0 * * * *"}
      resetOnInbound: true
`
	p := configv2.HostPlatform()
	p.GOOS = "linux"
	cfg, err := configv2.Parse([]byte(yaml), p)
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func newTestServerWith(t *testing.T) (*Server, *recordingAdapter, error) {
	t.Helper()
	cfg := testConfig(t)
	adapter := &recordingAdapter{}
	rt := router.New(cfg, map[string]localruntime.Adapter{"agentManager": adapter})
	redactor := secrets.NewRedactor()
	redactor.Add("telegram-main", "123456:telegram-secret-value")
	server, err := NewServer(cfg, Options{Router: rt, Redactor: redactor})
	return server, adapter, err
}

func newTestServer(t *testing.T) (*Server, error) {
	server, _, err := newTestServerWith(t)
	return server, err
}

type fakeSendChannel struct {
	name       string
	running    bool
	lastChat   string
	lastText   string
	lastThread string
	lastImages []string
	sendErr    error
}

func (f *fakeSendChannel) Name() string { return f.name }

func (f *fakeSendChannel) Start(ctx context.Context) error {
	_ = ctx
	f.running = true
	return nil
}

func (f *fakeSendChannel) Stop(ctx context.Context) error {
	_ = ctx
	f.running = false
	return nil
}

func (f *fakeSendChannel) Send(ctx context.Context, msg channels.OutboundMessage) (*channels.SendResult, error) {
	_ = ctx
	f.lastChat = msg.To
	f.lastText = msg.Text
	f.lastThread = msg.ThreadTS
	f.lastImages = msg.Images
	if f.sendErr != nil {
		return nil, f.sendErr
	}
	return &channels.SendResult{ChannelID: msg.To}, nil
}

func (f *fakeSendChannel) IsRunning() bool { return f.running }

func (f *fakeSendChannel) IsAllowed(senderID string) bool { return true }

func TestStatusGroupsByAgent(t *testing.T) {
	server, _, err := newTestServerWith(t)
	if err != nil {
		t.Fatal(err)
	}
	server.startTime = time.Now().Add(-time.Second)
	fake := &fakeSendChannel{name: "telegram", running: true}
	if err := server.channels.Register(fake); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	server.handleStatus(rec, httptest.NewRequest(http.MethodGet, "/status", nil))
	var payload struct {
		Agents []struct {
			Name      string   `json:"name"`
			Runtime   string   `json:"runtime"`
			Channels  []string `json:"channels"`
			Presence  string   `json:"presence"`
			Schedules []struct {
				ID string `json:"id"`
			} `json:"schedules"`
		} `json:"agents"`
		Channels []struct {
			Ref     string   `json:"ref"`
			Agents  []string `json:"agents"`
			Default string   `json:"default"`
			Running bool     `json:"running"`
		} `json:"channels"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v\n%s", err, rec.Body.String())
	}
	if len(payload.Agents) != 2 || payload.Agents[0].Name != "cloudbank" || payload.Agents[0].Presence != "online" ||
		len(payload.Agents[0].Schedules) != 1 || payload.Agents[0].Schedules[0].ID != "cloudbank-main" || len(payload.Agents[1].Schedules) != 0 {
		t.Fatalf("agents: %+v", payload.Agents)
	}
	if len(payload.Channels) != 2 || payload.Channels[0].Ref != "telegram.main" || !payload.Channels[0].Running ||
		payload.Channels[0].Default != "cloudbank" || strings.Join(payload.Channels[0].Agents, ",") != "cloudbank,ops" {
		t.Fatalf("channels: %+v", payload.Channels)
	}
	if strings.Contains(rec.Body.String(), "secret heartbeat instruction") {
		t.Fatal("status leaked a schedule prompt")
	}
}

func TestHealthEndpointReturnsJSON(t *testing.T) {
	server, err := newTestServer(t)
	if err != nil {
		t.Fatal(err)
	}
	if err := server.channels.Register(&fakeSendChannel{name: "telegram", running: true}); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	server.handleHealth(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `{"name":"telegram","running":true}`) {
		t.Fatalf("health: %d %s", rec.Code, rec.Body.String())
	}
}

func TestMessageSendAPI(t *testing.T) {
	server, err := newTestServer(t)
	if err != nil {
		t.Fatal(err)
	}
	telegram := &fakeSendChannel{name: "telegram"}
	slack := &fakeSendChannel{name: "slack"}
	for _, ch := range []channels.Channel{telegram, slack} {
		if err := server.channels.Register(ch); err != nil {
			t.Fatal(err)
		}
	}
	send := func(body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		server.handleMessageSend(rec, httptest.NewRequest(http.MethodPost, "/api/v1/message/send", strings.NewReader(body)))
		return rec
	}
	if rec := send(`{"channel":"telegram","to":"1","text":"plain"}`); rec.Code != http.StatusOK || telegram.lastText != "plain" {
		t.Fatalf("plain: %d %s %q", rec.Code, rec.Body.String(), telegram.lastText)
	}
	// A shared channel names the sending agent; a dedicated one does not.
	if rec := send(`{"channel":"telegram","to":"1","text":"from ops","agent":"ops"}`); rec.Code != http.StatusOK || telegram.lastText != "[ops] from ops" {
		t.Fatalf("shared: %d %q", rec.Code, telegram.lastText)
	}
	if rec := send(`{"channel":"slack","to":"C1","text":"only ops here","agent":"ops"}`); rec.Code != http.StatusOK || slack.lastText != "only ops here" {
		t.Fatalf("dedicated: %d %q", rec.Code, slack.lastText)
	}
	if rec := send(`{"channel":"slack","to":"C1","text":"x","agent":"cloudbank"}`); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "does not use channel slack.main") {
		t.Fatalf("unbound agent: %d %s", rec.Code, rec.Body.String())
	}
	if rec := send(`{"channel":"telegram","to":"1"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("missing text: %d", rec.Code)
	}
	telegram.sendErr = &sendError{"GET https://api.telegram.org/bot123456:telegram-secret-value/sendMessage failed"}
	rec := send(`{"channel":"telegram","to":"1","text":"x"}`)
	if rec.Code != http.StatusBadGateway || strings.Contains(rec.Body.String(), "telegram-secret-value") {
		t.Fatalf("send error must be redacted: %d %s", rec.Code, rec.Body.String())
	}
}

type sendError struct{ msg string }

func (e *sendError) Error() string { return e.msg }

func TestInboundMessageRestoresTheAgentsSchedule(t *testing.T) {
	server, adapter, err := newTestServerWith(t)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := server.heartbeat.SetProfile("cloudbank-main", "idle", "no actionable tasks", "agent"); err != nil {
		t.Fatalf("SetProfile: %v", err)
	}
	inbound := func(text string) {
		if _, err := server.router.HandleIncoming(context.Background(), &protocol.Message{Data: map[string]interface{}{"channel": "telegram", "chat_id": "1", "text": text}}); err != nil {
			t.Fatal(err)
		}
	}
	inbound("@ops for ops")
	if job := server.heartbeat.Status().Jobs[0]; job.EffectiveProfile != "idle" {
		t.Fatalf("ops' message reset cloudbank's schedule: %#v", job)
	}
	inbound("for cloudbank")
	if job := server.heartbeat.Status().Jobs[0]; job.EffectiveProfile != "" || job.LastScheduleReason != "normal inbound activity" {
		t.Fatalf("cloudbank's message did not reset its schedule: %#v", job)
	}
	if len(adapter.got) != 2 {
		t.Fatalf("deliveries: %d", len(adapter.got))
	}
}

func TestScheduleConfigResolvesAgents(t *testing.T) {
	cfg := testConfig(t)
	sc := ScheduleConfig(cfg)
	if !sc.Enabled || sc.StatePath != cfg.Paths().Schedules() || len(sc.Jobs) != 1 {
		t.Fatalf("schedule config: %+v", sc)
	}
	if j := sc.Jobs[0]; j.Runtime != "agentManager" || j.Agent != "cloudbank" || j.Timezone != "Asia/Shanghai" || !j.ResetCronOnInbound || j.AgentCronProfiles["idle"] != "0 * * * *" {
		t.Fatalf("job: %+v", j)
	}
}

func TestHeartbeatCronAPIAndStatus(t *testing.T) {
	server, err := newTestServer(t)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/heartbeat/jobs/", server.handleHeartbeatCron)
	mux.HandleFunc("/status", server.handleStatus)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	request, err := http.NewRequest(http.MethodPut, ts.URL+"/api/v1/heartbeat/jobs/cloudbank-main/cron", strings.NewReader(`{"profile":"idle","reason":"no actionable tasks"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("set profile request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("set profile status=%d body=%s", response.StatusCode, body)
	}
	var setPayload heartbeatCronResponse
	if err := json.NewDecoder(response.Body).Decode(&setPayload); err != nil {
		t.Fatalf("decode set response: %v", err)
	}
	if setPayload.Job == nil || setPayload.Job.EffectiveProfile != "idle" || setPayload.Job.EffectiveCron != "0 * * * *" {
		t.Fatalf("unexpected set response: %#v", setPayload)
	}

	statusResponse, err := http.Get(ts.URL + "/status")
	if err != nil {
		t.Fatalf("status request: %v", err)
	}
	statusData, err := io.ReadAll(statusResponse.Body)
	statusResponse.Body.Close()
	if err != nil {
		t.Fatalf("read status: %v", err)
	}
	if !strings.Contains(string(statusData), `"effective_profile":"idle"`) || !strings.Contains(string(statusData), `"last_schedule_reason":"no actionable tasks"`) {
		t.Fatalf("status missing heartbeat profile: %s", statusData)
	}
	if strings.Contains(string(statusData), "secret heartbeat instruction") {
		t.Fatalf("status leaked heartbeat instruction: %s", statusData)
	}

	resetRequest, err := http.NewRequest(http.MethodDelete, ts.URL+"/api/v1/heartbeat/jobs/cloudbank-main/cron", nil)
	if err != nil {
		t.Fatal(err)
	}
	resetResponse, err := http.DefaultClient.Do(resetRequest)
	if err != nil {
		t.Fatalf("reset profile request: %v", err)
	}
	defer resetResponse.Body.Close()
	if resetResponse.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resetResponse.Body)
		t.Fatalf("reset profile status=%d body=%s", resetResponse.StatusCode, body)
	}
	var resetPayload heartbeatCronResponse
	if err := json.NewDecoder(resetResponse.Body).Decode(&resetPayload); err != nil {
		t.Fatalf("decode reset response: %v", err)
	}
	if resetPayload.Job == nil || resetPayload.Job.EffectiveProfile != "" || resetPayload.Job.EffectiveCron != "*/10 * * * *" {
		t.Fatalf("unexpected reset response: %#v", resetPayload)
	}
}

func TestHeartbeatCronAPIRejectsInvalidAndRemoteRequests(t *testing.T) {
	server, err := newTestServer(t)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}

	t.Run("invalid profile", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodPut, "/api/v1/heartbeat/jobs/cloudbank-main/cron", strings.NewReader(`{"profile":"arbitrary","reason":"idle"}`))
		request.RemoteAddr = "127.0.0.1:12345"
		response := httptest.NewRecorder()
		server.handleHeartbeatCron(response, request)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "not allowed") {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
	})

	t.Run("missing reason", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodPut, "/api/v1/heartbeat/jobs/cloudbank-main/cron", strings.NewReader(`{"profile":"idle"}`))
		request.RemoteAddr = "[::1]:12345"
		response := httptest.NewRecorder()
		server.handleHeartbeatCron(response, request)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "reason is required") {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
	})

	t.Run("remote client", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodPut, "/api/v1/heartbeat/jobs/cloudbank-main/cron", strings.NewReader(`{"profile":"idle","reason":"idle"}`))
		request.RemoteAddr = "203.0.113.20:4567"
		response := httptest.NewRecorder()
		server.handleHeartbeatCron(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
	})
}

func TestHeartbeatOutcomeAPIRejectsStaleInvalidAndRemoteRequests(t *testing.T) {
	server, err := newTestServer(t)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	send := func(method, path, body, remote string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.RemoteAddr = remote
		response := httptest.NewRecorder()
		server.handleHeartbeatJob(response, request)
		return response
	}
	const path = "/api/v1/heartbeat/jobs/cloudbank-main/outcome"

	// No run has been dispatched, so no run ID is the latest one.
	if response := send(http.MethodPost, path, `{"run_id":"run-1","result":"noop"}`, "127.0.0.1:1"); response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "not the latest run") {
		t.Fatalf("stale run: status=%d body=%s", response.Code, response.Body.String())
	}
	if response := send(http.MethodPost, path, `{"run_id":"run-1","result":"done"}`, "127.0.0.1:1"); response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "not one of") {
		t.Fatalf("invalid result: status=%d body=%s", response.Code, response.Body.String())
	}
	if response := send(http.MethodPost, "/api/v1/heartbeat/jobs/missing/outcome", `{"run_id":"run-1","result":"noop"}`, "127.0.0.1:1"); response.Code != http.StatusNotFound {
		t.Fatalf("missing job: status=%d body=%s", response.Code, response.Body.String())
	}
	if response := send(http.MethodPost, path, `{"run_id":"run-1","result":"noop","extra":1}`, "127.0.0.1:1"); response.Code != http.StatusBadRequest {
		t.Fatalf("unknown field: status=%d body=%s", response.Code, response.Body.String())
	}
	if response := send(http.MethodPut, path, `{}`, "127.0.0.1:1"); response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("wrong method: status=%d", response.Code)
	}
	if response := send(http.MethodPost, path, `{"run_id":"run-1","result":"noop"}`, "203.0.113.20:4567"); response.Code != http.StatusForbidden {
		t.Fatalf("remote client: status=%d", response.Code)
	}
	// The cron endpoint still routes through the same handler.
	if response := send(http.MethodPut, "/api/v1/heartbeat/jobs/cloudbank-main/cron", `{"profile":"idle","reason":"idle"}`, "127.0.0.1:1"); response.Code != http.StatusOK {
		t.Fatalf("cron via job handler: status=%d body=%s", response.Code, response.Body.String())
	}
}
