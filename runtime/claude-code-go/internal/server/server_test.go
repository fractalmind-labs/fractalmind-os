package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestRunServerDefaults(t *testing.T) {
	result, err := Run(nil)
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if result.Status != "stub" || result.Action != "start-server" || result.Transport != "http" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Host != "0.0.0.0" || result.Port != 0 || result.IdleTimeoutMs != 600000 || result.MaxSessions != 32 {
		t.Fatalf("unexpected defaults: %#v", result)
	}
	if result.AuthTokenSource != "generated" || !strings.HasPrefix(result.AuthToken, "sk-ant-cc-") {
		t.Fatalf("expected generated auth token, got %#v", result)
	}
	if result.LockfilePath == "" {
		t.Fatalf("expected lockfile path, got %#v", result)
	}
	if result.SessionIndexPath == "" {
		t.Fatalf("expected session index path, got %#v", result)
	}
	output := result.String()
	for _, needle := range []string{
		"status=stub",
		"action=start-server",
		"transport=http",
		"host=0.0.0.0",
		"port=0",
		"idle_timeout_ms=600000",
		"max_sessions=32",
		"auth_token_source=generated",
		"sessions_endpoint=none",
		"lockfile_path=",
		"session_index_path=",
	} {
		if !strings.Contains(output, needle) {
			t.Fatalf("expected output to contain %q, got:\n%s", needle, output)
		}
	}
}

func TestRunServerAcceptsExplicitOptions(t *testing.T) {
	result, err := Run([]string{
		"--port", "7777",
		"--host", "127.0.0.1",
		"--auth-token", "demo-token",
		"--workspace", "/tmp/workspace",
		"--idle-timeout", "0",
		"--max-sessions", "8",
	})
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if result.Host != "127.0.0.1" || result.Port != 7777 || result.AuthToken != "demo-token" || result.AuthTokenSource != "provided" {
		t.Fatalf("unexpected explicit result: %#v", result)
	}
	if result.Workspace != "/tmp/workspace" || result.IdleTimeoutMs != 0 || result.MaxSessions != 8 {
		t.Fatalf("unexpected explicit config: %#v", result)
	}
}

func TestRunServerSupportsUnixTransport(t *testing.T) {
	result, err := Run([]string{"--unix", "/tmp/claude.sock"})
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if result.Transport != "unix" || result.Unix != "/tmp/claude.sock" {
		t.Fatalf("unexpected unix result: %#v", result)
	}
	if !strings.Contains(result.String(), "unix=/tmp/claude.sock") {
		t.Fatalf("expected unix path in output, got:\n%s", result.String())
	}
}

func TestStartHTTPServerRespondsToSessions(t *testing.T) {
	lockfile := filepath.Join(t.TempDir(), "server.lock.json")
	sessionIndex := filepath.Join(t.TempDir(), "session-index.json")
	t.Setenv("CLAUDE_CODE_GO_SERVER_LOCKFILE", lockfile)
	t.Setenv("CLAUDE_CODE_GO_SERVER_SESSION_INDEX", sessionIndex)
	running, err := Start([]string{"--host", "127.0.0.1", "--port", "0", "--auth-token", "demo-token", "--workspace", "/tmp/workspace"})
	if err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	defer func() {
		if err := running.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	}()

	body := bytes.NewBufferString(`{"cwd":"/tmp/requested"}`)
	req, err := http.NewRequest(http.MethodPost, running.Result.SessionsEndpoint, body)
	if err != nil {
		t.Fatalf("NewRequest returned error: %v", err)
	}
	req.Header.Set("Authorization", "Bearer demo-token")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do returned error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK, got %s", resp.Status)
	}

	var parsed map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		t.Fatalf("Decode returned error: %v", err)
	}
	if parsed["session_id"] == "" || parsed["ws_url"] == "" || parsed["work_dir"] != "/tmp/requested" {
		t.Fatalf("unexpected response: %#v", parsed)
	}

	ws, _, err := websocket.DefaultDialer.Dial(parsed["ws_url"], http.Header{
		"Authorization": []string{"Bearer demo-token"},
	})
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}
	defer ws.Close()

	var ready map[string]any
	if err := ws.ReadJSON(&ready); err != nil {
		t.Fatalf("read ready event failed: %v", err)
	}
	state := fetchSessionState(t, running.Result.SessionsEndpoint, parsed["session_id"], "demo-token")
	if state.BackendStatus != "running" || state.BackendPID <= 0 {
		t.Fatalf("expected live backend after websocket attach, got %#v", state)
	}
	if ready["type"] != "session_ready" {
		t.Fatalf("unexpected ready event: %#v", ready)
	}
	var initEvent map[string]any
	if err := ws.ReadJSON(&initEvent); err != nil {
		t.Fatalf("read init event failed: %v", err)
	}
	if initEvent["type"] != "system" || strings.TrimSpace(asString(initEvent["subtype"])) != "init" {
		t.Fatalf("unexpected init event: %#v", initEvent)
	}
	var authEvent map[string]any
	if err := ws.ReadJSON(&authEvent); err != nil {
		t.Fatalf("read auth event failed: %v", err)
	}
	if authEvent["type"] != "auth_status" || authEvent["isAuthenticating"] != false {
		t.Fatalf("unexpected auth event: %#v", authEvent)
	}
	authOutput, _ := authEvent["output"].([]any)
	if len(authOutput) == 0 || strings.TrimSpace(asString(authOutput[0])) != "oauth" {
		t.Fatalf("unexpected auth event payload: %#v", authEvent)
	}
	var statusEvent map[string]any
	if err := ws.ReadJSON(&statusEvent); err != nil {
		t.Fatalf("read status event failed: %v", err)
	}
	if statusEvent["type"] != "system" || strings.TrimSpace(asString(statusEvent["subtype"])) != "status" || strings.TrimSpace(asString(statusEvent["permissionMode"])) != "default" {
		t.Fatalf("unexpected status event: %#v", statusEvent)
	}
	var keepAlive map[string]any
	if err := ws.ReadJSON(&keepAlive); err != nil {
		t.Fatalf("read keep_alive failed: %v", err)
	}
	if keepAlive["type"] != "keep_alive" {
		t.Fatalf("unexpected keep_alive event: %#v", keepAlive)
	}
	if err := ws.WriteJSON(map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": []map[string]any{{"type": "text", "text": "hello"}},
		},
	}); err != nil {
		t.Fatalf("write user message failed: %v", err)
	}

	var controlReq map[string]any
	if err := ws.ReadJSON(&controlReq); err != nil {
		t.Fatalf("read control request failed: %v", err)
	}
	if controlReq["type"] != "control_request" {
		t.Fatalf("unexpected control request: %#v", controlReq)
	}
	request, _ := controlReq["request"].(map[string]any)
	if strings.TrimSpace(asString(request["subtype"])) != "can_use_tool" || strings.TrimSpace(asString(request["tool_name"])) != directConnectEchoToolName {
		t.Fatalf("unexpected permission request payload: %#v", controlReq)
	}
	input, _ := request["input"].(map[string]any)
	if strings.TrimSpace(asString(input["text"])) != "hello" || strings.TrimSpace(asString(request["tool_use_id"])) == "" {
		t.Fatalf("unexpected permission request payload: %#v", controlReq)
	}
	requestID := controlReq["request_id"].(string)
	if err := ws.WriteJSON(map[string]any{
		"type": "control_response",
		"response": map[string]any{
			"subtype":    "success",
			"request_id": requestID,
			"response": map[string]any{
				"behavior": "allow",
				"updatedInput": map[string]any{
					"text": "hello [approved]",
				},
			},
		},
	}); err != nil {
		t.Fatalf("write control response failed: %v", err)
	}
	var controlCancel map[string]any
	if err := ws.ReadJSON(&controlCancel); err != nil {
		t.Fatalf("read control cancel failed: %v", err)
	}
	if controlCancel["type"] != "control_cancel_request" || strings.TrimSpace(asString(controlCancel["request_id"])) != requestID {
		t.Fatalf("unexpected control cancel event: %#v", controlCancel)
	}

	var toolProgress map[string]any
	if err := ws.ReadJSON(&toolProgress); err != nil {
		t.Fatalf("read tool progress failed: %v", err)
	}
	if toolProgress["type"] != "tool_progress" || strings.TrimSpace(asString(toolProgress["tool_name"])) != directConnectEchoToolName || strings.TrimSpace(asString(toolProgress["tool_use_id"])) != strings.TrimSpace(asString(request["tool_use_id"])) {
		t.Fatalf("unexpected tool progress event: %#v", toolProgress)
	}
	var rateLimitEvent map[string]any
	if err := ws.ReadJSON(&rateLimitEvent); err != nil {
		t.Fatalf("read rate_limit_event failed: %v", err)
	}
	if rateLimitEvent["type"] != "rate_limit_event" || strings.TrimSpace(asString(rateLimitEvent["bucket"])) != "default" || int(rateLimitEvent["limit"].(float64)) != 100 || int(rateLimitEvent["remaining"].(float64)) != 99 {
		t.Fatalf("unexpected rate_limit_event payload: %#v", rateLimitEvent)
	}
	var streamEvent map[string]any
	if err := ws.ReadJSON(&streamEvent); err != nil {
		t.Fatalf("read stream event failed: %v", err)
	}
	if streamEvent["type"] != "stream_event" {
		t.Fatalf("unexpected stream event envelope: %#v", streamEvent)
	}
	streamPayload, _ := streamEvent["event"].(map[string]any)
	streamDelta, _ := streamPayload["delta"].(map[string]any)
	if strings.TrimSpace(asString(streamPayload["type"])) != "content_block_delta" || strings.TrimSpace(asString(streamDelta["type"])) != "text_delta" || strings.TrimSpace(asString(streamDelta["text"])) != "echo:hello [approved]" {
		t.Fatalf("unexpected stream event payload: %#v", streamEvent)
	}
	var assistant map[string]any
	if err := ws.ReadJSON(&assistant); err != nil {
		t.Fatalf("read assistant event failed: %v", err)
	}
	if assistant["type"] != "assistant" {
		t.Fatalf("unexpected assistant event: %#v", assistant)
	}
	message, _ := assistant["message"].(map[string]any)
	content, _ := message["content"].([]any)
	if len(content) == 0 || strings.TrimSpace(asString(content[0].(map[string]any)["text"])) != "echo:hello [approved]" {
		t.Fatalf("unexpected assistant payload: %#v", assistant)
	}
	var toolSummary map[string]any
	if err := ws.ReadJSON(&toolSummary); err != nil {
		t.Fatalf("read tool summary failed: %v", err)
	}
	if toolSummary["type"] != "tool_use_summary" || strings.TrimSpace(asString(toolSummary["tool_name"])) != directConnectEchoToolName || strings.TrimSpace(asString(toolSummary["tool_use_id"])) != strings.TrimSpace(asString(request["tool_use_id"])) || strings.TrimSpace(asString(toolSummary["output_preview"])) != "echo:hello [approved]" {
		t.Fatalf("unexpected tool summary payload: %#v", toolSummary)
	}
	var result map[string]any
	if err := ws.ReadJSON(&result); err != nil {
		t.Fatalf("read result event failed: %v", err)
	}
	if result["type"] != "result" || strings.TrimSpace(asString(result["subtype"])) != "success" || strings.TrimSpace(asString(result["result"])) != "echo:hello [approved]" {
		t.Fatalf("unexpected result event: %#v", result)
	}

	if err := ws.WriteJSON(map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": []map[string]any{{"type": "text", "text": "hello again"}},
		},
	}); err != nil {
		t.Fatalf("write second user message failed: %v", err)
	}

	var secondControlReq map[string]any
	if err := ws.ReadJSON(&secondControlReq); err != nil {
		t.Fatalf("read second control request failed: %v", err)
	}
	if secondControlReq["type"] != "control_request" {
		t.Fatalf("unexpected second control request: %#v", secondControlReq)
	}
	secondRequest, _ := secondControlReq["request"].(map[string]any)
	secondInput, _ := secondRequest["input"].(map[string]any)
	if strings.TrimSpace(asString(secondInput["text"])) != "hello again" {
		t.Fatalf("unexpected second permission request payload: %#v", secondControlReq)
	}
	secondRequestID := secondControlReq["request_id"].(string)
	if err := ws.WriteJSON(map[string]any{
		"type": "control_response",
		"response": map[string]any{
			"subtype":    "success",
			"request_id": secondRequestID,
			"response": map[string]any{
				"behavior": "allow",
				"updatedInput": map[string]any{
					"text": "hello again [approved]",
				},
			},
		},
	}); err != nil {
		t.Fatalf("write second control response failed: %v", err)
	}
	var secondControlCancel map[string]any
	if err := ws.ReadJSON(&secondControlCancel); err != nil {
		t.Fatalf("read second control cancel failed: %v", err)
	}
	if secondControlCancel["type"] != "control_cancel_request" || strings.TrimSpace(asString(secondControlCancel["request_id"])) != secondRequestID {
		t.Fatalf("unexpected second control cancel event: %#v", secondControlCancel)
	}

	var secondToolProgress map[string]any
	if err := ws.ReadJSON(&secondToolProgress); err != nil {
		t.Fatalf("read second tool progress failed: %v", err)
	}
	if secondToolProgress["type"] != "tool_progress" || strings.TrimSpace(asString(secondToolProgress["tool_name"])) != directConnectEchoToolName || strings.TrimSpace(asString(secondToolProgress["tool_use_id"])) != strings.TrimSpace(asString(secondRequest["tool_use_id"])) {
		t.Fatalf("unexpected second tool progress event: %#v", secondToolProgress)
	}
	var secondRateLimitEvent map[string]any
	if err := ws.ReadJSON(&secondRateLimitEvent); err != nil {
		t.Fatalf("read second rate_limit_event failed: %v", err)
	}
	if secondRateLimitEvent["type"] != "rate_limit_event" || strings.TrimSpace(asString(secondRateLimitEvent["bucket"])) != "default" || int(secondRateLimitEvent["limit"].(float64)) != 100 || int(secondRateLimitEvent["remaining"].(float64)) != 99 {
		t.Fatalf("unexpected second rate_limit_event payload: %#v", secondRateLimitEvent)
	}
	var secondStreamEvent map[string]any
	if err := ws.ReadJSON(&secondStreamEvent); err != nil {
		t.Fatalf("read second stream event failed: %v", err)
	}
	if secondStreamEvent["type"] != "stream_event" {
		t.Fatalf("unexpected second stream event envelope: %#v", secondStreamEvent)
	}
	secondStreamPayload, _ := secondStreamEvent["event"].(map[string]any)
	secondStreamDelta, _ := secondStreamPayload["delta"].(map[string]any)
	if strings.TrimSpace(asString(secondStreamPayload["type"])) != "content_block_delta" || strings.TrimSpace(asString(secondStreamDelta["type"])) != "text_delta" || strings.TrimSpace(asString(secondStreamDelta["text"])) != "echo:hello again [approved]" {
		t.Fatalf("unexpected second stream event payload: %#v", secondStreamEvent)
	}
	var secondAssistant map[string]any
	if err := ws.ReadJSON(&secondAssistant); err != nil {
		t.Fatalf("read second assistant event failed: %v", err)
	}
	if secondAssistant["type"] != "assistant" {
		t.Fatalf("unexpected second assistant event: %#v", secondAssistant)
	}
	secondMessage, _ := secondAssistant["message"].(map[string]any)
	secondContent, _ := secondMessage["content"].([]any)
	if len(secondContent) == 0 || strings.TrimSpace(asString(secondContent[0].(map[string]any)["text"])) != "echo:hello again [approved]" {
		t.Fatalf("unexpected second assistant payload: %#v", secondAssistant)
	}
	var secondToolSummary map[string]any
	if err := ws.ReadJSON(&secondToolSummary); err != nil {
		t.Fatalf("read second tool summary failed: %v", err)
	}
	if secondToolSummary["type"] != "tool_use_summary" || strings.TrimSpace(asString(secondToolSummary["tool_name"])) != directConnectEchoToolName || strings.TrimSpace(asString(secondToolSummary["tool_use_id"])) != strings.TrimSpace(asString(secondRequest["tool_use_id"])) || strings.TrimSpace(asString(secondToolSummary["output_preview"])) != "echo:hello again [approved]" {
		t.Fatalf("unexpected second tool summary payload: %#v", secondToolSummary)
	}
	var secondResult map[string]any
	if err := ws.ReadJSON(&secondResult); err != nil {
		t.Fatalf("read second result event failed: %v", err)
	}
	if secondResult["type"] != "result" || strings.TrimSpace(asString(secondResult["subtype"])) != "success" || strings.TrimSpace(asString(secondResult["result"])) != "echo:hello again [approved]" {
		t.Fatalf("unexpected second result event: %#v", secondResult)
	}

	if err := ws.WriteJSON(map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": []map[string]any{{"type": "text", "text": "deny this turn"}},
		},
	}); err != nil {
		t.Fatalf("write deny-turn user message failed: %v", err)
	}

	var denyControlReq map[string]any
	if err := ws.ReadJSON(&denyControlReq); err != nil {
		t.Fatalf("read deny control request failed: %v", err)
	}
	if denyControlReq["type"] != "control_request" {
		t.Fatalf("unexpected deny control request: %#v", denyControlReq)
	}
	denyRequest, _ := denyControlReq["request"].(map[string]any)
	denyInput, _ := denyRequest["input"].(map[string]any)
	if strings.TrimSpace(asString(denyInput["text"])) != "deny this turn" {
		t.Fatalf("unexpected deny control payload: %#v", denyControlReq)
	}
	denyRequestID := denyControlReq["request_id"].(string)
	denyToolUseID := strings.TrimSpace(asString(denyRequest["tool_use_id"]))
	if err := ws.WriteJSON(map[string]any{
		"type": "control_response",
		"response": map[string]any{
			"subtype":    "success",
			"request_id": denyRequestID,
			"response": map[string]any{
				"behavior": "deny",
			},
		},
	}); err != nil {
		t.Fatalf("write deny control response failed: %v", err)
	}

	var denyResult map[string]any
	if err := ws.ReadJSON(&denyResult); err != nil {
		t.Fatalf("read deny result event failed: %v", err)
	}
	if denyResult["type"] != "result" || strings.TrimSpace(asString(denyResult["subtype"])) != "error_during_execution" {
		t.Fatalf("unexpected deny result event: %#v", denyResult)
	}
	if isError, ok := denyResult["is_error"].(bool); !ok || !isError {
		t.Fatalf("expected deny result is_error=true, got %#v", denyResult)
	}
	if int(denyResult["num_turns"].(float64)) != 2 {
		t.Fatalf("expected deny result num_turns=2, got %#v", denyResult)
	}
	permissionDenials, _ := denyResult["permission_denials"].([]any)
	if len(permissionDenials) != 1 {
		t.Fatalf("expected single permission denial, got %#v", denyResult)
	}
	denial, _ := permissionDenials[0].(map[string]any)
	if strings.TrimSpace(asString(denial["tool_name"])) != directConnectEchoToolName || strings.TrimSpace(asString(denial["tool_use_id"])) != denyToolUseID {
		t.Fatalf("unexpected permission denial payload: %#v", denyResult)
	}
	toolInput, _ := denial["tool_input"].(map[string]any)
	if strings.TrimSpace(asString(toolInput["text"])) != "deny this turn" {
		t.Fatalf("unexpected deny tool_input payload: %#v", denyResult)
	}
	errorsList, _ := denyResult["errors"].([]any)
	if len(errorsList) == 0 || !strings.Contains(strings.TrimSpace(asString(errorsList[0])), "permission denied") {
		t.Fatalf("unexpected deny errors payload: %#v", denyResult)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "interrupt-1",
		"request": map[string]any{
			"subtype": "interrupt",
		},
	}); err != nil {
		t.Fatalf("write interrupt request failed: %v", err)
	}
	var interruptResp map[string]any
	if err := ws.ReadJSON(&interruptResp); err != nil {
		t.Fatalf("read interrupt response failed: %v", err)
	}
	if interruptResp["type"] != "control_response" {
		t.Fatalf("unexpected interrupt response: %#v", interruptResp)
	}
}

func TestStartUnixServerRespondsToSessions(t *testing.T) {
	tempDir := t.TempDir()
	lockfile := filepath.Join(tempDir, "server.lock.json")
	sessionIndex := filepath.Join(tempDir, "session-index.json")
	socketPath := filepath.Join("/tmp", fmt.Sprintf("claude-server-test-%d.sock", time.Now().UnixNano()))
	t.Setenv("CLAUDE_CODE_GO_SERVER_LOCKFILE", lockfile)
	t.Setenv("CLAUDE_CODE_GO_SERVER_SESSION_INDEX", sessionIndex)
	t.Cleanup(func() { _ = os.Remove(socketPath) })
	running, err := Start([]string{"--unix", socketPath, "--auth-token", "demo-token"})
	if err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	defer func() {
		if err := running.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	}()

	client := &http.Client{
		Transport: &http.Transport{
			DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
		},
	}
	req, err := http.NewRequest(http.MethodPost, "http://unix/sessions", bytes.NewBufferString(`{"cwd":"/tmp/requested"}`))
	if err != nil {
		t.Fatalf("NewRequest returned error: %v", err)
	}
	req.Header.Set("Authorization", "Bearer demo-token")
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("Do returned error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK, got %s", resp.Status)
	}
}

func TestStartWritesAndRemovesLockfile(t *testing.T) {
	lockfile := filepath.Join(t.TempDir(), "server.lock.json")
	t.Setenv("CLAUDE_CODE_GO_SERVER_LOCKFILE", lockfile)
	t.Setenv("CLAUDE_CODE_GO_SERVER_SESSION_INDEX", filepath.Join(t.TempDir(), "sessions.json"))
	t.Setenv("CLAUDE_CODE_GO_SERVER_STARTED_AT", "2026-04-06T00:00:00Z")
	t.Setenv("CLAUDE_CODE_GO_SERVER_PID_OVERRIDE", "54321")

	running, err := Start([]string{"--host", "127.0.0.1", "--port", "0", "--auth-token", "demo-token"})
	if err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	data, err := os.ReadFile(lockfile)
	if err != nil {
		t.Fatalf("expected lockfile to exist: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("parse lockfile: %v", err)
	}
	if parsed["pid"] != float64(54321) {
		t.Fatalf("unexpected lockfile pid: %#v", parsed)
	}

	if err := running.Close(); err != nil {
		t.Fatalf("Close returned error: %v", err)
	}
	if _, err := os.Stat(lockfile); !os.IsNotExist(err) {
		t.Fatalf("expected lockfile removed, got err=%v", err)
	}
}

func TestStartRejectsExistingLiveLockfile(t *testing.T) {
	lockfile := filepath.Join(t.TempDir(), "server.lock.json")
	t.Setenv("CLAUDE_CODE_GO_SERVER_LOCKFILE", lockfile)
	t.Setenv("CLAUDE_CODE_GO_SERVER_SESSION_INDEX", filepath.Join(t.TempDir(), "sessions.json"))
	if err := writeServerLock(lockfile, lockInfo{
		PID:     os.Getpid(),
		HTTPURL: "http://127.0.0.1:9999/sessions",
	}); err != nil {
		t.Fatalf("writeServerLock: %v", err)
	}

	_, err := Start([]string{"--host", "127.0.0.1", "--port", "0", "--auth-token", "demo-token"})
	if err == nil || !strings.Contains(err.Error(), "server already running") {
		t.Fatalf("expected live lockfile error, got %v", err)
	}
}

func TestCreateSessionPersistsSessionIndex(t *testing.T) {
	lockfile := filepath.Join(t.TempDir(), "server.lock.json")
	sessionIndex := filepath.Join(t.TempDir(), "sessions.json")
	t.Setenv("CLAUDE_CODE_GO_SERVER_LOCKFILE", lockfile)
	t.Setenv("CLAUDE_CODE_GO_SERVER_SESSION_INDEX", sessionIndex)

	running, err := Start([]string{"--host", "127.0.0.1", "--port", "0", "--auth-token", "demo-token", "--workspace", "/tmp/workspace"})
	if err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	defer func() {
		if err := running.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	}()

	req, err := http.NewRequest(http.MethodPost, running.Result.SessionsEndpoint, bytes.NewBufferString(`{"cwd":"/tmp/requested"}`))
	if err != nil {
		t.Fatalf("NewRequest returned error: %v", err)
	}
	req.Header.Set("Authorization", "Bearer demo-token")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do returned error: %v", err)
	}
	defer resp.Body.Close()
	var parsed map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		t.Fatalf("decode session response: %v", err)
	}

	data, err := os.ReadFile(sessionIndex)
	if err != nil {
		t.Fatalf("expected session index file: %v", err)
	}
	var index map[string]map[string]any
	if err := json.Unmarshal(data, &index); err != nil {
		t.Fatalf("parse session index: %v", err)
	}
	entry, ok := index[parsed["session_id"]]
	if !ok {
		t.Fatalf("expected session entry in index: %#v", index)
	}
	if entry["cwd"] != "/tmp/requested" || entry["sessionId"] != parsed["session_id"] || entry["transcriptSessionId"] != parsed["session_id"] {
		t.Fatalf("unexpected session index entry: %#v", entry)
	}
	if entry["status"] != "starting" {
		t.Fatalf("expected starting status, got %#v", entry)
	}
}

func TestCreateSessionHonorsMaxSessionsGuard(t *testing.T) {
	lockfile := filepath.Join(t.TempDir(), "server.lock.json")
	sessionIndex := filepath.Join(t.TempDir(), "sessions.json")
	t.Setenv("CLAUDE_CODE_GO_SERVER_LOCKFILE", lockfile)
	t.Setenv("CLAUDE_CODE_GO_SERVER_SESSION_INDEX", sessionIndex)

	running, err := Start([]string{
		"--host", "127.0.0.1",
		"--port", "0",
		"--auth-token", "demo-token",
		"--max-sessions", "2",
	})
	if err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	defer func() {
		if err := running.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	}()

	createSession := func(cwd string) *http.Response {
		t.Helper()
		req, err := http.NewRequest(http.MethodPost, running.Result.SessionsEndpoint, bytes.NewBufferString(fmt.Sprintf(`{"cwd":%q}`, cwd)))
		if err != nil {
			t.Fatalf("NewRequest returned error: %v", err)
		}
		req.Header.Set("Authorization", "Bearer demo-token")
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("Do returned error: %v", err)
		}
		return resp
	}

	resp1 := createSession("/tmp/session-1")
	defer resp1.Body.Close()
	if resp1.StatusCode != http.StatusOK {
		t.Fatalf("expected first session create to succeed, got %s", resp1.Status)
	}
	var first map[string]string
	if err := json.NewDecoder(resp1.Body).Decode(&first); err != nil {
		t.Fatalf("decode first session response: %v", err)
	}

	resp2 := createSession("/tmp/session-2")
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("expected second session create to succeed, got %s", resp2.Status)
	}

	resp3 := createSession("/tmp/session-3")
	defer resp3.Body.Close()
	if resp3.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("expected third session create to fail with 429, got %s", resp3.Status)
	}
	body, err := io.ReadAll(resp3.Body)
	if err != nil {
		t.Fatalf("read third response body: %v", err)
	}
	if !strings.Contains(string(body), "max sessions reached (2/2)") {
		t.Fatalf("unexpected guard body: %q", string(body))
	}

	resumeReq, err := http.NewRequest(http.MethodGet, running.Result.SessionsEndpoint+"?resume="+first["session_id"], nil)
	if err != nil {
		t.Fatalf("NewRequest resume returned error: %v", err)
	}
	resumeReq.Header.Set("Authorization", "Bearer demo-token")
	resumeResp, err := http.DefaultClient.Do(resumeReq)
	if err != nil {
		t.Fatalf("Do resume returned error: %v", err)
	}
	defer resumeResp.Body.Close()
	if resumeResp.StatusCode != http.StatusOK {
		t.Fatalf("expected resume for existing session to bypass cap, got %s", resumeResp.Status)
	}
}

func TestSessionInspectEndpointReportsLifecycle(t *testing.T) {
	lockfile := filepath.Join(t.TempDir(), "server.lock.json")
	sessionIndex := filepath.Join(t.TempDir(), "sessions.json")
	t.Setenv("CLAUDE_CODE_GO_SERVER_LOCKFILE", lockfile)
	t.Setenv("CLAUDE_CODE_GO_SERVER_SESSION_INDEX", sessionIndex)

	running, err := Start([]string{"--host", "127.0.0.1", "--port", "0", "--auth-token", "demo-token"})
	if err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	defer func() {
		if err := running.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	}()

	req, err := http.NewRequest(http.MethodPost, running.Result.SessionsEndpoint, bytes.NewBufferString(`{"cwd":"/tmp/lifecycle-work"}`))
	if err != nil {
		t.Fatalf("NewRequest returned error: %v", err)
	}
	req.Header.Set("Authorization", "Bearer demo-token")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create session failed: %v", err)
	}
	defer resp.Body.Close()
	var created map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}

	state := fetchSessionState(t, running.Result.SessionsEndpoint, created["session_id"], "demo-token")
	if state.Status != "starting" || state.WorkDir != "/tmp/lifecycle-work" {
		t.Fatalf("unexpected starting state: %#v", state)
	}

	ws, _, err := websocket.DefaultDialer.Dial(created["ws_url"], http.Header{
		"Authorization": []string{"Bearer demo-token"},
	})
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}
	var ready map[string]any
	if err := ws.ReadJSON(&ready); err != nil {
		t.Fatalf("read ready event failed: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		state = fetchSessionState(t, running.Result.SessionsEndpoint, created["session_id"], "demo-token")
		if state.Status == "running" && state.BackendStatus == "running" && state.BackendPID > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected running state, got %#v", state)
		}
		time.Sleep(20 * time.Millisecond)
	}

	_ = ws.Close()

	deadline = time.Now().Add(2 * time.Second)
	for {
		state = fetchSessionState(t, running.Result.SessionsEndpoint, created["session_id"], "demo-token")
		if state.Status == "detached" && state.BackendStatus == "running" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected detached state, got %#v", state)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestResumeSessionFromPersistedSessionIndex(t *testing.T) {
	lockfile := filepath.Join(t.TempDir(), "server.lock.json")
	sessionIndex := filepath.Join(t.TempDir(), "sessions.json")
	t.Setenv("CLAUDE_CODE_GO_SERVER_LOCKFILE", lockfile)
	t.Setenv("CLAUDE_CODE_GO_SERVER_SESSION_INDEX", sessionIndex)

	running, err := Start([]string{"--host", "127.0.0.1", "--port", "0", "--auth-token", "demo-token"})
	if err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	req, err := http.NewRequest(http.MethodPost, running.Result.SessionsEndpoint, bytes.NewBufferString(`{"cwd":"/tmp/resume-work"}`))
	if err != nil {
		t.Fatalf("NewRequest returned error: %v", err)
	}
	req.Header.Set("Authorization", "Bearer demo-token")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create session failed: %v", err)
	}
	defer resp.Body.Close()
	var created map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("decode create session response: %v", err)
	}
	if err := running.Close(); err != nil {
		t.Fatalf("Close returned error: %v", err)
	}

	running, err = Start([]string{"--host", "127.0.0.1", "--port", "0", "--auth-token", "demo-token"})
	if err != nil {
		t.Fatalf("restart Start returned error: %v", err)
	}
	defer func() {
		if err := running.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	}()

	req, err = http.NewRequest(http.MethodGet, running.Result.SessionsEndpoint+"?resume="+created["session_id"], nil)
	if err != nil {
		t.Fatalf("resume request build failed: %v", err)
	}
	req.Header.Set("Authorization", "Bearer demo-token")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("resume session failed: %v", err)
	}
	defer resp.Body.Close()
	var resumed map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&resumed); err != nil {
		t.Fatalf("decode resume response: %v", err)
	}
	if resumed["session_id"] != created["session_id"] || resumed["work_dir"] != "/tmp/resume-work" {
		t.Fatalf("unexpected resume response: %#v", resumed)
	}
}

func TestWebsocketCloseMarksSessionDetached(t *testing.T) {
	lockfile := filepath.Join(t.TempDir(), "server.lock.json")
	sessionIndex := filepath.Join(t.TempDir(), "sessions.json")
	t.Setenv("CLAUDE_CODE_GO_SERVER_LOCKFILE", lockfile)
	t.Setenv("CLAUDE_CODE_GO_SERVER_SESSION_INDEX", sessionIndex)

	running, err := Start([]string{"--host", "127.0.0.1", "--port", "0", "--auth-token", "demo-token"})
	if err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	defer func() {
		if err := running.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	}()

	req, err := http.NewRequest(http.MethodPost, running.Result.SessionsEndpoint, bytes.NewBufferString(`{"cwd":"/tmp/detached-work"}`))
	if err != nil {
		t.Fatalf("NewRequest returned error: %v", err)
	}
	req.Header.Set("Authorization", "Bearer demo-token")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create session failed: %v", err)
	}
	defer resp.Body.Close()
	var created map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}

	ws, _, err := websocket.DefaultDialer.Dial(created["ws_url"], http.Header{
		"Authorization": []string{"Bearer demo-token"},
	})
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}
	var ready map[string]any
	if err := ws.ReadJSON(&ready); err != nil {
		t.Fatalf("read ready event failed: %v", err)
	}
	_ = ws.Close()

	deadline := time.Now().Add(2 * time.Second)
	for {
		data, err := os.ReadFile(sessionIndex)
		if err != nil {
			t.Fatalf("read session index: %v", err)
		}
		var index map[string]map[string]any
		if err := json.Unmarshal(data, &index); err != nil {
			t.Fatalf("parse session index: %v", err)
		}
		entry := index[created["session_id"]]
		if entry["status"] == "detached" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected detached status, got %#v", entry)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestCloseMarksPersistedSessionsStopped(t *testing.T) {
	lockfile := filepath.Join(t.TempDir(), "server.lock.json")
	sessionIndex := filepath.Join(t.TempDir(), "sessions.json")
	t.Setenv("CLAUDE_CODE_GO_SERVER_LOCKFILE", lockfile)
	t.Setenv("CLAUDE_CODE_GO_SERVER_SESSION_INDEX", sessionIndex)

	running, err := Start([]string{"--host", "127.0.0.1", "--port", "0", "--auth-token", "demo-token"})
	if err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	req, err := http.NewRequest(http.MethodPost, running.Result.SessionsEndpoint, bytes.NewBufferString(`{"cwd":"/tmp/stopped-work"}`))
	if err != nil {
		t.Fatalf("NewRequest returned error: %v", err)
	}
	req.Header.Set("Authorization", "Bearer demo-token")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create session failed: %v", err)
	}
	defer resp.Body.Close()
	var created map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	ws, _, err := websocket.DefaultDialer.Dial(created["ws_url"], http.Header{
		"Authorization": []string{"Bearer demo-token"},
	})
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}
	var ready map[string]any
	if err := ws.ReadJSON(&ready); err != nil {
		t.Fatalf("read ready event failed: %v", err)
	}
	_ = ws.Close()

	if err := running.Close(); err != nil {
		t.Fatalf("Close returned error: %v", err)
	}

	data, err := os.ReadFile(sessionIndex)
	if err != nil {
		t.Fatalf("read session index: %v", err)
	}
	var index map[string]map[string]any
	if err := json.Unmarshal(data, &index); err != nil {
		t.Fatalf("parse session index: %v", err)
	}
	entry := index[created["session_id"]]
	if entry["status"] != "stopped" {
		t.Fatalf("expected stopped status, got %#v", entry)
	}
	if entry["backendStatus"] != "stopped" {
		t.Fatalf("expected stopped backend status, got %#v", entry)
	}
}

func TestResumeSessionKeepsBackendAliveAcrossDetach(t *testing.T) {
	lockfile := filepath.Join(t.TempDir(), "server.lock.json")
	sessionIndex := filepath.Join(t.TempDir(), "sessions.json")
	t.Setenv("CLAUDE_CODE_GO_SERVER_LOCKFILE", lockfile)
	t.Setenv("CLAUDE_CODE_GO_SERVER_SESSION_INDEX", sessionIndex)

	running, err := Start([]string{"--host", "127.0.0.1", "--port", "0", "--auth-token", "demo-token"})
	if err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	defer func() {
		if err := running.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	}()

	req, err := http.NewRequest(http.MethodPost, running.Result.SessionsEndpoint, bytes.NewBufferString(`{"cwd":"/tmp/reconnect-work"}`))
	if err != nil {
		t.Fatalf("NewRequest returned error: %v", err)
	}
	req.Header.Set("Authorization", "Bearer demo-token")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create session failed: %v", err)
	}
	defer resp.Body.Close()
	var created map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}

	ws, _, err := websocket.DefaultDialer.Dial(created["ws_url"], http.Header{
		"Authorization": []string{"Bearer demo-token"},
	})
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}
	var ready map[string]any
	if err := ws.ReadJSON(&ready); err != nil {
		t.Fatalf("read ready event failed: %v", err)
	}
	initialState := fetchSessionState(t, running.Result.SessionsEndpoint, created["session_id"], "demo-token")
	initialPID := initialState.BackendPID
	_ = ws.Close()

	req, err = http.NewRequest(http.MethodGet, running.Result.SessionsEndpoint+"?resume="+created["session_id"], nil)
	if err != nil {
		t.Fatalf("resume request build failed: %v", err)
	}
	req.Header.Set("Authorization", "Bearer demo-token")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("resume session failed: %v", err)
	}
	defer resp.Body.Close()
	var resumed map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&resumed); err != nil {
		t.Fatalf("decode resume response: %v", err)
	}

	ws, _, err = websocket.DefaultDialer.Dial(resumed["ws_url"], http.Header{
		"Authorization": []string{"Bearer demo-token"},
	})
	if err != nil {
		t.Fatalf("reconnect websocket failed: %v", err)
	}
	if err := ws.ReadJSON(&ready); err != nil {
		t.Fatalf("read resumed ready event failed: %v", err)
	}
	resumedState := fetchSessionState(t, running.Result.SessionsEndpoint, created["session_id"], "demo-token")
	if initialPID <= 0 || resumedState.BackendPID != initialPID || resumedState.BackendStatus != "running" {
		t.Fatalf("expected same live backend across detach/resume, initial=%#v resumed=%#v", initialState, resumedState)
	}
	_ = ws.Close()
}

func TestRunServerRejectsInvalidArgs(t *testing.T) {
	_, err := Run([]string{"--port", "-1"})
	if err == nil || !strings.Contains(err.Error(), "invalid --port") {
		t.Fatalf("expected invalid port error, got %v", err)
	}
}

func fetchSessionState(t *testing.T, sessionsEndpoint, sessionID, authToken string) sessionStateResponse {
	t.Helper()
	stateURL := strings.TrimRight(sessionsEndpoint, "/") + "/" + sessionID
	req, err := http.NewRequest(http.MethodGet, stateURL, nil)
	if err != nil {
		t.Fatalf("build session state request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+authToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("read session state: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK for session state, got %s", resp.Status)
	}
	var parsed sessionStateResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		t.Fatalf("decode session state response: %v", err)
	}
	return parsed
}
