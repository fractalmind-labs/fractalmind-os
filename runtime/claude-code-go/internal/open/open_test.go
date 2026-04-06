package open

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestRunOpenDefaults(t *testing.T) {
	var gotAuth string
	var gotBody map[string]string
	srv := newHTTPDirectConnectTestServer(t, "sess-123", "/tmp/work", func(r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
	})
	defer srv.Close()

	connectURL := "cc://" + strings.TrimPrefix(srv.URL, "http://") + "?authToken=demo-token"
	result, err := Run([]string{connectURL})
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if result.Status != "connected" || result.Action != "open-direct-connect" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Transport != "http" || result.AuthToken != "demo-token" {
		t.Fatalf("unexpected server resolution: %#v", result)
	}
	if result.SessionID != "sess-123" || result.WorkDir != "/tmp/work" {
		t.Fatalf("unexpected session response: %#v", result)
	}
	if !result.BackendValidated || result.BackendStatus != "running" || result.BackendPID <= 0 {
		t.Fatalf("expected backend lifecycle validation, got %#v", result)
	}
	if !strings.HasPrefix(result.WSURL, "ws://") || !strings.Contains(result.WSURL, "/ws/sess-123") {
		t.Fatalf("unexpected session response: %#v", result)
	}
	if gotAuth != "Bearer demo-token" {
		t.Fatalf("expected auth header, got %q", gotAuth)
	}
	if strings.TrimSpace(gotBody["cwd"]) == "" {
		t.Fatalf("expected cwd in request body, got %#v", gotBody)
	}
	output := result.String()
	for _, needle := range []string{
		"status=connected",
		"action=open-direct-connect",
		"transport=http",
		"auth_token_present=true",
		"print_mode=false",
		"print_prompt=none",
		"output_format=text",
		"session_id=sess-123",
		"work_dir=/tmp/work",
		"stream_validated=true",
		"stream_event=session_ready",
		"stream_content_validated=false",
		"tool_progress_validated=false",
		"status_validated=false",
		"auth_validated=false",
		"keep_alive_validated=false",
		"post_turn_summary_validated=false",
		"compact_boundary_validated=false",
		"control_cancel_validated=false",
		"system_validated=false",
		"result_validated=false",
		"backend_validated=true",
		"backend_status=running",
	} {
		if !strings.Contains(output, needle) {
			t.Fatalf("expected output to contain %q, got:\n%s", needle, output)
		}
	}
	if !strings.Contains(output, "ws_url=ws://") || !strings.Contains(output, "/ws/sess-123") {
		t.Fatalf("expected dynamic ws_url in output, got:\n%s", output)
	}
}

func TestRunOpenSupportsPrintModeAndPrompt(t *testing.T) {
	srv := newHTTPDirectConnectTestServer(t, "sess-456", "", nil)
	defer srv.Close()

	result, err := Run([]string{
		"cc://" + strings.TrimPrefix(srv.URL, "http://"),
		"--print", "hello",
		"--output-format", "json",
	})
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if !result.PrintMode || result.PrintPrompt != "hello" || result.OutputFormat != "json" {
		t.Fatalf("unexpected print result: %#v", result)
	}
	if result.SessionID != "sess-456" || !result.StreamValidated || result.StreamEvent != "session_ready" {
		t.Fatalf("expected session response, got %#v", result)
	}
	if !result.StreamContentValidated || result.StreamContentEvent != "stream_event:content_block_delta" || !result.SystemValidated || result.SystemEvent != "system:init" || !result.StatusValidated || result.StatusEvent != "system:status" || !result.AuthValidated || result.AuthEvent != "auth_status" || !result.KeepAliveValidated || result.KeepAliveEvent != "keep_alive" || !result.ControlCancelValidated || result.ControlCancelEvent != "control_cancel_request" || !result.MessageValidated || result.MessageEvent != "assistant" || result.ValidatedTurns != 2 || !result.MultiTurnValidated || !result.ResultValidated || result.ResultEvent != "result:success" || !result.ResultErrorValidated || result.ResultErrorEvent != "result:error_during_execution" || !result.ControlValidated || !result.PermissionValidated || !result.PermissionDeniedValidated || result.PermissionDeniedEvent != "permission_denial:echo" || !result.ToolProgressValidated || result.ToolProgressEvent != "tool_progress" || !result.RateLimitValidated || result.RateLimitEvent != "rate_limit_event:default" || !result.ToolUseSummaryValidated || result.ToolUseSummaryEvent != "tool_use_summary" || !result.PostTurnSummaryValidated || result.PostTurnSummaryEvent != "system:post_turn_summary" || !result.CompactBoundaryValidated || result.CompactBoundaryEvent != "system:compact_boundary" || !result.ToolExecutionValidated || !result.InterruptValidated || !result.BackendValidated {
		t.Fatalf("expected session response, got %#v", result)
	}
}

func TestRunOpenSupportsUnixConnectURL(t *testing.T) {
	socketPath := filepath.Join("/tmp", fmt.Sprintf("claude-open-%d.sock", time.Now().UnixNano()))
	srv, err := newUnixDirectConnectTestServer(t, socketPath, "sess-unix", "/tmp/unix-work")
	defer srv.Close()
	if err != nil {
		t.Fatalf("new unix server: %v", err)
	}
	defer os.Remove(socketPath)

	result, err := Run([]string{"cc+unix://%2F" + strings.ReplaceAll(strings.TrimPrefix(socketPath, "/"), "/", "%2F") + "?token=demo"})
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if result.Transport != "unix" || result.ServerURL != "unix:"+socketPath || result.AuthToken != "demo" {
		t.Fatalf("unexpected unix result: %#v", result)
	}
	if result.SessionID != "sess-unix" || result.WorkDir != "/tmp/unix-work" || !result.StreamValidated || result.StreamEvent != "session_ready" || !result.BackendValidated {
		t.Fatalf("expected unix session response, got %#v", result)
	}
	if want := "ws+unix://" + url.PathEscape(socketPath) + "/ws/sess-unix"; result.WSURL != want {
		t.Fatalf("expected ws url %q, got %q", want, result.WSURL)
	}
}

func TestRunOpenSupportsResumeSession(t *testing.T) {
	srv := newHTTPDirectConnectTestServer(t, "sess-resume", "/tmp/resume-work", nil)
	defer srv.Close()

	result, err := Run([]string{
		"cc://" + strings.TrimPrefix(srv.URL, "http://") + "?authToken=demo-token",
		"--resume-session", "sess-resume",
	})
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if result.Action != "resume-direct-connect" || result.SessionID != "sess-resume" || !result.BackendValidated {
		t.Fatalf("unexpected resume result: %#v", result)
	}
}

func TestRunOpenSupportsStopSession(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/sessions/sess-stop", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Fatalf("expected DELETE, got %s", r.Method)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer demo-token" {
			t.Fatalf("expected auth header, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"session_id":         "sess-stop",
			"work_dir":           "/tmp/stop-work",
			"status":             "stopped",
			"backend_status":     "stopped",
			"backend_pid":        12345,
			"backend_started_at": 123456789,
			"backend_stopped_at": 123456999,
			"backend_exit_code":  0,
		})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	result, err := Run([]string{
		"cc://" + strings.TrimPrefix(srv.URL, "http://") + "?authToken=demo-token",
		"--stop-session", "sess-stop",
	})
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if result.Status != "stopped" || result.Action != "stop-direct-connect-session" || result.SessionID != "sess-stop" {
		t.Fatalf("unexpected stop result: %#v", result)
	}
	if result.WorkDir != "/tmp/stop-work" || result.BackendStatus != "stopped" || result.BackendPID != 12345 || result.BackendStoppedAt != 123456999 || result.BackendExitCode != 0 {
		t.Fatalf("unexpected stop lifecycle: %#v", result)
	}
}

func TestRunOpenSurfacesMaxSessionsGuard(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/sessions", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "max sessions reached (1/1)", http.StatusTooManyRequests)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	_, err := Run([]string{"cc://" + strings.TrimPrefix(srv.URL, "http://")})
	if err == nil {
		t.Fatalf("expected max sessions error")
	}
	if !strings.Contains(err.Error(), "429 Too Many Requests") || !strings.Contains(err.Error(), "max sessions reached (1/1)") {
		t.Fatalf("unexpected max sessions error: %v", err)
	}
}

func TestRunOpenRejectsMissingURL(t *testing.T) {
	_, err := Run(nil)
	if err == nil || !strings.Contains(err.Error(), "usage: claude-code-go open <cc-url>") {
		t.Fatalf("expected usage error, got %v", err)
	}
}

func TestRunOpenRejectsUnknownOption(t *testing.T) {
	_, err := Run([]string{"cc://127.0.0.1:7777", "--unknown"})
	if err == nil || !strings.Contains(err.Error(), "unknown option") {
		t.Fatalf("expected unknown option error, got %v", err)
	}
}

func TestRunOpenRejectsResumeAndStopTogether(t *testing.T) {
	_, err := Run([]string{"cc://127.0.0.1:7777", "--resume-session", "sess-1", "--stop-session", "sess-1"})
	if err == nil || !strings.Contains(err.Error(), "cannot be used together") {
		t.Fatalf("expected mutual exclusion error, got %v", err)
	}
}

func TestRunOpenRejectsInvalidScheme(t *testing.T) {
	_, err := Run([]string{"https://127.0.0.1:7777"})
	if err == nil || !strings.Contains(err.Error(), "unsupported scheme") {
		t.Fatalf("expected invalid scheme error, got %v", err)
	}
}

func newHTTPDirectConnectTestServer(t *testing.T, sessionID, workDir string, onSession func(*http.Request)) *httptest.Server {
	t.Helper()

	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	mux := http.NewServeMux()
	var wsBase string

	mux.HandleFunc("/sessions", func(w http.ResponseWriter, r *http.Request) {
		if onSession != nil {
			onSession(r)
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_ = json.NewEncoder(w).Encode(map[string]string{
				"session_id": sessionID,
				"ws_url":     wsBase + "/" + sessionID,
				"work_dir":   workDir,
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{
			"session_id": sessionID,
			"ws_url":     wsBase + "/" + sessionID,
			"work_dir":   workDir,
		})
	})
	mux.HandleFunc("/sessions/"+sessionID, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"session_id":         sessionID,
			"status":             "running",
			"backend_status":     "running",
			"backend_pid":        12345,
			"backend_started_at": 123456789,
			"backend_exit_code":  -1,
		})
	})
	mux.HandleFunc("/ws/"+sessionID, func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade websocket: %v", err)
			return
		}
		defer conn.Close()
		serveDirectConnectWS(t, conn, sessionID, workDir, "http")
	})

	srv := httptest.NewServer(mux)
	wsBase = "ws://" + strings.TrimPrefix(srv.URL, "http://") + "/ws"
	return srv
}

func newUnixDirectConnectTestServer(t *testing.T, socketPath, sessionID, workDir string) (*httptest.Server, error) {
	t.Helper()
	_ = os.Remove(socketPath)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, err
	}

	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	mux := http.NewServeMux()
	wsURL := "ws+unix://" + url.PathEscape(socketPath) + "/ws/" + sessionID

	mux.HandleFunc("/sessions", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_ = json.NewEncoder(w).Encode(map[string]string{
				"session_id": sessionID,
				"ws_url":     wsURL,
				"work_dir":   workDir,
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{
			"session_id": sessionID,
			"ws_url":     wsURL,
			"work_dir":   workDir,
		})
	})
	mux.HandleFunc("/sessions/"+sessionID, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"session_id":         sessionID,
			"status":             "running",
			"backend_status":     "running",
			"backend_pid":        12345,
			"backend_started_at": 123456789,
			"backend_exit_code":  -1,
		})
	})
	mux.HandleFunc("/ws/"+sessionID, func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade websocket: %v", err)
			return
		}
		defer conn.Close()
		serveDirectConnectWS(t, conn, sessionID, workDir, "unix")
	})

	srv := httptest.NewUnstartedServer(mux)
	srv.Listener = listener
	srv.Config.BaseContext = func(net.Listener) context.Context { return context.Background() }
	srv.Start()
	return srv, nil
}

func serveDirectConnectWS(t *testing.T, conn *websocket.Conn, sessionID, workDir, transport string) {
	t.Helper()
	_ = conn.WriteJSON(map[string]string{
		"type":       "session_ready",
		"session_id": sessionID,
		"work_dir":   workDir,
		"transport":  transport,
	})
	_ = conn.WriteJSON(map[string]any{
		"type":                "system",
		"subtype":             "init",
		"apiKeySource":        "oauth",
		"claude_code_version": "claude-code-go-dev",
		"cwd":                 workDir,
		"tools":               []string{"echo"},
		"mcp_servers":         []map[string]any{},
		"model":               "claude-sonnet-4-5",
		"permissionMode":      "default",
		"slash_commands":      []string{},
		"output_style":        "text",
		"skills":              []string{},
		"plugins":             []map[string]any{},
		"uuid":                "sys-init-1",
		"session_id":          sessionID,
	})
	_ = conn.WriteJSON(map[string]any{
		"type":             "auth_status",
		"isAuthenticating": false,
		"output":           []string{"oauth"},
		"uuid":             "auth-1",
		"session_id":       sessionID,
	})
	_ = conn.WriteJSON(map[string]any{
		"type":           "system",
		"subtype":        "status",
		"status":         nil,
		"permissionMode": "default",
		"uuid":           "status-1",
		"session_id":     sessionID,
	})
	_ = conn.WriteJSON(map[string]any{
		"type": "keep_alive",
	})

	requestCounter := 0
	pendingRequestID := ""
	pendingPrompt := ""
	for {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return
		}
		switch strings.TrimSpace(asString(incoming["type"])) {
		case "user":
			prompt := "hello"
			message, _ := incoming["message"].(map[string]any)
			content, _ := message["content"].([]any)
			for _, item := range content {
				block, _ := item.(map[string]any)
				if text := strings.TrimSpace(asString(block["text"])); text != "" {
					prompt = text
					break
				}
			}
			requestCounter++
			pendingRequestID = fmt.Sprintf("req-%d", requestCounter)
			pendingPrompt = prompt
			_ = conn.WriteJSON(map[string]any{
				"type":       "control_request",
				"request_id": pendingRequestID,
				"request": map[string]any{
					"subtype":      "can_use_tool",
					"tool_name":    "echo",
					"tool_use_id":  fmt.Sprintf("toolu-%d", requestCounter),
					"title":        "direct-connect echo tool request",
					"display_name": "Echo",
					"description":  "Minimal direct-connect tool execution request",
					"input": map[string]any{
						"text": prompt,
					},
				},
			})
		case "control_response":
			response, _ := incoming["response"].(map[string]any)
			if strings.TrimSpace(asString(response["request_id"])) != pendingRequestID {
				continue
			}
			toolText := pendingPrompt
			responsePayload, _ := response["response"].(map[string]any)
			if strings.TrimSpace(asString(responsePayload["behavior"])) == "deny" {
				_ = conn.WriteJSON(map[string]any{
					"type":            "result",
					"subtype":         "error_during_execution",
					"duration_ms":     1,
					"duration_api_ms": 0,
					"is_error":        true,
					"num_turns":       requestCounter - 1,
					"stop_reason":     "permission_denied",
					"total_cost_usd":  0,
					"usage":           map[string]any{},
					"modelUsage":      map[string]any{"claude-sonnet-4-5": minimalModelUsageFixture()},
					"permission_denials": []map[string]any{
						{
							"tool_name":   "echo",
							"tool_use_id": fmt.Sprintf("toolu-%d", requestCounter),
							"tool_input": map[string]any{
								"text": pendingPrompt,
							},
						},
					},
					"errors":     []string{"permission denied for tool echo"},
					"uuid":       fmt.Sprintf("result-denied-%d", requestCounter),
					"session_id": sessionID,
				})
				pendingRequestID = ""
				pendingPrompt = ""
				continue
			}
			if updatedInput, ok := responsePayload["updatedInput"].(map[string]any); ok {
				if text := strings.TrimSpace(asString(updatedInput["text"])); text != "" {
					toolText = text
				}
			}
			_ = conn.WriteJSON(map[string]any{
				"type":       "control_cancel_request",
				"request_id": pendingRequestID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":                 "tool_progress",
				"tool_use_id":          fmt.Sprintf("toolu-%d", requestCounter),
				"tool_name":            "echo",
				"parent_tool_use_id":   nil,
				"elapsed_time_seconds": 0,
				"uuid":                 fmt.Sprintf("tool-progress-%d", requestCounter),
				"session_id":           sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":       "rate_limit_event",
				"bucket":     "default",
				"limit":      100,
				"remaining":  99,
				"reset_secs": 60,
				"uuid":       fmt.Sprintf("rate-limit-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "stream_event",
				"event": map[string]any{
					"type":  "content_block_delta",
					"index": 0,
					"delta": map[string]any{
						"type": "text_delta",
						"text": "echo:" + toolText,
					},
				},
				"parent_tool_use_id": nil,
				"uuid":               fmt.Sprintf("stream-event-%d", requestCounter),
				"session_id":         sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "assistant",
				"message": map[string]any{
					"role": "assistant",
					"content": []map[string]any{
						{
							"type": "text",
							"text": "echo:" + toolText,
						},
					},
				},
			})
			_ = conn.WriteJSON(map[string]any{
				"type":           "tool_use_summary",
				"tool_name":      "echo",
				"tool_use_id":    fmt.Sprintf("toolu-%d", requestCounter),
				"duration_ms":    1,
				"input_preview":  toolText,
				"output_preview": "echo:" + toolText,
				"uuid":           fmt.Sprintf("tool-summary-%d", requestCounter),
				"session_id":     sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":               "result",
				"subtype":            "success",
				"duration_ms":        1,
				"duration_api_ms":    0,
				"is_error":           false,
				"num_turns":          requestCounter,
				"result":             "echo:" + toolText,
				"stop_reason":        nil,
				"total_cost_usd":     0,
				"usage":              map[string]any{},
				"modelUsage":         map[string]any{"claude-sonnet-4-5": minimalModelUsageFixture()},
				"permission_denials": []map[string]any{},
				"uuid":               fmt.Sprintf("result-%d", requestCounter),
				"session_id":         sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":            "system",
				"subtype":         "post_turn_summary",
				"summarizes_uuid": fmt.Sprintf("result-%d", requestCounter),
				"status_category": "completed",
				"status_detail":   "direct-connect turn completed",
				"is_noteworthy":   false,
				"title":           "Turn complete",
				"description":     "Minimal direct-connect post-turn summary emitted by test server",
				"recent_action":   "Executed echo tool and returned assistant/result events",
				"needs_action":    "none",
				"artifact_urls":   []string{},
				"uuid":            fmt.Sprintf("post-turn-summary-%d", requestCounter),
				"session_id":      sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":    "system",
				"subtype": "compact_boundary",
				"compact_metadata": map[string]any{
					"trigger":    "auto",
					"pre_tokens": 128,
				},
				"uuid":       fmt.Sprintf("compact-boundary-%d", requestCounter),
				"session_id": sessionID,
			})
			pendingRequestID = ""
			pendingPrompt = ""
		case "control_request":
			requestID := strings.TrimSpace(asString(incoming["request_id"]))
			request, _ := incoming["request"].(map[string]any)
			if strings.TrimSpace(asString(request["subtype"])) != "interrupt" {
				continue
			}
			_ = conn.WriteJSON(map[string]any{
				"type": "control_response",
				"response": map[string]any{
					"subtype":    "success",
					"request_id": requestID,
					"response": map[string]any{
						"interrupted": true,
					},
				},
			})
		}
	}
}

func minimalModelUsageFixture() map[string]any {
	return map[string]any{
		"inputTokens":              0,
		"outputTokens":             0,
		"cacheReadInputTokens":     0,
		"cacheCreationInputTokens": 0,
		"webSearchRequests":        0,
		"costUSD":                  0,
		"contextWindow":            0,
	}
}
