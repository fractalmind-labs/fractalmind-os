package coordinator

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-ai/fractalmind-envd/internal/agent"
	"github.com/fractalmind-ai/fractalmind-envd/internal/heartbeat"
	"github.com/fractalmind-ai/fractalmind-envd/internal/ws"
	"github.com/gorilla/websocket"
)

func TestCoordinatorListsRegisteredWorkers(t *testing.T) {
	server := NewServer(":0", time.Second, "")
	testServer := httptest.NewServer(server.Handler())
	defer testServer.Close()

	conn := dialTestWebSocket(t, testServer.URL)
	defer conn.Close()

	registerWorker(t, conn, "node-1", "worker-a", "1.2.3", heartbeat.Payload{
		HostID:    "node-1",
		Hostname:  "worker-a",
		Timestamp: time.Now(),
		Agents: []agent.Agent{
			{ID: "EMP_0001", Session: "EMP_0001", Status: "running"},
		},
		System: heartbeat.SystemInfo{
			OS:     "linux",
			Arch:   "amd64",
			NumCPU: 8,
		},
		Uptime: 42,
	})

	waitForSentinel(t, testServer.URL, "node-1", nil)

	body := httpGet(t, testServer.URL+"/api/sentinels")

	var raw struct {
		Sentinels []map[string]interface{} `json:"sentinels"`
		Count     int                      `json:"count"`
	}
	decodeJSON(t, body, &raw)

	if raw.Count != 1 {
		t.Fatalf("count = %d, want 1", raw.Count)
	}
	if len(raw.Sentinels) != 1 {
		t.Fatalf("len(sentinels) = %d, want 1", len(raw.Sentinels))
	}
	if _, ok := raw.Sentinels[0]["agent_count"]; !ok {
		t.Fatal("agent_count missing from sentinel summary")
	}
	if _, ok := raw.Sentinels[0]["agents"]; ok {
		t.Fatal("agents field should not be present in sentinel summary response")
	}

	var resp struct {
		Sentinels []sentinelSummary `json:"sentinels"`
		Count     int               `json:"count"`
	}
	decodeJSON(t, body, &resp)

	if resp.Sentinels[0].Hostname != "worker-a" {
		t.Fatalf("hostname = %q, want worker-a", resp.Sentinels[0].Hostname)
	}
	if resp.Sentinels[0].AgentCount != 1 {
		t.Fatalf("agent_count = %d, want 1", resp.Sentinels[0].AgentCount)
	}
	if resp.Sentinels[0].System == nil || resp.Sentinels[0].System.OS != "linux" {
		t.Fatalf("unexpected system payload: %+v", resp.Sentinels[0].System)
	}
}

func TestCoordinatorAdvertisesDesktopURL(t *testing.T) {
	server := NewServer(":0", time.Second, "")
	testServer := httptest.NewServer(server.Handler())
	defer testServer.Close()

	conn := dialTestWebSocket(t, testServer.URL)
	defer conn.Close()

	const want = "https://desk.example.com"
	registerWorkerWithDesktop(t, conn, "node-d", "worker-d", "dev", want, heartbeat.Payload{})
	waitForSentinel(t, testServer.URL, "node-d", nil)

	body := httpGet(t, testServer.URL+"/api/sentinels")
	var resp struct {
		Sentinels []sentinelSummary `json:"sentinels"`
	}
	decodeJSON(t, body, &resp)

	if len(resp.Sentinels) != 1 {
		t.Fatalf("len(sentinels) = %d, want 1", len(resp.Sentinels))
	}
	if resp.Sentinels[0].DesktopURL != want {
		t.Fatalf("desktop_url = %q, want %q", resp.Sentinels[0].DesktopURL, want)
	}
}

func TestCoordinatorDesktopSignalRelay(t *testing.T) {
	server := NewServer(":0", 2*time.Second, "")
	testServer := httptest.NewServer(server.Handler())
	defer testServer.Close()

	conn := dialTestWebSocket(t, testServer.URL)
	defer conn.Close()

	registerWorker(t, conn, "node-sig", "worker-sig", "dev", heartbeat.Payload{})

	// Worker side: answer one desktop_signal by echoing a canned SDP answer.
	done := make(chan struct{})
	go func() {
		defer close(done)
		var msg ws.Message
		if err := conn.ReadJSON(&msg); err != nil {
			t.Errorf("read desktop_signal: %v", err)
			return
		}
		if msg.Type != "desktop_signal" {
			t.Errorf("message type = %q, want desktop_signal", msg.Type)
			return
		}
		var sig ws.DesktopSignalPayload
		if err := json.Unmarshal(msg.Payload, &sig); err != nil {
			t.Errorf("decode desktop_signal: %v", err)
			return
		}
		if sig.Method != http.MethodPost || sig.Path != "/offer" {
			t.Errorf("got %s %s, want POST /offer", sig.Method, sig.Path)
		}
		sendWSMessage(t, conn, ws.Message{
			Type: "desktop_signal_result",
			Payload: mustRawJSON(desktopSignalResult{
				RequestID: sig.RequestID,
				Status:    http.StatusOK,
				Body:      json.RawMessage(`{"answer":"ok"}`),
			}),
		})
	}()

	waitForSentinel(t, testServer.URL, "node-sig", nil)

	status, body := httpPostRaw(t, testServer.URL+"/api/sentinels/node-sig/desktop/offer", []byte(`{"offer":"sdp"}`))
	<-done

	if status != http.StatusOK {
		t.Fatalf("relay status = %d, want 200 (body=%s)", status, body)
	}
	if !strings.Contains(string(body), `"answer":"ok"`) {
		t.Fatalf("relay body = %s, want answer echoed", body)
	}
}

func TestCoordinatorDesktopStatusRelay(t *testing.T) {
	server := NewServer(":0", 2*time.Second, "")
	testServer := httptest.NewServer(server.Handler())
	defer testServer.Close()

	conn := dialTestWebSocket(t, testServer.URL)
	defer conn.Close()

	registerWorker(t, conn, "node-status", "worker-status", "dev", heartbeat.Payload{})

	done := make(chan struct{})
	go func() {
		defer close(done)
		var msg ws.Message
		if err := conn.ReadJSON(&msg); err != nil {
			t.Errorf("read desktop_signal: %v", err)
			return
		}
		var sig ws.DesktopSignalPayload
		if err := json.Unmarshal(msg.Payload, &sig); err != nil {
			t.Errorf("decode desktop_signal: %v", err)
			return
		}
		if sig.Method != http.MethodGet || sig.Path != "/status" {
			t.Errorf("got %s %s, want GET /status", sig.Method, sig.Path)
		}
		sendWSMessage(t, conn, ws.Message{
			Type: "desktop_signal_result",
			Payload: mustRawJSON(desktopSignalResult{
				RequestID: sig.RequestID,
				Status:    http.StatusOK,
				Body:      json.RawMessage(`{"ok":true,"turn_enabled":true}`),
			}),
		})
	}()

	waitForSentinel(t, testServer.URL, "node-status", nil)
	body := httpGet(t, testServer.URL+"/api/sentinels/node-status/desktop/status")
	<-done
	if !strings.Contains(string(body), `"turn_enabled":true`) {
		t.Fatalf("status body = %s, want turn_enabled", body)
	}
}

func TestCoordinatorShellCommandProxy(t *testing.T) {
	server := NewServer(":0", 2*time.Second, "")
	testServer := httptest.NewServer(server.Handler())
	defer testServer.Close()

	conn := dialTestWebSocket(t, testServer.URL)
	defer conn.Close()

	registerWorker(t, conn, "node-2", "worker-b", "dev", heartbeat.Payload{})

	commandDone := make(chan struct{})
	go func() {
		defer close(commandDone)

		var msg ws.Message
		if err := conn.ReadJSON(&msg); err != nil {
			t.Errorf("read command: %v", err)
			return
		}
		if msg.Type != "command" {
			t.Errorf("message type = %q, want command", msg.Type)
			return
		}

		var payload ws.CommandPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			t.Errorf("decode command payload: %v", err)
			return
		}
		if payload.Command != "shell" {
			t.Errorf("command = %q, want shell", payload.Command)
			return
		}
		if payload.Args != "echo hello" {
			t.Errorf("args = %q, want echo hello", payload.Args)
			return
		}

		sendWSMessage(t, conn, ws.Message{
			Type: "command_result",
			Payload: mustRawJSON(commandResultPayload{
				RequestID: payload.RequestID,
				Result: map[string]interface{}{
					"success": true,
					"output":  "hello\n",
				},
			}),
		})
	}()

	waitForSentinel(t, testServer.URL, "node-2", nil)

	body := httpPostJSON(t, testServer.URL+"/api/sentinels/node-2/command", commandRequest{
		Command: "shell",
		Args:    "echo hello",
	})
	<-commandDone

	var resp struct {
		Success bool   `json:"success"`
		Output  string `json:"output"`
	}
	decodeJSON(t, body, &resp)

	if !resp.Success {
		t.Fatal("expected success=true")
	}
	if resp.Output != "hello\n" {
		t.Fatalf("output = %q, want hello\\n", resp.Output)
	}
}

func TestCoordinatorAPITokenAuthOnHealthAndSentinels(t *testing.T) {
	server := NewServer(":0", time.Second, "test-token")
	testServer := httptest.NewServer(server.Handler())
	defer testServer.Close()

	conn := dialTestWebSocket(t, testServer.URL)
	defer conn.Close()
	registerWorker(t, conn, "node-auth", "worker-auth", "dev", heartbeat.Payload{})

	status, _ := httpGetWithHeaders(t, testServer.URL+"/api/health", nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("GET /api/health without token status = %d, want %d", status, http.StatusUnauthorized)
	}

	status, _ = httpGetWithHeaders(t, testServer.URL+"/api/sentinels", map[string]string{
		"Authorization": "Bearer wrong-token",
	})
	if status != http.StatusUnauthorized {
		t.Fatalf("GET /api/sentinels with wrong token status = %d, want %d", status, http.StatusUnauthorized)
	}

	waitForSentinel(t, testServer.URL, "node-auth", map[string]string{
		"Authorization": "Bearer test-token",
	})

	status, body := httpGetWithHeaders(t, testServer.URL+"/api/sentinels", map[string]string{
		"Authorization": "Bearer test-token",
	})
	if status != http.StatusOK {
		t.Fatalf("GET /api/sentinels with token status = %d, want %d, body=%s", status, http.StatusOK, string(body))
	}

	var resp struct {
		Count int `json:"count"`
	}
	decodeJSON(t, body, &resp)
	if resp.Count != 1 {
		t.Fatalf("count = %d, want 1", resp.Count)
	}
}

func TestCoordinatorAPITokenAuthOnCommandEndpoint(t *testing.T) {
	server := NewServer(":0", 2*time.Second, "command-token")
	testServer := httptest.NewServer(server.Handler())
	defer testServer.Close()

	conn := dialTestWebSocket(t, testServer.URL)
	defer conn.Close()
	registerWorker(t, conn, "node-command", "worker-command", "dev", heartbeat.Payload{})

	status, _ := httpPostJSONWithHeaders(t, testServer.URL+"/api/sentinels/node-command/command", commandRequest{
		Command: "shell",
		Args:    "echo hello",
	}, nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("POST /api/sentinels/{id}/command without token status = %d, want %d", status, http.StatusUnauthorized)
	}

	commandDone := make(chan struct{})
	go func() {
		defer close(commandDone)

		var msg ws.Message
		if err := conn.ReadJSON(&msg); err != nil {
			t.Errorf("read command: %v", err)
			return
		}
		if msg.Type != "command" {
			t.Errorf("message type = %q, want command", msg.Type)
			return
		}

		var payload ws.CommandPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			t.Errorf("decode command payload: %v", err)
			return
		}

		sendWSMessage(t, conn, ws.Message{
			Type: "command_result",
			Payload: mustRawJSON(commandResultPayload{
				RequestID: payload.RequestID,
				Result: map[string]interface{}{
					"success": true,
					"output":  "ok\n",
				},
			}),
		})
	}()

	waitForSentinel(t, testServer.URL, "node-command", map[string]string{
		"Authorization": "Bearer command-token",
	})

	status, body := httpPostJSONWithHeaders(t, testServer.URL+"/api/sentinels/node-command/command", commandRequest{
		Command: "shell",
		Args:    "echo hello",
	}, map[string]string{
		"Authorization": "Bearer command-token",
	})
	if status != http.StatusOK {
		t.Fatalf("POST /api/sentinels/{id}/command with token status = %d, want %d, body=%s", status, http.StatusOK, string(body))
	}
	<-commandDone

	var resp struct {
		Success bool   `json:"success"`
		Output  string `json:"output"`
	}
	decodeJSON(t, body, &resp)
	if !resp.Success {
		t.Fatal("expected success=true")
	}
	if resp.Output != "ok\n" {
		t.Fatalf("output = %q, want ok\\n", resp.Output)
	}
}

func TestCoordinatorAPITokenUnsetKeepsCompatibility(t *testing.T) {
	server := NewServer(":0", time.Second, "")
	testServer := httptest.NewServer(server.Handler())
	defer testServer.Close()

	status, body := httpGetWithHeaders(t, testServer.URL+"/api/health", nil)
	if status != http.StatusOK {
		t.Fatalf("GET /api/health status = %d, want %d, body=%s", status, http.StatusOK, string(body))
	}
}

func waitForSentinel(t *testing.T, baseURL, id string, headers map[string]string) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		status, _ := httpGetWithHeaders(t, baseURL+"/api/sentinels/"+id, headers)
		if status == http.StatusOK {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("timeout waiting for sentinel %q to be registered", id)
}

func registerWorker(t *testing.T, conn *websocket.Conn, hostID, hostname, version string, hb heartbeat.Payload) {
	t.Helper()
	registerWorkerWithDesktop(t, conn, hostID, hostname, version, "", hb)
}

func registerWorkerWithDesktop(t *testing.T, conn *websocket.Conn, hostID, hostname, version, desktopURL string, hb heartbeat.Payload) {
	t.Helper()

	sendWSMessage(t, conn, ws.Message{
		Type: "register",
		Payload: mustRawJSON(registerPayload{
			HostID:     hostID,
			Hostname:   hostname,
			Version:    version,
			DesktopURL: desktopURL,
		}),
	})

	if hb.HostID == "" && hb.Hostname == "" && hb.Timestamp.IsZero() && hb.System == (heartbeat.SystemInfo{}) &&
		hb.Uptime == 0 && len(hb.Agents) == 0 && hb.RelayLoad == nil {
		return
	}

	sendWSMessage(t, conn, ws.Message{
		Type:    "heartbeat",
		Payload: mustRawJSON(hb),
	})
}

func dialTestWebSocket(t *testing.T, serverURL string) *websocket.Conn {
	t.Helper()

	wsURL := "ws" + strings.TrimPrefix(serverURL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	return conn
}

func sendWSMessage(t *testing.T, conn *websocket.Conn, msg ws.Message) {
	t.Helper()
	if err := conn.WriteJSON(msg); err != nil {
		t.Fatalf("write websocket message: %v", err)
	}
}

func httpGet(t *testing.T, url string) []byte {
	t.Helper()

	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("GET %s status = %d, body=%s", url, resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read GET response: %v", err)
	}
	return body
}

func httpPostJSON(t *testing.T, url string, payload interface{}) []byte {
	t.Helper()

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	resp, err := http.Post(url, "application/json", bytes.NewReader(data))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("POST %s status = %d, body=%s", url, resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read POST response: %v", err)
	}
	return body
}

func httpPostRaw(t *testing.T, url string, data []byte) (int, []byte) {
	t.Helper()

	resp, err := http.Post(url, "application/json", bytes.NewReader(data))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, body
}

func httpGetWithHeaders(t *testing.T, url string, headers map[string]string) (int, []byte) {
	t.Helper()

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("new GET request: %v", err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	return httpDo(t, req)
}

func httpPostJSONWithHeaders(t *testing.T, url string, payload interface{}, headers map[string]string) (int, []byte) {
	t.Helper()

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		t.Fatalf("new POST request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	return httpDo(t, req)
}

func httpDo(t *testing.T, req *http.Request) (int, []byte) {
	t.Helper()

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", req.Method, req.URL, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read response body: %v", err)
	}

	return resp.StatusCode, body
}

func decodeJSON(t *testing.T, body []byte, out interface{}) {
	t.Helper()
	if err := json.Unmarshal(body, out); err != nil {
		t.Fatalf("decode JSON: %v", err)
	}
}
