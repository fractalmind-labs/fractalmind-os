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
		"type": "update_environment_variables",
		"variables": map[string]any{
			"DIRECT_CONNECT_DEMO": "1",
		},
	}); err != nil {
		t.Fatalf("write update_environment_variables failed: %v", err)
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

	var runningState map[string]any
	if err := ws.ReadJSON(&runningState); err != nil {
		t.Fatalf("read running session_state_changed failed: %v", err)
	}
	if runningState["type"] != "system" || strings.TrimSpace(asString(runningState["subtype"])) != "session_state_changed" || strings.TrimSpace(asString(runningState["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(runningState["state"])) != "running" {
		t.Fatalf("unexpected running session_state_changed payload: %#v", runningState)
	}
	var requiresActionState map[string]any
	if err := ws.ReadJSON(&requiresActionState); err != nil {
		t.Fatalf("read requires_action session_state_changed failed: %v", err)
	}
	if requiresActionState["type"] != "system" || strings.TrimSpace(asString(requiresActionState["subtype"])) != "session_state_changed" || strings.TrimSpace(asString(requiresActionState["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(requiresActionState["state"])) != "requires_action" {
		t.Fatalf("unexpected requires_action session_state_changed payload: %#v", requiresActionState)
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
	var taskStarted map[string]any
	if err := ws.ReadJSON(&taskStarted); err != nil {
		t.Fatalf("read task_started failed: %v", err)
	}
	if taskStarted["type"] != "system" || strings.TrimSpace(asString(taskStarted["subtype"])) != "task_started" || strings.TrimSpace(asString(taskStarted["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected task_started payload: %#v", taskStarted)
	}
	if strings.TrimSpace(asString(taskStarted["task_id"])) == "" || strings.TrimSpace(asString(taskStarted["tool_use_id"])) != strings.TrimSpace(asString(request["tool_use_id"])) || strings.TrimSpace(asString(taskStarted["description"])) == "" || strings.TrimSpace(asString(taskStarted["prompt"])) != "hello [approved]" {
		t.Fatalf("invalid task_started payload: %#v", taskStarted)
	}
	var taskProgress map[string]any
	if err := ws.ReadJSON(&taskProgress); err != nil {
		t.Fatalf("read task_progress failed: %v", err)
	}
	if taskProgress["type"] != "system" || strings.TrimSpace(asString(taskProgress["subtype"])) != "task_progress" || strings.TrimSpace(asString(taskProgress["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected task_progress payload: %#v", taskProgress)
	}
	taskProgressUsage, _ := taskProgress["usage"].(map[string]any)
	if strings.TrimSpace(asString(taskProgress["task_id"])) != strings.TrimSpace(asString(taskStarted["task_id"])) || strings.TrimSpace(asString(taskProgress["tool_use_id"])) != strings.TrimSpace(asString(request["tool_use_id"])) || int(taskProgressUsage["tool_uses"].(float64)) != 1 || strings.TrimSpace(asString(taskProgress["last_tool_name"])) != directConnectEchoToolName {
		t.Fatalf("invalid task_progress payload: %#v", taskProgress)
	}
	var apiRetry map[string]any
	if err := ws.ReadJSON(&apiRetry); err != nil {
		t.Fatalf("read api_retry failed: %v", err)
	}
	if apiRetry["type"] != "system" || strings.TrimSpace(asString(apiRetry["subtype"])) != "api_retry" || strings.TrimSpace(asString(apiRetry["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected api_retry payload: %#v", apiRetry)
	}
	if int(apiRetry["attempt"].(float64)) != 1 || int(apiRetry["max_retries"].(float64)) != 3 || int(apiRetry["retry_delay_ms"].(float64)) != 500 || int(apiRetry["error_status"].(float64)) != 529 || strings.TrimSpace(asString(apiRetry["error"])) != "rate_limit" {
		t.Fatalf("invalid api_retry payload: %#v", apiRetry)
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
	var streamlinedText map[string]any
	if err := ws.ReadJSON(&streamlinedText); err != nil {
		t.Fatalf("read streamlined_text failed: %v", err)
	}
	if streamlinedText["type"] != "streamlined_text" || strings.TrimSpace(asString(streamlinedText["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(streamlinedText["text"])) != "echo:hello [approved]" {
		t.Fatalf("unexpected streamlined_text payload: %#v", streamlinedText)
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
	var streamlinedToolSummary map[string]any
	if err := ws.ReadJSON(&streamlinedToolSummary); err != nil {
		t.Fatalf("read streamlined_tool_use_summary failed: %v", err)
	}
	if streamlinedToolSummary["type"] != "streamlined_tool_use_summary" || strings.TrimSpace(asString(streamlinedToolSummary["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(streamlinedToolSummary["tool_summary"])) != "Used echo 1 time" {
		t.Fatalf("unexpected streamlined_tool_use_summary payload: %#v", streamlinedToolSummary)
	}
	var result map[string]any
	if err := ws.ReadJSON(&result); err != nil {
		t.Fatalf("read result event failed: %v", err)
	}
	if result["type"] != "result" || strings.TrimSpace(asString(result["subtype"])) != "success" || strings.TrimSpace(asString(result["result"])) != "echo:hello [approved]" {
		t.Fatalf("unexpected result event: %#v", result)
	}
	var promptSuggestion map[string]any
	if err := ws.ReadJSON(&promptSuggestion); err != nil {
		t.Fatalf("read prompt_suggestion failed: %v", err)
	}
	if promptSuggestion["type"] != "prompt_suggestion" || strings.TrimSpace(asString(promptSuggestion["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(promptSuggestion["suggestion"])) != "Try asking for another echo example" {
		t.Fatalf("unexpected prompt_suggestion payload: %#v", promptSuggestion)
	}
	var taskNotification map[string]any
	if err := ws.ReadJSON(&taskNotification); err != nil {
		t.Fatalf("read task_notification failed: %v", err)
	}
	if taskNotification["type"] != "system" || strings.TrimSpace(asString(taskNotification["subtype"])) != "task_notification" || strings.TrimSpace(asString(taskNotification["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected task_notification payload: %#v", taskNotification)
	}
	taskNotificationUsage, _ := taskNotification["usage"].(map[string]any)
	if strings.TrimSpace(asString(taskNotification["task_id"])) != strings.TrimSpace(asString(taskStarted["task_id"])) || strings.TrimSpace(asString(taskNotification["tool_use_id"])) != strings.TrimSpace(asString(request["tool_use_id"])) || strings.TrimSpace(asString(taskNotification["status"])) != "completed" || strings.TrimSpace(asString(taskNotification["output_file"])) == "" || strings.TrimSpace(asString(taskNotification["summary"])) != "echo:hello [approved]" || int(taskNotificationUsage["tool_uses"].(float64)) != 1 {
		t.Fatalf("invalid task_notification payload: %#v", taskNotification)
	}
	var filesPersisted map[string]any
	if err := ws.ReadJSON(&filesPersisted); err != nil {
		t.Fatalf("read files_persisted failed: %v", err)
	}
	if filesPersisted["type"] != "system" || strings.TrimSpace(asString(filesPersisted["subtype"])) != "files_persisted" || strings.TrimSpace(asString(filesPersisted["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected files_persisted payload: %#v", filesPersisted)
	}
	filesPersistedFiles, _ := filesPersisted["files"].([]any)
	filesPersistedFailed, _ := filesPersisted["failed"].([]any)
	if len(filesPersistedFiles) != 1 || len(filesPersistedFailed) != 0 || strings.TrimSpace(asString(filesPersisted["processed_at"])) == "" {
		t.Fatalf("invalid files_persisted payload: %#v", filesPersisted)
	}
	filesPersistedFile0, _ := filesPersistedFiles[0].(map[string]any)
	if strings.TrimSpace(asString(filesPersistedFile0["filename"])) == "" || strings.TrimSpace(asString(filesPersistedFile0["file_id"])) == "" {
		t.Fatalf("invalid files_persisted file payload: %#v", filesPersisted)
	}
	var localCommandOutput map[string]any
	if err := ws.ReadJSON(&localCommandOutput); err != nil {
		t.Fatalf("read local_command_output failed: %v", err)
	}
	if localCommandOutput["type"] != "system" || strings.TrimSpace(asString(localCommandOutput["subtype"])) != "local_command_output" || strings.TrimSpace(asString(localCommandOutput["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected local_command_output payload: %#v", localCommandOutput)
	}
	if strings.TrimSpace(asString(localCommandOutput["content"])) == "" {
		t.Fatalf("invalid local_command_output payload: %#v", localCommandOutput)
	}
	var elicitationComplete map[string]any
	if err := ws.ReadJSON(&elicitationComplete); err != nil {
		t.Fatalf("read elicitation_complete failed: %v", err)
	}
	if elicitationComplete["type"] != "system" || strings.TrimSpace(asString(elicitationComplete["subtype"])) != "elicitation_complete" || strings.TrimSpace(asString(elicitationComplete["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected elicitation_complete payload: %#v", elicitationComplete)
	}
	if strings.TrimSpace(asString(elicitationComplete["mcp_server_name"])) == "" || strings.TrimSpace(asString(elicitationComplete["elicitation_id"])) == "" {
		t.Fatalf("invalid elicitation_complete payload: %#v", elicitationComplete)
	}
	var postTurnSummary map[string]any
	if err := ws.ReadJSON(&postTurnSummary); err != nil {
		t.Fatalf("read post_turn_summary failed: %v", err)
	}
	if postTurnSummary["type"] != "system" || strings.TrimSpace(asString(postTurnSummary["subtype"])) != "post_turn_summary" || strings.TrimSpace(asString(postTurnSummary["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected post_turn_summary payload: %#v", postTurnSummary)
	}
	if strings.TrimSpace(asString(postTurnSummary["summarizes_uuid"])) == "" || strings.TrimSpace(asString(postTurnSummary["status_category"])) != "completed" || strings.TrimSpace(asString(postTurnSummary["title"])) == "" || strings.TrimSpace(asString(postTurnSummary["recent_action"])) == "" {
		t.Fatalf("invalid post_turn_summary payload: %#v", postTurnSummary)
	}
	var compactingStatus map[string]any
	if err := ws.ReadJSON(&compactingStatus); err != nil {
		t.Fatalf("read compacting status failed: %v", err)
	}
	if compactingStatus["type"] != "system" || strings.TrimSpace(asString(compactingStatus["subtype"])) != "status" || strings.TrimSpace(asString(compactingStatus["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(compactingStatus["permissionMode"])) != "default" || strings.TrimSpace(asString(compactingStatus["status"])) != "compacting" {
		t.Fatalf("unexpected compacting status payload: %#v", compactingStatus)
	}
	var compactBoundary map[string]any
	if err := ws.ReadJSON(&compactBoundary); err != nil {
		t.Fatalf("read compact_boundary failed: %v", err)
	}
	if compactBoundary["type"] != "system" || strings.TrimSpace(asString(compactBoundary["subtype"])) != "compact_boundary" || strings.TrimSpace(asString(compactBoundary["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected compact_boundary payload: %#v", compactBoundary)
	}
	compactMetadata, _ := compactBoundary["compact_metadata"].(map[string]any)
	if strings.TrimSpace(asString(compactMetadata["trigger"])) != "auto" || int(compactMetadata["pre_tokens"].(float64)) != 128 {
		t.Fatalf("invalid compact_boundary payload: %#v", compactBoundary)
	}
	var idleState map[string]any
	var compactionDoneStatus map[string]any
	if err := ws.ReadJSON(&compactionDoneStatus); err != nil {
		t.Fatalf("read compaction-done status failed: %v", err)
	}
	if compactionDoneStatus["type"] != "system" || strings.TrimSpace(asString(compactionDoneStatus["subtype"])) != "status" || strings.TrimSpace(asString(compactionDoneStatus["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(compactionDoneStatus["permissionMode"])) != "default" {
		t.Fatalf("unexpected compaction-done status payload: %#v", compactionDoneStatus)
	}
	if status, ok := compactionDoneStatus["status"]; !ok || status != nil {
		t.Fatalf("invalid compaction-done status payload: %#v", compactionDoneStatus)
	}
	if err := ws.ReadJSON(&idleState); err != nil {
		t.Fatalf("read idle session_state_changed failed: %v", err)
	}
	if idleState["type"] != "system" || strings.TrimSpace(asString(idleState["subtype"])) != "session_state_changed" || strings.TrimSpace(asString(idleState["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(idleState["state"])) != "idle" {
		t.Fatalf("unexpected idle session_state_changed payload: %#v", idleState)
	}
	var hookStarted map[string]any
	if err := ws.ReadJSON(&hookStarted); err != nil {
		t.Fatalf("read hook_started failed: %v", err)
	}
	if hookStarted["type"] != "system" || strings.TrimSpace(asString(hookStarted["subtype"])) != "hook_started" || strings.TrimSpace(asString(hookStarted["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected hook_started payload: %#v", hookStarted)
	}
	if strings.TrimSpace(asString(hookStarted["hook_id"])) == "" || strings.TrimSpace(asString(hookStarted["hook_name"])) == "" || strings.TrimSpace(asString(hookStarted["hook_event"])) != "Stop" {
		t.Fatalf("invalid hook_started payload: %#v", hookStarted)
	}
	var hookProgress map[string]any
	if err := ws.ReadJSON(&hookProgress); err != nil {
		t.Fatalf("read hook_progress failed: %v", err)
	}
	if hookProgress["type"] != "system" || strings.TrimSpace(asString(hookProgress["subtype"])) != "hook_progress" || strings.TrimSpace(asString(hookProgress["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected hook_progress payload: %#v", hookProgress)
	}
	if strings.TrimSpace(asString(hookProgress["hook_id"])) == "" || strings.TrimSpace(asString(hookProgress["hook_name"])) == "" || strings.TrimSpace(asString(hookProgress["hook_event"])) != "Stop" || strings.TrimSpace(asString(hookProgress["output"])) == "" {
		t.Fatalf("invalid hook_progress payload: %#v", hookProgress)
	}
	var hookResponse map[string]any
	if err := ws.ReadJSON(&hookResponse); err != nil {
		t.Fatalf("read hook_response failed: %v", err)
	}
	if hookResponse["type"] != "system" || strings.TrimSpace(asString(hookResponse["subtype"])) != "hook_response" || strings.TrimSpace(asString(hookResponse["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected hook_response payload: %#v", hookResponse)
	}
	if strings.TrimSpace(asString(hookResponse["hook_id"])) == "" || strings.TrimSpace(asString(hookResponse["hook_name"])) == "" || strings.TrimSpace(asString(hookResponse["hook_event"])) != "Stop" || strings.TrimSpace(asString(hookResponse["outcome"])) != "success" {
		t.Fatalf("invalid hook_response payload: %#v", hookResponse)
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

	var secondRunningState map[string]any
	if err := ws.ReadJSON(&secondRunningState); err != nil {
		t.Fatalf("read second running session_state_changed failed: %v", err)
	}
	if secondRunningState["type"] != "system" || strings.TrimSpace(asString(secondRunningState["subtype"])) != "session_state_changed" || strings.TrimSpace(asString(secondRunningState["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(secondRunningState["state"])) != "running" {
		t.Fatalf("unexpected second running session_state_changed payload: %#v", secondRunningState)
	}
	var secondRequiresActionState map[string]any
	if err := ws.ReadJSON(&secondRequiresActionState); err != nil {
		t.Fatalf("read second requires_action session_state_changed failed: %v", err)
	}
	if secondRequiresActionState["type"] != "system" || strings.TrimSpace(asString(secondRequiresActionState["subtype"])) != "session_state_changed" || strings.TrimSpace(asString(secondRequiresActionState["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(secondRequiresActionState["state"])) != "requires_action" {
		t.Fatalf("unexpected second requires_action session_state_changed payload: %#v", secondRequiresActionState)
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
	var secondTaskStarted map[string]any
	if err := ws.ReadJSON(&secondTaskStarted); err != nil {
		t.Fatalf("read second task_started failed: %v", err)
	}
	if secondTaskStarted["type"] != "system" || strings.TrimSpace(asString(secondTaskStarted["subtype"])) != "task_started" || strings.TrimSpace(asString(secondTaskStarted["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second task_started payload: %#v", secondTaskStarted)
	}
	if strings.TrimSpace(asString(secondTaskStarted["task_id"])) == "" || strings.TrimSpace(asString(secondTaskStarted["tool_use_id"])) != strings.TrimSpace(asString(secondRequest["tool_use_id"])) || strings.TrimSpace(asString(secondTaskStarted["description"])) == "" || strings.TrimSpace(asString(secondTaskStarted["prompt"])) != "hello again [approved]" {
		t.Fatalf("invalid second task_started payload: %#v", secondTaskStarted)
	}
	var secondTaskProgress map[string]any
	if err := ws.ReadJSON(&secondTaskProgress); err != nil {
		t.Fatalf("read second task_progress failed: %v", err)
	}
	if secondTaskProgress["type"] != "system" || strings.TrimSpace(asString(secondTaskProgress["subtype"])) != "task_progress" || strings.TrimSpace(asString(secondTaskProgress["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second task_progress payload: %#v", secondTaskProgress)
	}
	secondTaskProgressUsage, _ := secondTaskProgress["usage"].(map[string]any)
	if strings.TrimSpace(asString(secondTaskProgress["task_id"])) != strings.TrimSpace(asString(secondTaskStarted["task_id"])) || strings.TrimSpace(asString(secondTaskProgress["tool_use_id"])) != strings.TrimSpace(asString(secondRequest["tool_use_id"])) || int(secondTaskProgressUsage["tool_uses"].(float64)) != 1 || strings.TrimSpace(asString(secondTaskProgress["last_tool_name"])) != directConnectEchoToolName {
		t.Fatalf("invalid second task_progress payload: %#v", secondTaskProgress)
	}
	var secondAPIRetry map[string]any
	if err := ws.ReadJSON(&secondAPIRetry); err != nil {
		t.Fatalf("read second api_retry failed: %v", err)
	}
	if secondAPIRetry["type"] != "system" || strings.TrimSpace(asString(secondAPIRetry["subtype"])) != "api_retry" || strings.TrimSpace(asString(secondAPIRetry["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second api_retry payload: %#v", secondAPIRetry)
	}
	if int(secondAPIRetry["attempt"].(float64)) != 1 || int(secondAPIRetry["max_retries"].(float64)) != 3 || int(secondAPIRetry["retry_delay_ms"].(float64)) != 500 || int(secondAPIRetry["error_status"].(float64)) != 529 || strings.TrimSpace(asString(secondAPIRetry["error"])) != "rate_limit" {
		t.Fatalf("invalid second api_retry payload: %#v", secondAPIRetry)
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
	var secondStreamlinedText map[string]any
	if err := ws.ReadJSON(&secondStreamlinedText); err != nil {
		t.Fatalf("read second streamlined_text failed: %v", err)
	}
	if secondStreamlinedText["type"] != "streamlined_text" || strings.TrimSpace(asString(secondStreamlinedText["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(secondStreamlinedText["text"])) != "echo:hello again [approved]" {
		t.Fatalf("unexpected second streamlined_text payload: %#v", secondStreamlinedText)
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
	var secondStreamlinedToolSummary map[string]any
	if err := ws.ReadJSON(&secondStreamlinedToolSummary); err != nil {
		t.Fatalf("read second streamlined_tool_use_summary failed: %v", err)
	}
	if secondStreamlinedToolSummary["type"] != "streamlined_tool_use_summary" || strings.TrimSpace(asString(secondStreamlinedToolSummary["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(secondStreamlinedToolSummary["tool_summary"])) != "Used echo 1 time" {
		t.Fatalf("unexpected second streamlined_tool_use_summary payload: %#v", secondStreamlinedToolSummary)
	}
	var secondResult map[string]any
	if err := ws.ReadJSON(&secondResult); err != nil {
		t.Fatalf("read second result event failed: %v", err)
	}
	if secondResult["type"] != "result" || strings.TrimSpace(asString(secondResult["subtype"])) != "success" || strings.TrimSpace(asString(secondResult["result"])) != "echo:hello again [approved]" {
		t.Fatalf("unexpected second result event: %#v", secondResult)
	}
	var secondPromptSuggestion map[string]any
	if err := ws.ReadJSON(&secondPromptSuggestion); err != nil {
		t.Fatalf("read second prompt_suggestion failed: %v", err)
	}
	if secondPromptSuggestion["type"] != "prompt_suggestion" || strings.TrimSpace(asString(secondPromptSuggestion["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(secondPromptSuggestion["suggestion"])) != "Try asking for another echo example" {
		t.Fatalf("unexpected second prompt_suggestion payload: %#v", secondPromptSuggestion)
	}
	var secondTaskNotification map[string]any
	if err := ws.ReadJSON(&secondTaskNotification); err != nil {
		t.Fatalf("read second task_notification failed: %v", err)
	}
	if secondTaskNotification["type"] != "system" || strings.TrimSpace(asString(secondTaskNotification["subtype"])) != "task_notification" || strings.TrimSpace(asString(secondTaskNotification["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second task_notification payload: %#v", secondTaskNotification)
	}
	secondTaskNotificationUsage, _ := secondTaskNotification["usage"].(map[string]any)
	if strings.TrimSpace(asString(secondTaskNotification["task_id"])) != strings.TrimSpace(asString(secondTaskStarted["task_id"])) || strings.TrimSpace(asString(secondTaskNotification["tool_use_id"])) != strings.TrimSpace(asString(secondRequest["tool_use_id"])) || strings.TrimSpace(asString(secondTaskNotification["status"])) != "completed" || strings.TrimSpace(asString(secondTaskNotification["output_file"])) == "" || strings.TrimSpace(asString(secondTaskNotification["summary"])) != "echo:hello again [approved]" || int(secondTaskNotificationUsage["tool_uses"].(float64)) != 1 {
		t.Fatalf("invalid second task_notification payload: %#v", secondTaskNotification)
	}
	var secondFilesPersisted map[string]any
	if err := ws.ReadJSON(&secondFilesPersisted); err != nil {
		t.Fatalf("read second files_persisted failed: %v", err)
	}
	if secondFilesPersisted["type"] != "system" || strings.TrimSpace(asString(secondFilesPersisted["subtype"])) != "files_persisted" || strings.TrimSpace(asString(secondFilesPersisted["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second files_persisted payload: %#v", secondFilesPersisted)
	}
	secondFilesPersistedFiles, _ := secondFilesPersisted["files"].([]any)
	secondFilesPersistedFailed, _ := secondFilesPersisted["failed"].([]any)
	if len(secondFilesPersistedFiles) != 1 || len(secondFilesPersistedFailed) != 0 || strings.TrimSpace(asString(secondFilesPersisted["processed_at"])) == "" {
		t.Fatalf("invalid second files_persisted payload: %#v", secondFilesPersisted)
	}
	secondFilesPersistedFile0, _ := secondFilesPersistedFiles[0].(map[string]any)
	if strings.TrimSpace(asString(secondFilesPersistedFile0["filename"])) == "" || strings.TrimSpace(asString(secondFilesPersistedFile0["file_id"])) == "" {
		t.Fatalf("invalid second files_persisted file payload: %#v", secondFilesPersisted)
	}
	var secondLocalCommandOutput map[string]any
	if err := ws.ReadJSON(&secondLocalCommandOutput); err != nil {
		t.Fatalf("read second local_command_output failed: %v", err)
	}
	if secondLocalCommandOutput["type"] != "system" || strings.TrimSpace(asString(secondLocalCommandOutput["subtype"])) != "local_command_output" || strings.TrimSpace(asString(secondLocalCommandOutput["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second local_command_output payload: %#v", secondLocalCommandOutput)
	}
	if strings.TrimSpace(asString(secondLocalCommandOutput["content"])) == "" {
		t.Fatalf("invalid second local_command_output payload: %#v", secondLocalCommandOutput)
	}
	var secondElicitationComplete map[string]any
	if err := ws.ReadJSON(&secondElicitationComplete); err != nil {
		t.Fatalf("read second elicitation_complete failed: %v", err)
	}
	if secondElicitationComplete["type"] != "system" || strings.TrimSpace(asString(secondElicitationComplete["subtype"])) != "elicitation_complete" || strings.TrimSpace(asString(secondElicitationComplete["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second elicitation_complete payload: %#v", secondElicitationComplete)
	}
	if strings.TrimSpace(asString(secondElicitationComplete["mcp_server_name"])) == "" || strings.TrimSpace(asString(secondElicitationComplete["elicitation_id"])) == "" {
		t.Fatalf("invalid second elicitation_complete payload: %#v", secondElicitationComplete)
	}
	var secondPostTurnSummary map[string]any
	if err := ws.ReadJSON(&secondPostTurnSummary); err != nil {
		t.Fatalf("read second post_turn_summary failed: %v", err)
	}
	if secondPostTurnSummary["type"] != "system" || strings.TrimSpace(asString(secondPostTurnSummary["subtype"])) != "post_turn_summary" || strings.TrimSpace(asString(secondPostTurnSummary["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second post_turn_summary payload: %#v", secondPostTurnSummary)
	}
	if strings.TrimSpace(asString(secondPostTurnSummary["summarizes_uuid"])) == "" || strings.TrimSpace(asString(secondPostTurnSummary["status_category"])) != "completed" || strings.TrimSpace(asString(secondPostTurnSummary["title"])) == "" || strings.TrimSpace(asString(secondPostTurnSummary["recent_action"])) == "" {
		t.Fatalf("invalid second post_turn_summary payload: %#v", secondPostTurnSummary)
	}
	var secondCompactingStatus map[string]any
	if err := ws.ReadJSON(&secondCompactingStatus); err != nil {
		t.Fatalf("read second compacting status failed: %v", err)
	}
	if secondCompactingStatus["type"] != "system" || strings.TrimSpace(asString(secondCompactingStatus["subtype"])) != "status" || strings.TrimSpace(asString(secondCompactingStatus["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(secondCompactingStatus["permissionMode"])) != "default" || strings.TrimSpace(asString(secondCompactingStatus["status"])) != "compacting" {
		t.Fatalf("unexpected second compacting status payload: %#v", secondCompactingStatus)
	}
	var secondCompactBoundary map[string]any
	if err := ws.ReadJSON(&secondCompactBoundary); err != nil {
		t.Fatalf("read second compact_boundary failed: %v", err)
	}
	if secondCompactBoundary["type"] != "system" || strings.TrimSpace(asString(secondCompactBoundary["subtype"])) != "compact_boundary" || strings.TrimSpace(asString(secondCompactBoundary["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second compact_boundary payload: %#v", secondCompactBoundary)
	}
	secondCompactMetadata, _ := secondCompactBoundary["compact_metadata"].(map[string]any)
	if strings.TrimSpace(asString(secondCompactMetadata["trigger"])) != "auto" || int(secondCompactMetadata["pre_tokens"].(float64)) != 128 {
		t.Fatalf("invalid second compact_boundary payload: %#v", secondCompactBoundary)
	}
	var secondCompactionDoneStatus map[string]any
	if err := ws.ReadJSON(&secondCompactionDoneStatus); err != nil {
		t.Fatalf("read second compaction-done status failed: %v", err)
	}
	if secondCompactionDoneStatus["type"] != "system" || strings.TrimSpace(asString(secondCompactionDoneStatus["subtype"])) != "status" || strings.TrimSpace(asString(secondCompactionDoneStatus["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(secondCompactionDoneStatus["permissionMode"])) != "default" {
		t.Fatalf("unexpected second compaction-done status payload: %#v", secondCompactionDoneStatus)
	}
	if status, ok := secondCompactionDoneStatus["status"]; !ok || status != nil {
		t.Fatalf("invalid second compaction-done status payload: %#v", secondCompactionDoneStatus)
	}
	var secondIdleState map[string]any
	if err := ws.ReadJSON(&secondIdleState); err != nil {
		t.Fatalf("read second idle session_state_changed failed: %v", err)
	}
	if secondIdleState["type"] != "system" || strings.TrimSpace(asString(secondIdleState["subtype"])) != "session_state_changed" || strings.TrimSpace(asString(secondIdleState["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(secondIdleState["state"])) != "idle" {
		t.Fatalf("unexpected second idle session_state_changed payload: %#v", secondIdleState)
	}
	var secondHookStarted map[string]any
	if err := ws.ReadJSON(&secondHookStarted); err != nil {
		t.Fatalf("read second hook_started failed: %v", err)
	}
	if secondHookStarted["type"] != "system" || strings.TrimSpace(asString(secondHookStarted["subtype"])) != "hook_started" || strings.TrimSpace(asString(secondHookStarted["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second hook_started payload: %#v", secondHookStarted)
	}
	if strings.TrimSpace(asString(secondHookStarted["hook_id"])) == "" || strings.TrimSpace(asString(secondHookStarted["hook_name"])) == "" || strings.TrimSpace(asString(secondHookStarted["hook_event"])) != "Stop" {
		t.Fatalf("invalid second hook_started payload: %#v", secondHookStarted)
	}
	var secondHookProgress map[string]any
	if err := ws.ReadJSON(&secondHookProgress); err != nil {
		t.Fatalf("read second hook_progress failed: %v", err)
	}
	if secondHookProgress["type"] != "system" || strings.TrimSpace(asString(secondHookProgress["subtype"])) != "hook_progress" || strings.TrimSpace(asString(secondHookProgress["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second hook_progress payload: %#v", secondHookProgress)
	}
	if strings.TrimSpace(asString(secondHookProgress["hook_id"])) == "" || strings.TrimSpace(asString(secondHookProgress["hook_name"])) == "" || strings.TrimSpace(asString(secondHookProgress["hook_event"])) != "Stop" || strings.TrimSpace(asString(secondHookProgress["output"])) == "" {
		t.Fatalf("invalid second hook_progress payload: %#v", secondHookProgress)
	}
	var secondHookResponse map[string]any
	if err := ws.ReadJSON(&secondHookResponse); err != nil {
		t.Fatalf("read second hook_response failed: %v", err)
	}
	if secondHookResponse["type"] != "system" || strings.TrimSpace(asString(secondHookResponse["subtype"])) != "hook_response" || strings.TrimSpace(asString(secondHookResponse["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second hook_response payload: %#v", secondHookResponse)
	}
	if strings.TrimSpace(asString(secondHookResponse["hook_id"])) == "" || strings.TrimSpace(asString(secondHookResponse["hook_name"])) == "" || strings.TrimSpace(asString(secondHookResponse["hook_event"])) != "Stop" || strings.TrimSpace(asString(secondHookResponse["outcome"])) != "success" {
		t.Fatalf("invalid second hook_response payload: %#v", secondHookResponse)
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

	var denyRunningState map[string]any
	if err := ws.ReadJSON(&denyRunningState); err != nil {
		t.Fatalf("read deny running session_state_changed failed: %v", err)
	}
	if denyRunningState["type"] != "system" || strings.TrimSpace(asString(denyRunningState["subtype"])) != "session_state_changed" || strings.TrimSpace(asString(denyRunningState["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(denyRunningState["state"])) != "running" {
		t.Fatalf("unexpected deny running session_state_changed payload: %#v", denyRunningState)
	}
	var denyRequiresActionState map[string]any
	if err := ws.ReadJSON(&denyRequiresActionState); err != nil {
		t.Fatalf("read deny requires_action session_state_changed failed: %v", err)
	}
	if denyRequiresActionState["type"] != "system" || strings.TrimSpace(asString(denyRequiresActionState["subtype"])) != "session_state_changed" || strings.TrimSpace(asString(denyRequiresActionState["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(denyRequiresActionState["state"])) != "requires_action" {
		t.Fatalf("unexpected deny requires_action session_state_changed payload: %#v", denyRequiresActionState)
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
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": []map[string]any{{"type": "text", "text": "hit max turns"}},
		},
	}); err != nil {
		t.Fatalf("write max-turns user message failed: %v", err)
	}

	var maxTurnsRunningState map[string]any
	if err := ws.ReadJSON(&maxTurnsRunningState); err != nil {
		t.Fatalf("read max-turns running session_state_changed failed: %v", err)
	}
	if maxTurnsRunningState["type"] != "system" || strings.TrimSpace(asString(maxTurnsRunningState["subtype"])) != "session_state_changed" || strings.TrimSpace(asString(maxTurnsRunningState["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(maxTurnsRunningState["state"])) != "running" {
		t.Fatalf("unexpected max-turns running session_state_changed payload: %#v", maxTurnsRunningState)
	}
	var maxTurnsRequiresActionState map[string]any
	if err := ws.ReadJSON(&maxTurnsRequiresActionState); err != nil {
		t.Fatalf("read max-turns requires_action session_state_changed failed: %v", err)
	}
	if maxTurnsRequiresActionState["type"] != "system" || strings.TrimSpace(asString(maxTurnsRequiresActionState["subtype"])) != "session_state_changed" || strings.TrimSpace(asString(maxTurnsRequiresActionState["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(maxTurnsRequiresActionState["state"])) != "requires_action" {
		t.Fatalf("unexpected max-turns requires_action session_state_changed payload: %#v", maxTurnsRequiresActionState)
	}

	var maxTurnsControlReq map[string]any
	if err := ws.ReadJSON(&maxTurnsControlReq); err != nil {
		t.Fatalf("read max-turns control request failed: %v", err)
	}
	if maxTurnsControlReq["type"] != "control_request" {
		t.Fatalf("unexpected max-turns control request: %#v", maxTurnsControlReq)
	}
	maxTurnsRequestID := maxTurnsControlReq["request_id"].(string)
	if err := ws.WriteJSON(map[string]any{
		"type": "control_response",
		"response": map[string]any{
			"subtype":    "success",
			"request_id": maxTurnsRequestID,
			"response": map[string]any{
				"behavior": "max_turns",
			},
		},
	}); err != nil {
		t.Fatalf("write max-turns control response failed: %v", err)
	}

	var maxTurnsResult map[string]any
	if err := ws.ReadJSON(&maxTurnsResult); err != nil {
		t.Fatalf("read max-turns result event failed: %v", err)
	}
	if maxTurnsResult["type"] != "result" || strings.TrimSpace(asString(maxTurnsResult["subtype"])) != "error_max_turns" {
		t.Fatalf("unexpected max-turns result event: %#v", maxTurnsResult)
	}
	if isError, ok := maxTurnsResult["is_error"].(bool); !ok || !isError {
		t.Fatalf("expected max-turns result is_error=true, got %#v", maxTurnsResult)
	}
	if int(maxTurnsResult["num_turns"].(float64)) != 2 {
		t.Fatalf("expected max-turns result num_turns=2, got %#v", maxTurnsResult)
	}
	if strings.TrimSpace(asString(maxTurnsResult["stop_reason"])) != "max_turns" {
		t.Fatalf("unexpected max-turns stop_reason: %#v", maxTurnsResult)
	}

	if err := ws.WriteJSON(map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": []map[string]any{{"type": "text", "text": "hit max budget usd"}},
		},
	}); err != nil {
		t.Fatalf("write max-budget-usd user message failed: %v", err)
	}

	var maxBudgetRunningState map[string]any
	if err := ws.ReadJSON(&maxBudgetRunningState); err != nil {
		t.Fatalf("read max-budget-usd running session_state_changed failed: %v", err)
	}
	if maxBudgetRunningState["type"] != "system" || strings.TrimSpace(asString(maxBudgetRunningState["subtype"])) != "session_state_changed" || strings.TrimSpace(asString(maxBudgetRunningState["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(maxBudgetRunningState["state"])) != "running" {
		t.Fatalf("unexpected max-budget-usd running session_state_changed payload: %#v", maxBudgetRunningState)
	}
	var maxBudgetRequiresActionState map[string]any
	if err := ws.ReadJSON(&maxBudgetRequiresActionState); err != nil {
		t.Fatalf("read max-budget-usd requires_action session_state_changed failed: %v", err)
	}
	if maxBudgetRequiresActionState["type"] != "system" || strings.TrimSpace(asString(maxBudgetRequiresActionState["subtype"])) != "session_state_changed" || strings.TrimSpace(asString(maxBudgetRequiresActionState["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(maxBudgetRequiresActionState["state"])) != "requires_action" {
		t.Fatalf("unexpected max-budget-usd requires_action session_state_changed payload: %#v", maxBudgetRequiresActionState)
	}

	var maxBudgetControlReq map[string]any
	if err := ws.ReadJSON(&maxBudgetControlReq); err != nil {
		t.Fatalf("read max-budget-usd control request failed: %v", err)
	}
	if maxBudgetControlReq["type"] != "control_request" {
		t.Fatalf("unexpected max-budget-usd control request: %#v", maxBudgetControlReq)
	}
	maxBudgetRequestID := maxBudgetControlReq["request_id"].(string)
	if err := ws.WriteJSON(map[string]any{
		"type": "control_response",
		"response": map[string]any{
			"subtype":    "success",
			"request_id": maxBudgetRequestID,
			"response": map[string]any{
				"behavior": "max_budget_usd",
			},
		},
	}); err != nil {
		t.Fatalf("write max-budget-usd control response failed: %v", err)
	}

	var maxBudgetResult map[string]any
	if err := ws.ReadJSON(&maxBudgetResult); err != nil {
		t.Fatalf("read max-budget-usd result event failed: %v", err)
	}
	if maxBudgetResult["type"] != "result" || strings.TrimSpace(asString(maxBudgetResult["subtype"])) != "error_max_budget_usd" {
		t.Fatalf("unexpected max-budget-usd result event: %#v", maxBudgetResult)
	}
	if isError, ok := maxBudgetResult["is_error"].(bool); !ok || !isError {
		t.Fatalf("expected max-budget-usd result is_error=true, got %#v", maxBudgetResult)
	}
	if int(maxBudgetResult["num_turns"].(float64)) != 2 {
		t.Fatalf("expected max-budget-usd result num_turns=2, got %#v", maxBudgetResult)
	}
	if strings.TrimSpace(asString(maxBudgetResult["stop_reason"])) != "max_budget_usd" {
		t.Fatalf("unexpected max-budget-usd stop_reason: %#v", maxBudgetResult)
	}

	if err := ws.WriteJSON(map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": []map[string]any{{"type": "text", "text": "hit max structured output retries"}},
		},
	}); err != nil {
		t.Fatalf("write max-structured-output-retries user message failed: %v", err)
	}

	var maxStructuredRunningState map[string]any
	if err := ws.ReadJSON(&maxStructuredRunningState); err != nil {
		t.Fatalf("read max-structured-output-retries running session_state_changed failed: %v", err)
	}
	if maxStructuredRunningState["type"] != "system" || strings.TrimSpace(asString(maxStructuredRunningState["subtype"])) != "session_state_changed" || strings.TrimSpace(asString(maxStructuredRunningState["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(maxStructuredRunningState["state"])) != "running" {
		t.Fatalf("unexpected max-structured-output-retries running session_state_changed payload: %#v", maxStructuredRunningState)
	}
	var maxStructuredRequiresActionState map[string]any
	if err := ws.ReadJSON(&maxStructuredRequiresActionState); err != nil {
		t.Fatalf("read max-structured-output-retries requires_action session_state_changed failed: %v", err)
	}
	if maxStructuredRequiresActionState["type"] != "system" || strings.TrimSpace(asString(maxStructuredRequiresActionState["subtype"])) != "session_state_changed" || strings.TrimSpace(asString(maxStructuredRequiresActionState["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(maxStructuredRequiresActionState["state"])) != "requires_action" {
		t.Fatalf("unexpected max-structured-output-retries requires_action session_state_changed payload: %#v", maxStructuredRequiresActionState)
	}

	var maxStructuredControlReq map[string]any
	if err := ws.ReadJSON(&maxStructuredControlReq); err != nil {
		t.Fatalf("read max-structured-output-retries control request failed: %v", err)
	}
	if maxStructuredControlReq["type"] != "control_request" {
		t.Fatalf("unexpected max-structured-output-retries control request: %#v", maxStructuredControlReq)
	}
	maxStructuredRequestID := maxStructuredControlReq["request_id"].(string)
	if err := ws.WriteJSON(map[string]any{
		"type": "control_response",
		"response": map[string]any{
			"subtype":    "success",
			"request_id": maxStructuredRequestID,
			"response": map[string]any{
				"behavior": "max_structured_output_retries",
			},
		},
	}); err != nil {
		t.Fatalf("write max-structured-output-retries control response failed: %v", err)
	}

	var maxStructuredResult map[string]any
	if err := ws.ReadJSON(&maxStructuredResult); err != nil {
		t.Fatalf("read max-structured-output-retries result event failed: %v", err)
	}
	if maxStructuredResult["type"] != "result" || strings.TrimSpace(asString(maxStructuredResult["subtype"])) != "error_max_structured_output_retries" {
		t.Fatalf("unexpected max-structured-output-retries result event: %#v", maxStructuredResult)
	}
	if isError, ok := maxStructuredResult["is_error"].(bool); !ok || !isError {
		t.Fatalf("expected max-structured-output-retries result is_error=true, got %#v", maxStructuredResult)
	}
	if int(maxStructuredResult["num_turns"].(float64)) != 2 {
		t.Fatalf("expected max-structured-output-retries result num_turns=2, got %#v", maxStructuredResult)
	}
	if strings.TrimSpace(asString(maxStructuredResult["stop_reason"])) != "max_structured_output_retries" {
		t.Fatalf("unexpected max-structured-output-retries stop_reason: %#v", maxStructuredResult)
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

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "set-model-1",
		"request": map[string]any{
			"subtype": "set_model",
			"model":   "claude-sonnet-4-5",
		},
	}); err != nil {
		t.Fatalf("write set_model request failed: %v", err)
	}
	var setModelResp map[string]any
	if err := ws.ReadJSON(&setModelResp); err != nil {
		t.Fatalf("read set_model response failed: %v", err)
	}
	if setModelResp["type"] != "control_response" {
		t.Fatalf("unexpected set_model response: %#v", setModelResp)
	}
	setModelResponse, _ := setModelResp["response"].(map[string]any)
	if strings.TrimSpace(asString(setModelResponse["request_id"])) != "set-model-1" {
		t.Fatalf("unexpected set_model request id: %#v", setModelResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "set-permission-mode-1",
		"request": map[string]any{
			"subtype": "set_permission_mode",
			"mode":    "acceptEdits",
		},
	}); err != nil {
		t.Fatalf("write set_permission_mode request failed: %v", err)
	}
	var setPermissionModeResp map[string]any
	if err := ws.ReadJSON(&setPermissionModeResp); err != nil {
		t.Fatalf("read set_permission_mode response failed: %v", err)
	}
	if setPermissionModeResp["type"] != "control_response" {
		t.Fatalf("unexpected set_permission_mode response: %#v", setPermissionModeResp)
	}
	setPermissionModeResponse, _ := setPermissionModeResp["response"].(map[string]any)
	if strings.TrimSpace(asString(setPermissionModeResponse["request_id"])) != "set-permission-mode-1" {
		t.Fatalf("unexpected set_permission_mode request id: %#v", setPermissionModeResp)
	}
	var statusTransitionEvent map[string]any
	if err := ws.ReadJSON(&statusTransitionEvent); err != nil {
		t.Fatalf("read set_permission_mode status transition failed: %v", err)
	}
	if statusTransitionEvent["type"] != "system" ||
		strings.TrimSpace(asString(statusTransitionEvent["subtype"])) != "status" ||
		strings.TrimSpace(asString(statusTransitionEvent["session_id"])) == "" ||
		strings.TrimSpace(asString(statusTransitionEvent["permissionMode"])) != "acceptEdits" ||
		strings.TrimSpace(asString(statusTransitionEvent["status"])) != "running" {
		t.Fatalf("unexpected set_permission_mode status transition: %#v", statusTransitionEvent)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "set-max-thinking-tokens-1",
		"request": map[string]any{
			"subtype":             "set_max_thinking_tokens",
			"max_thinking_tokens": 2048,
		},
	}); err != nil {
		t.Fatalf("write set_max_thinking_tokens request failed: %v", err)
	}
	var setMaxThinkingTokensResp map[string]any
	if err := ws.ReadJSON(&setMaxThinkingTokensResp); err != nil {
		t.Fatalf("read set_max_thinking_tokens response failed: %v", err)
	}
	if setMaxThinkingTokensResp["type"] != "control_response" {
		t.Fatalf("unexpected set_max_thinking_tokens response: %#v", setMaxThinkingTokensResp)
	}
	setMaxThinkingTokensResponse, _ := setMaxThinkingTokensResp["response"].(map[string]any)
	if strings.TrimSpace(asString(setMaxThinkingTokensResponse["request_id"])) != "set-max-thinking-tokens-1" {
		t.Fatalf("unexpected set_max_thinking_tokens request id: %#v", setMaxThinkingTokensResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "mcp-status-1",
		"request": map[string]any{
			"subtype": "mcp_status",
		},
	}); err != nil {
		t.Fatalf("write mcp_status request failed: %v", err)
	}
	var mcpStatusResp map[string]any
	if err := ws.ReadJSON(&mcpStatusResp); err != nil {
		t.Fatalf("read mcp_status response failed: %v", err)
	}
	if mcpStatusResp["type"] != "control_response" {
		t.Fatalf("unexpected mcp_status response: %#v", mcpStatusResp)
	}
	mcpStatusResponse, _ := mcpStatusResp["response"].(map[string]any)
	if strings.TrimSpace(asString(mcpStatusResponse["request_id"])) != "mcp-status-1" {
		t.Fatalf("unexpected mcp_status request id: %#v", mcpStatusResp)
	}
	mcpStatusPayload, _ := mcpStatusResponse["response"].(map[string]any)
	if mcpServers, ok := mcpStatusPayload["mcpServers"].([]any); !ok || len(mcpServers) != 0 {
		t.Fatalf("unexpected mcp_status payload: %#v", mcpStatusResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "get-context-usage-1",
		"request": map[string]any{
			"subtype": "get_context_usage",
		},
	}); err != nil {
		t.Fatalf("write get_context_usage request failed: %v", err)
	}
	var getContextUsageResp map[string]any
	if err := ws.ReadJSON(&getContextUsageResp); err != nil {
		t.Fatalf("read get_context_usage response failed: %v", err)
	}
	if getContextUsageResp["type"] != "control_response" {
		t.Fatalf("unexpected get_context_usage response: %#v", getContextUsageResp)
	}
	getContextUsageResponse, _ := getContextUsageResp["response"].(map[string]any)
	if strings.TrimSpace(asString(getContextUsageResponse["request_id"])) != "get-context-usage-1" {
		t.Fatalf("unexpected get_context_usage request id: %#v", getContextUsageResp)
	}
	getContextUsagePayload, _ := getContextUsageResponse["response"].(map[string]any)
	if _, ok := getContextUsagePayload["categories"].([]any); !ok {
		t.Fatalf("unexpected get_context_usage payload: %#v", getContextUsageResp)
	}
	if totalTokens, ok := getContextUsagePayload["totalTokens"].(float64); !ok || totalTokens != 0 {
		t.Fatalf("unexpected get_context_usage totalTokens: %#v", getContextUsageResp)
	}
	if maxTokens, ok := getContextUsagePayload["maxTokens"].(float64); !ok || maxTokens != 0 {
		t.Fatalf("unexpected get_context_usage maxTokens: %#v", getContextUsageResp)
	}
	if rawMaxTokens, ok := getContextUsagePayload["rawMaxTokens"].(float64); !ok || rawMaxTokens != 0 {
		t.Fatalf("unexpected get_context_usage rawMaxTokens: %#v", getContextUsageResp)
	}
	if percentage, ok := getContextUsagePayload["percentage"].(float64); !ok || percentage != 0 {
		t.Fatalf("unexpected get_context_usage totals: %#v", getContextUsageResp)
	}
	if _, ok := getContextUsagePayload["gridRows"].([]any); !ok {
		t.Fatalf("unexpected get_context_usage gridRows: %#v", getContextUsageResp)
	}
	if strings.TrimSpace(asString(getContextUsagePayload["model"])) == "" {
		t.Fatalf("unexpected get_context_usage model: %#v", getContextUsageResp)
	}
	if _, ok := getContextUsagePayload["memoryFiles"].([]any); !ok {
		t.Fatalf("unexpected get_context_usage memoryFiles: %#v", getContextUsageResp)
	}
	if _, ok := getContextUsagePayload["mcpTools"].([]any); !ok {
		t.Fatalf("unexpected get_context_usage mcpTools: %#v", getContextUsageResp)
	}
	if _, ok := getContextUsagePayload["agents"].([]any); !ok {
		t.Fatalf("unexpected get_context_usage agents: %#v", getContextUsageResp)
	}
	if isAutoCompactEnabled, ok := getContextUsagePayload["isAutoCompactEnabled"].(bool); !ok || isAutoCompactEnabled {
		t.Fatalf("unexpected get_context_usage isAutoCompactEnabled: %#v", getContextUsageResp)
	}
	if getContextUsagePayload["apiUsage"] != nil {
		t.Fatalf("unexpected get_context_usage apiUsage: %#v", getContextUsageResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "mcp-message-1",
		"request": map[string]any{
			"subtype":     "mcp_message",
			"server_name": "demo-mcp",
			"message": map[string]any{
				"jsonrpc": "2.0",
				"id":      "msg-1",
				"method":  "notifications/ping",
				"params":  map[string]any{"source": "direct-connect-validation"},
			},
		},
	}); err != nil {
		t.Fatalf("write mcp_message request failed: %v", err)
	}
	var mcpMessageResp map[string]any
	if err := ws.ReadJSON(&mcpMessageResp); err != nil {
		t.Fatalf("read mcp_message response failed: %v", err)
	}
	if mcpMessageResp["type"] != "control_response" {
		t.Fatalf("unexpected mcp_message response: %#v", mcpMessageResp)
	}
	mcpMessageResponse, _ := mcpMessageResp["response"].(map[string]any)
	if strings.TrimSpace(asString(mcpMessageResponse["request_id"])) != "mcp-message-1" {
		t.Fatalf("unexpected mcp_message request id: %#v", mcpMessageResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "mcp-set-servers-1",
		"request": map[string]any{
			"subtype": "mcp_set_servers",
			"servers": map[string]any{},
		},
	}); err != nil {
		t.Fatalf("write mcp_set_servers request failed: %v", err)
	}
	var mcpSetServersResp map[string]any
	if err := ws.ReadJSON(&mcpSetServersResp); err != nil {
		t.Fatalf("read mcp_set_servers response failed: %v", err)
	}
	if mcpSetServersResp["type"] != "control_response" {
		t.Fatalf("unexpected mcp_set_servers response: %#v", mcpSetServersResp)
	}
	mcpSetServersResponse, _ := mcpSetServersResp["response"].(map[string]any)
	if strings.TrimSpace(asString(mcpSetServersResponse["request_id"])) != "mcp-set-servers-1" {
		t.Fatalf("unexpected mcp_set_servers request id: %#v", mcpSetServersResp)
	}
	mcpSetServersPayload, _ := mcpSetServersResponse["response"].(map[string]any)
	added, _ := mcpSetServersPayload["added"].([]any)
	removed, _ := mcpSetServersPayload["removed"].([]any)
	errorsMap, _ := mcpSetServersPayload["errors"].(map[string]any)
	if len(added) != 0 || len(removed) != 0 || len(errorsMap) != 0 {
		t.Fatalf("unexpected mcp_set_servers payload: %#v", mcpSetServersResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "reload-plugins-1",
		"request": map[string]any{
			"subtype": "reload_plugins",
		},
	}); err != nil {
		t.Fatalf("write reload_plugins request failed: %v", err)
	}
	var reloadPluginsResp map[string]any
	if err := ws.ReadJSON(&reloadPluginsResp); err != nil {
		t.Fatalf("read reload_plugins response failed: %v", err)
	}
	if reloadPluginsResp["type"] != "control_response" {
		t.Fatalf("unexpected reload_plugins response: %#v", reloadPluginsResp)
	}
	reloadPluginsResponse, _ := reloadPluginsResp["response"].(map[string]any)
	if strings.TrimSpace(asString(reloadPluginsResponse["request_id"])) != "reload-plugins-1" {
		t.Fatalf("unexpected reload_plugins request id: %#v", reloadPluginsResp)
	}
	reloadPluginsPayload, _ := reloadPluginsResponse["response"].(map[string]any)
	commands, _ := reloadPluginsPayload["commands"].([]any)
	agents, _ := reloadPluginsPayload["agents"].([]any)
	plugins, _ := reloadPluginsPayload["plugins"].([]any)
	mcpServers, _ := reloadPluginsPayload["mcpServers"].([]any)
	if len(commands) != 0 || len(agents) != 0 || len(plugins) != 0 || len(mcpServers) != 0 || int(reloadPluginsPayload["error_count"].(float64)) != 0 {
		t.Fatalf("unexpected reload_plugins payload: %#v", reloadPluginsResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "mcp-reconnect-1",
		"request": map[string]any{
			"subtype":    "mcp_reconnect",
			"serverName": "demo-mcp",
		},
	}); err != nil {
		t.Fatalf("write mcp_reconnect request failed: %v", err)
	}
	var mcpReconnectResp map[string]any
	if err := ws.ReadJSON(&mcpReconnectResp); err != nil {
		t.Fatalf("read mcp_reconnect response failed: %v", err)
	}
	if mcpReconnectResp["type"] != "control_response" {
		t.Fatalf("unexpected mcp_reconnect response: %#v", mcpReconnectResp)
	}
	mcpReconnectResponse, _ := mcpReconnectResp["response"].(map[string]any)
	if strings.TrimSpace(asString(mcpReconnectResponse["request_id"])) != "mcp-reconnect-1" {
		t.Fatalf("unexpected mcp_reconnect request id: %#v", mcpReconnectResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "mcp-toggle-1",
		"request": map[string]any{
			"subtype":    "mcp_toggle",
			"serverName": "demo-mcp",
			"enabled":    true,
		},
	}); err != nil {
		t.Fatalf("write mcp_toggle request failed: %v", err)
	}
	var mcpToggleResp map[string]any
	if err := ws.ReadJSON(&mcpToggleResp); err != nil {
		t.Fatalf("read mcp_toggle response failed: %v", err)
	}
	if mcpToggleResp["type"] != "control_response" {
		t.Fatalf("unexpected mcp_toggle response: %#v", mcpToggleResp)
	}
	mcpToggleResponse, _ := mcpToggleResp["response"].(map[string]any)
	if strings.TrimSpace(asString(mcpToggleResponse["request_id"])) != "mcp-toggle-1" {
		t.Fatalf("unexpected mcp_toggle request id: %#v", mcpToggleResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "rewind-files-1",
		"request": map[string]any{
			"subtype":         "rewind_files",
			"user_message_id": "user-msg-1",
			"dry_run":         true,
		},
	}); err != nil {
		t.Fatalf("write rewind_files request failed: %v", err)
	}
	var rewindFilesResp map[string]any
	if err := ws.ReadJSON(&rewindFilesResp); err != nil {
		t.Fatalf("read rewind_files response failed: %v", err)
	}
	if rewindFilesResp["type"] != "control_response" {
		t.Fatalf("unexpected rewind_files response: %#v", rewindFilesResp)
	}
	rewindFilesResponse, _ := rewindFilesResp["response"].(map[string]any)
	if strings.TrimSpace(asString(rewindFilesResponse["request_id"])) != "rewind-files-1" {
		t.Fatalf("unexpected rewind_files request id: %#v", rewindFilesResp)
	}
	rewindFilesPayload, _ := rewindFilesResponse["response"].(map[string]any)
	if canRewind, ok := rewindFilesPayload["canRewind"].(bool); !ok || !canRewind {
		t.Fatalf("unexpected rewind_files canRewind payload: %#v", rewindFilesResp)
	}
	filesChanged, _ := rewindFilesPayload["filesChanged"].([]any)
	if len(filesChanged) != 1 || strings.TrimSpace(asString(filesChanged[0])) != "README.md" {
		t.Fatalf("unexpected rewind_files filesChanged payload: %#v", rewindFilesResp)
	}
	if int(rewindFilesPayload["insertions"].(float64)) != 1 || int(rewindFilesPayload["deletions"].(float64)) != 0 {
		t.Fatalf("unexpected rewind_files diff stats payload: %#v", rewindFilesResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "seed-read-state-1",
		"request": map[string]any{
			"subtype": "seed_read_state",
			"path":    "/tmp/missing.txt",
			"mtime":   123456789,
		},
	}); err != nil {
		t.Fatalf("write seed_read_state request failed: %v", err)
	}
	var seedReadStateResp map[string]any
	if err := ws.ReadJSON(&seedReadStateResp); err != nil {
		t.Fatalf("read seed_read_state response failed: %v", err)
	}
	if seedReadStateResp["type"] != "control_response" {
		t.Fatalf("unexpected seed_read_state response: %#v", seedReadStateResp)
	}
	seedReadStateResponse, _ := seedReadStateResp["response"].(map[string]any)
	if strings.TrimSpace(asString(seedReadStateResponse["request_id"])) != "seed-read-state-1" {
		t.Fatalf("unexpected seed_read_state request id: %#v", seedReadStateResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "cancel-async-message-1",
		"request": map[string]any{
			"subtype":      "cancel_async_message",
			"message_uuid": "async-msg-1",
		},
	}); err != nil {
		t.Fatalf("write cancel_async_message request failed: %v", err)
	}
	var cancelAsyncMessageResp map[string]any
	if err := ws.ReadJSON(&cancelAsyncMessageResp); err != nil {
		t.Fatalf("read cancel_async_message response failed: %v", err)
	}
	if cancelAsyncMessageResp["type"] != "control_response" {
		t.Fatalf("unexpected cancel_async_message response: %#v", cancelAsyncMessageResp)
	}
	cancelAsyncMessageResponse, _ := cancelAsyncMessageResp["response"].(map[string]any)
	if strings.TrimSpace(asString(cancelAsyncMessageResponse["request_id"])) != "cancel-async-message-1" {
		t.Fatalf("unexpected cancel_async_message request id: %#v", cancelAsyncMessageResp)
	}
	cancelAsyncMessagePayload, _ := cancelAsyncMessageResponse["response"].(map[string]any)
	if cancelled, ok := cancelAsyncMessagePayload["cancelled"].(bool); !ok || cancelled {
		t.Fatalf("unexpected cancel_async_message payload: %#v", cancelAsyncMessageResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "stop-task-1",
		"request": map[string]any{
			"subtype": "stop_task",
			"task_id": "task-1",
		},
	}); err != nil {
		t.Fatalf("write stop_task request failed: %v", err)
	}
	var stopTaskResp map[string]any
	if err := ws.ReadJSON(&stopTaskResp); err != nil {
		t.Fatalf("read stop_task response failed: %v", err)
	}
	if stopTaskResp["type"] != "control_response" {
		t.Fatalf("unexpected stop_task response: %#v", stopTaskResp)
	}
	stopTaskResponse, _ := stopTaskResp["response"].(map[string]any)
	if strings.TrimSpace(asString(stopTaskResponse["request_id"])) != "stop-task-1" {
		t.Fatalf("unexpected stop_task request id: %#v", stopTaskResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "apply-flag-settings-1",
		"request": map[string]any{
			"subtype": "apply_flag_settings",
			"settings": map[string]any{
				"model": "claude-sonnet-4-5",
			},
		},
	}); err != nil {
		t.Fatalf("write apply_flag_settings request failed: %v", err)
	}
	var applyFlagSettingsResp map[string]any
	if err := ws.ReadJSON(&applyFlagSettingsResp); err != nil {
		t.Fatalf("read apply_flag_settings response failed: %v", err)
	}
	if applyFlagSettingsResp["type"] != "control_response" {
		t.Fatalf("unexpected apply_flag_settings response: %#v", applyFlagSettingsResp)
	}
	applyFlagSettingsResponse, _ := applyFlagSettingsResp["response"].(map[string]any)
	if strings.TrimSpace(asString(applyFlagSettingsResponse["request_id"])) != "apply-flag-settings-1" {
		t.Fatalf("unexpected apply_flag_settings request id: %#v", applyFlagSettingsResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "get-settings-1",
		"request": map[string]any{
			"subtype": "get_settings",
		},
	}); err != nil {
		t.Fatalf("write get_settings request failed: %v", err)
	}
	var getSettingsResp map[string]any
	if err := ws.ReadJSON(&getSettingsResp); err != nil {
		t.Fatalf("read get_settings response failed: %v", err)
	}
	if getSettingsResp["type"] != "control_response" {
		t.Fatalf("unexpected get_settings response: %#v", getSettingsResp)
	}
	getSettingsResponse, _ := getSettingsResp["response"].(map[string]any)
	if strings.TrimSpace(asString(getSettingsResponse["request_id"])) != "get-settings-1" {
		t.Fatalf("unexpected get_settings request id: %#v", getSettingsResp)
	}
	getSettingsPayload, _ := getSettingsResponse["response"].(map[string]any)
	effective, ok := getSettingsPayload["effective"].(map[string]any)
	if !ok || len(effective) != 0 {
		t.Fatalf("unexpected get_settings effective payload: %#v", getSettingsResp)
	}
	sources, ok := getSettingsPayload["sources"].([]any)
	if !ok || len(sources) != 0 {
		t.Fatalf("unexpected get_settings sources payload: %#v", getSettingsResp)
	}
	applied, ok := getSettingsPayload["applied"].(map[string]any)
	if !ok || strings.TrimSpace(asString(applied["model"])) == "" || applied["effort"] != nil {
		t.Fatalf("unexpected get_settings applied payload: %#v", getSettingsResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "generate-session-title-1",
		"request": map[string]any{
			"subtype":     "generate_session_title",
			"description": "summarize this session",
			"persist":     false,
		},
	}); err != nil {
		t.Fatalf("write generate_session_title request failed: %v", err)
	}
	var generateSessionTitleResp map[string]any
	if err := ws.ReadJSON(&generateSessionTitleResp); err != nil {
		t.Fatalf("read generate_session_title response failed: %v", err)
	}
	if generateSessionTitleResp["type"] != "control_response" {
		t.Fatalf("unexpected generate_session_title response: %#v", generateSessionTitleResp)
	}
	generateSessionTitleResponse, _ := generateSessionTitleResp["response"].(map[string]any)
	if strings.TrimSpace(asString(generateSessionTitleResponse["request_id"])) != "generate-session-title-1" {
		t.Fatalf("unexpected generate_session_title request id: %#v", generateSessionTitleResp)
	}
	generateSessionTitlePayload, _ := generateSessionTitleResponse["response"].(map[string]any)
	if strings.TrimSpace(asString(generateSessionTitlePayload["title"])) == "" {
		t.Fatalf("unexpected generate_session_title payload: %#v", generateSessionTitleResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "side-question-1",
		"request": map[string]any{
			"subtype":  "side_question",
			"question": "what is the summary?",
		},
	}); err != nil {
		t.Fatalf("write side_question request failed: %v", err)
	}
	var sideQuestionResp map[string]any
	if err := ws.ReadJSON(&sideQuestionResp); err != nil {
		t.Fatalf("read side_question response failed: %v", err)
	}
	if sideQuestionResp["type"] != "control_response" {
		t.Fatalf("unexpected side_question response: %#v", sideQuestionResp)
	}
	sideQuestionResponse, _ := sideQuestionResp["response"].(map[string]any)
	if strings.TrimSpace(asString(sideQuestionResponse["request_id"])) != "side-question-1" {
		t.Fatalf("unexpected side_question request id: %#v", sideQuestionResp)
	}
	sideQuestionPayload, _ := sideQuestionResponse["response"].(map[string]any)
	if strings.TrimSpace(asString(sideQuestionPayload["response"])) == "" {
		t.Fatalf("unexpected side_question payload: %#v", sideQuestionResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "initialize-1",
		"request": map[string]any{
			"subtype": "initialize",
		},
	}); err != nil {
		t.Fatalf("write initialize request failed: %v", err)
	}
	var initializeResp map[string]any
	if err := ws.ReadJSON(&initializeResp); err != nil {
		t.Fatalf("read initialize response failed: %v", err)
	}
	if initializeResp["type"] != "control_response" {
		t.Fatalf("unexpected initialize response: %#v", initializeResp)
	}
	initializeResponse, _ := initializeResp["response"].(map[string]any)
	if strings.TrimSpace(asString(initializeResponse["request_id"])) != "initialize-1" {
		t.Fatalf("unexpected initialize request id: %#v", initializeResp)
	}
	initializePayload, _ := initializeResponse["response"].(map[string]any)
	availableOutputStyles, _ := initializePayload["available_output_styles"].([]any)
	if _, ok := initializePayload["commands"].([]any); !ok || len(availableOutputStyles) == 0 || strings.TrimSpace(asString(initializePayload["output_style"])) == "" {
		t.Fatalf("unexpected initialize payload: %#v", initializeResp)
	}
	accountPayload, _ := initializePayload["account"].(map[string]any)
	if strings.TrimSpace(asString(accountPayload["apiProvider"])) == "" || strings.TrimSpace(asString(accountPayload["tokenSource"])) == "" || strings.TrimSpace(asString(accountPayload["apiKeySource"])) == "" {
		t.Fatalf("unexpected initialize account payload: %#v", initializeResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "elicitation-1",
		"request": map[string]any{
			"subtype":          "elicitation",
			"mcp_server_name":  "demo-mcp",
			"message":          "Need more input",
			"mode":             "form",
			"elicitation_id":   "eli-1",
			"requested_schema": map[string]any{"type": "object"},
		},
	}); err != nil {
		t.Fatalf("write elicitation request failed: %v", err)
	}
	var elicitationResp map[string]any
	if err := ws.ReadJSON(&elicitationResp); err != nil {
		t.Fatalf("read elicitation response failed: %v", err)
	}
	if elicitationResp["type"] != "control_response" {
		t.Fatalf("unexpected elicitation response: %#v", elicitationResp)
	}
	elicitationResponse, _ := elicitationResp["response"].(map[string]any)
	if strings.TrimSpace(asString(elicitationResponse["request_id"])) != "elicitation-1" {
		t.Fatalf("unexpected elicitation request id: %#v", elicitationResp)
	}
	elicitationPayload, _ := elicitationResponse["response"].(map[string]any)
	if strings.TrimSpace(asString(elicitationPayload["action"])) != "cancel" {
		t.Fatalf("unexpected elicitation payload: %#v", elicitationResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "hook-callback-1",
		"request": map[string]any{
			"subtype":     "hook_callback",
			"callback_id": "cb-1",
			"tool_use_id": "tool-1",
			"input": map[string]any{
				"session_id":        parsed["session_id"],
				"transcript_path":   "/tmp/direct-connect-transcript.jsonl",
				"cwd":               parsed["work_dir"],
				"hook_event_name":   "Notification",
				"message":           "direct-connect hook callback",
				"notification_type": "info",
			},
		},
	}); err != nil {
		t.Fatalf("write hook_callback request failed: %v", err)
	}
	var hookCallbackResp map[string]any
	if err := ws.ReadJSON(&hookCallbackResp); err != nil {
		t.Fatalf("read hook_callback response failed: %v", err)
	}
	if hookCallbackResp["type"] != "control_response" {
		t.Fatalf("unexpected hook_callback response: %#v", hookCallbackResp)
	}
	hookCallbackResponse, _ := hookCallbackResp["response"].(map[string]any)
	if strings.TrimSpace(asString(hookCallbackResponse["request_id"])) != "hook-callback-1" {
		t.Fatalf("unexpected hook_callback request id: %#v", hookCallbackResp)
	}
	if strings.TrimSpace(asString(hookCallbackResponse["subtype"])) != "success" {
		t.Fatalf("unexpected hook_callback response subtype: %#v", hookCallbackResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "channel-enable-1",
		"request": map[string]any{
			"subtype":    "channel_enable",
			"serverName": "demo-mcp",
		},
	}); err != nil {
		t.Fatalf("write channel_enable request failed: %v", err)
	}
	var channelEnableResp map[string]any
	if err := ws.ReadJSON(&channelEnableResp); err != nil {
		t.Fatalf("read channel_enable response failed: %v", err)
	}
	if channelEnableResp["type"] != "control_response" {
		t.Fatalf("unexpected channel_enable response: %#v", channelEnableResp)
	}
	channelEnableResponse, _ := channelEnableResp["response"].(map[string]any)
	if strings.TrimSpace(asString(channelEnableResponse["request_id"])) != "channel-enable-1" {
		t.Fatalf("unexpected channel_enable request id: %#v", channelEnableResp)
	}
	if strings.TrimSpace(asString(channelEnableResponse["subtype"])) != "success" {
		t.Fatalf("unexpected channel_enable response subtype: %#v", channelEnableResp)
	}
	channelEnablePayload, _ := channelEnableResponse["response"].(map[string]any)
	if strings.TrimSpace(asString(channelEnablePayload["serverName"])) != "demo-mcp" {
		t.Fatalf("unexpected channel_enable payload: %#v", channelEnableResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "mcp-auth-missing-1",
		"request": map[string]any{
			"subtype":    "mcp_authenticate",
			"serverName": "missing-mcp",
		},
	}); err != nil {
		t.Fatalf("write mcp_authenticate missing request failed: %v", err)
	}
	var mcpAuthMissingResp map[string]any
	if err := ws.ReadJSON(&mcpAuthMissingResp); err != nil {
		t.Fatalf("read mcp_authenticate missing response failed: %v", err)
	}
	if mcpAuthMissingResp["type"] != "control_response" {
		t.Fatalf("unexpected mcp_authenticate missing response: %#v", mcpAuthMissingResp)
	}
	mcpAuthMissingResponse, _ := mcpAuthMissingResp["response"].(map[string]any)
	if strings.TrimSpace(asString(mcpAuthMissingResponse["request_id"])) != "mcp-auth-missing-1" {
		t.Fatalf("unexpected mcp_authenticate missing request id: %#v", mcpAuthMissingResp)
	}
	if strings.TrimSpace(asString(mcpAuthMissingResponse["subtype"])) != "error" {
		t.Fatalf("unexpected mcp_authenticate missing subtype: %#v", mcpAuthMissingResp)
	}
	if strings.TrimSpace(asString(mcpAuthMissingResponse["error"])) != "Server not found: missing-mcp" {
		t.Fatalf("unexpected mcp_authenticate missing error: %#v", mcpAuthMissingResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "mcp-auth-unsupported-1",
		"request": map[string]any{
			"subtype":    "mcp_authenticate",
			"serverName": "demo-stdio-mcp",
		},
	}); err != nil {
		t.Fatalf("write mcp_authenticate unsupported request failed: %v", err)
	}
	var mcpAuthUnsupportedResp map[string]any
	if err := ws.ReadJSON(&mcpAuthUnsupportedResp); err != nil {
		t.Fatalf("read mcp_authenticate unsupported response failed: %v", err)
	}
	if mcpAuthUnsupportedResp["type"] != "control_response" {
		t.Fatalf("unexpected mcp_authenticate unsupported response: %#v", mcpAuthUnsupportedResp)
	}
	mcpAuthUnsupportedResponse, _ := mcpAuthUnsupportedResp["response"].(map[string]any)
	if strings.TrimSpace(asString(mcpAuthUnsupportedResponse["request_id"])) != "mcp-auth-unsupported-1" {
		t.Fatalf("unexpected mcp_authenticate unsupported request id: %#v", mcpAuthUnsupportedResp)
	}
	if strings.TrimSpace(asString(mcpAuthUnsupportedResponse["subtype"])) != "error" {
		t.Fatalf("unexpected mcp_authenticate unsupported subtype: %#v", mcpAuthUnsupportedResp)
	}
	if strings.TrimSpace(asString(mcpAuthUnsupportedResponse["error"])) != `Server type "stdio" does not support OAuth authentication` {
		t.Fatalf("unexpected mcp_authenticate unsupported error: %#v", mcpAuthUnsupportedResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "mcp-auth-success-1",
		"request": map[string]any{
			"subtype":    "mcp_authenticate",
			"serverName": "demo-http-mcp",
		},
	}); err != nil {
		t.Fatalf("write mcp_authenticate success request failed: %v", err)
	}
	var mcpAuthSuccessResp map[string]any
	if err := ws.ReadJSON(&mcpAuthSuccessResp); err != nil {
		t.Fatalf("read mcp_authenticate success response failed: %v", err)
	}
	if mcpAuthSuccessResp["type"] != "control_response" {
		t.Fatalf("unexpected mcp_authenticate success response: %#v", mcpAuthSuccessResp)
	}
	mcpAuthSuccessResponse, _ := mcpAuthSuccessResp["response"].(map[string]any)
	if strings.TrimSpace(asString(mcpAuthSuccessResponse["request_id"])) != "mcp-auth-success-1" {
		t.Fatalf("unexpected mcp_authenticate success request id: %#v", mcpAuthSuccessResp)
	}
	if strings.TrimSpace(asString(mcpAuthSuccessResponse["subtype"])) != "success" {
		t.Fatalf("unexpected mcp_authenticate success subtype: %#v", mcpAuthSuccessResp)
	}
	mcpAuthSuccessPayload, _ := mcpAuthSuccessResponse["response"].(map[string]any)
	if requiresUserAction, ok := mcpAuthSuccessPayload["requiresUserAction"].(bool); !ok || !requiresUserAction {
		t.Fatalf("unexpected mcp_authenticate success payload: %#v", mcpAuthSuccessResp)
	}
	if strings.TrimSpace(asString(mcpAuthSuccessPayload["authUrl"])) != "https://example.test/oauth/demo-http-mcp" {
		t.Fatalf("unexpected mcp_authenticate success authUrl: %#v", mcpAuthSuccessResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "mcp-oauth-callback-missing-flow-1",
		"request": map[string]any{
			"subtype":     "mcp_oauth_callback_url",
			"serverName":  "demo-sse-mcp",
			"callbackUrl": "https://example.test/callback?code=demo-code",
		},
	}); err != nil {
		t.Fatalf("write mcp_oauth_callback_url missing-flow request failed: %v", err)
	}
	var mcpOAuthMissingFlowResp map[string]any
	if err := ws.ReadJSON(&mcpOAuthMissingFlowResp); err != nil {
		t.Fatalf("read mcp_oauth_callback_url missing-flow response failed: %v", err)
	}
	if mcpOAuthMissingFlowResp["type"] != "control_response" {
		t.Fatalf("unexpected mcp_oauth_callback_url missing-flow response: %#v", mcpOAuthMissingFlowResp)
	}
	mcpOAuthMissingFlowResponse, _ := mcpOAuthMissingFlowResp["response"].(map[string]any)
	if strings.TrimSpace(asString(mcpOAuthMissingFlowResponse["request_id"])) != "mcp-oauth-callback-missing-flow-1" {
		t.Fatalf("unexpected mcp_oauth_callback_url missing-flow request id: %#v", mcpOAuthMissingFlowResp)
	}
	if strings.TrimSpace(asString(mcpOAuthMissingFlowResponse["subtype"])) != "error" {
		t.Fatalf("unexpected mcp_oauth_callback_url missing-flow subtype: %#v", mcpOAuthMissingFlowResp)
	}
	if strings.TrimSpace(asString(mcpOAuthMissingFlowResponse["error"])) != "No active OAuth flow for server: demo-sse-mcp" {
		t.Fatalf("unexpected mcp_oauth_callback_url missing-flow error: %#v", mcpOAuthMissingFlowResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "mcp-auth-callback-invalid-prep-1",
		"request": map[string]any{
			"subtype":    "mcp_authenticate",
			"serverName": "demo-sse-mcp",
		},
	}); err != nil {
		t.Fatalf("write mcp_authenticate callback-invalid prep request failed: %v", err)
	}
	var mcpAuthCallbackInvalidPrepResp map[string]any
	if err := ws.ReadJSON(&mcpAuthCallbackInvalidPrepResp); err != nil {
		t.Fatalf("read mcp_authenticate callback-invalid prep response failed: %v", err)
	}
	mcpAuthCallbackInvalidPrepResponse, _ := mcpAuthCallbackInvalidPrepResp["response"].(map[string]any)
	if strings.TrimSpace(asString(mcpAuthCallbackInvalidPrepResponse["subtype"])) != "success" {
		t.Fatalf("unexpected mcp_authenticate callback-invalid prep response: %#v", mcpAuthCallbackInvalidPrepResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "mcp-oauth-callback-invalid-1",
		"request": map[string]any{
			"subtype":     "mcp_oauth_callback_url",
			"serverName":  "demo-sse-mcp",
			"callbackUrl": "https://example.test/callback?state=demo-state",
		},
	}); err != nil {
		t.Fatalf("write mcp_oauth_callback_url invalid request failed: %v", err)
	}
	var mcpOAuthInvalidResp map[string]any
	if err := ws.ReadJSON(&mcpOAuthInvalidResp); err != nil {
		t.Fatalf("read mcp_oauth_callback_url invalid response failed: %v", err)
	}
	if mcpOAuthInvalidResp["type"] != "control_response" {
		t.Fatalf("unexpected mcp_oauth_callback_url invalid response: %#v", mcpOAuthInvalidResp)
	}
	mcpOAuthInvalidResponse, _ := mcpOAuthInvalidResp["response"].(map[string]any)
	if strings.TrimSpace(asString(mcpOAuthInvalidResponse["request_id"])) != "mcp-oauth-callback-invalid-1" {
		t.Fatalf("unexpected mcp_oauth_callback_url invalid request id: %#v", mcpOAuthInvalidResp)
	}
	if strings.TrimSpace(asString(mcpOAuthInvalidResponse["subtype"])) != "error" {
		t.Fatalf("unexpected mcp_oauth_callback_url invalid subtype: %#v", mcpOAuthInvalidResp)
	}
	if strings.TrimSpace(asString(mcpOAuthInvalidResponse["error"])) != "Invalid callback URL: missing authorization code. Please paste the full redirect URL including the code parameter." {
		t.Fatalf("unexpected mcp_oauth_callback_url invalid error: %#v", mcpOAuthInvalidResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "mcp-oauth-callback-success-1",
		"request": map[string]any{
			"subtype":     "mcp_oauth_callback_url",
			"serverName":  "demo-sse-mcp",
			"callbackUrl": "https://example.test/callback?code=demo-code&state=demo-state",
		},
	}); err != nil {
		t.Fatalf("write mcp_oauth_callback_url success request failed: %v", err)
	}
	var mcpOAuthSuccessResp map[string]any
	if err := ws.ReadJSON(&mcpOAuthSuccessResp); err != nil {
		t.Fatalf("read mcp_oauth_callback_url success response failed: %v", err)
	}
	if mcpOAuthSuccessResp["type"] != "control_response" {
		t.Fatalf("unexpected mcp_oauth_callback_url success response: %#v", mcpOAuthSuccessResp)
	}
	mcpOAuthSuccessResponse, _ := mcpOAuthSuccessResp["response"].(map[string]any)
	if strings.TrimSpace(asString(mcpOAuthSuccessResponse["request_id"])) != "mcp-oauth-callback-success-1" {
		t.Fatalf("unexpected mcp_oauth_callback_url success request id: %#v", mcpOAuthSuccessResp)
	}
	if strings.TrimSpace(asString(mcpOAuthSuccessResponse["subtype"])) != "success" {
		t.Fatalf("unexpected mcp_oauth_callback_url success subtype: %#v", mcpOAuthSuccessResp)
	}
	mcpOAuthSuccessPayload, _ := mcpOAuthSuccessResponse["response"].(map[string]any)
	if len(mcpOAuthSuccessPayload) != 0 {
		t.Fatalf("unexpected mcp_oauth_callback_url success payload: %#v", mcpOAuthSuccessResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "set-proactive-1",
		"request": map[string]any{
			"subtype": "set_proactive",
			"enabled": true,
		},
	}); err != nil {
		t.Fatalf("write set_proactive request failed: %v", err)
	}
	var setProactiveResp map[string]any
	if err := ws.ReadJSON(&setProactiveResp); err != nil {
		t.Fatalf("read set_proactive response failed: %v", err)
	}
	if setProactiveResp["type"] != "control_response" {
		t.Fatalf("unexpected set_proactive response: %#v", setProactiveResp)
	}
	setProactiveResponse, _ := setProactiveResp["response"].(map[string]any)
	if strings.TrimSpace(asString(setProactiveResponse["request_id"])) != "set-proactive-1" {
		t.Fatalf("unexpected set_proactive request id: %#v", setProactiveResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "remote-control-enable-1",
		"request": map[string]any{
			"subtype": "remote_control",
			"enabled": true,
		},
	}); err != nil {
		t.Fatalf("write remote_control enable request failed: %v", err)
	}
	var bridgeStateEnable map[string]any
	if err := ws.ReadJSON(&bridgeStateEnable); err != nil {
		t.Fatalf("read bridge_state enable event failed: %v", err)
	}
	if bridgeStateEnable["type"] != "system" || strings.TrimSpace(asString(bridgeStateEnable["subtype"])) != "bridge_state" || strings.TrimSpace(asString(bridgeStateEnable["state"])) != "connected" || strings.TrimSpace(asString(bridgeStateEnable["detail"])) != "stub remote control enabled" {
		t.Fatalf("unexpected bridge_state enable event: %#v", bridgeStateEnable)
	}
	var remoteControlEnableResp map[string]any
	if err := ws.ReadJSON(&remoteControlEnableResp); err != nil {
		t.Fatalf("read remote_control enable response failed: %v", err)
	}
	if remoteControlEnableResp["type"] != "control_response" {
		t.Fatalf("unexpected remote_control enable response: %#v", remoteControlEnableResp)
	}
	remoteControlEnableResponse, _ := remoteControlEnableResp["response"].(map[string]any)
	if strings.TrimSpace(asString(remoteControlEnableResponse["request_id"])) != "remote-control-enable-1" {
		t.Fatalf("unexpected remote_control enable request id: %#v", remoteControlEnableResp)
	}
	remoteControlEnablePayload, _ := remoteControlEnableResponse["response"].(map[string]any)
	if strings.TrimSpace(asString(remoteControlEnablePayload["session_url"])) == "" || strings.TrimSpace(asString(remoteControlEnablePayload["connect_url"])) == "" || strings.TrimSpace(asString(remoteControlEnablePayload["environment_id"])) == "" {
		t.Fatalf("unexpected remote_control enable payload: %#v", remoteControlEnableResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "remote-control-disable-1",
		"request": map[string]any{
			"subtype": "remote_control",
			"enabled": false,
		},
	}); err != nil {
		t.Fatalf("write remote_control disable request failed: %v", err)
	}
	var bridgeStateDisable map[string]any
	if err := ws.ReadJSON(&bridgeStateDisable); err != nil {
		t.Fatalf("read bridge_state disable event failed: %v", err)
	}
	if bridgeStateDisable["type"] != "system" || strings.TrimSpace(asString(bridgeStateDisable["subtype"])) != "bridge_state" || strings.TrimSpace(asString(bridgeStateDisable["state"])) != "disconnected" || strings.TrimSpace(asString(bridgeStateDisable["detail"])) != "stub remote control disabled" {
		t.Fatalf("unexpected bridge_state disable event: %#v", bridgeStateDisable)
	}
	var remoteControlDisableResp map[string]any
	if err := ws.ReadJSON(&remoteControlDisableResp); err != nil {
		t.Fatalf("read remote_control disable response failed: %v", err)
	}
	if remoteControlDisableResp["type"] != "control_response" {
		t.Fatalf("unexpected remote_control disable response: %#v", remoteControlDisableResp)
	}
	remoteControlDisableResponse, _ := remoteControlDisableResp["response"].(map[string]any)
	if strings.TrimSpace(asString(remoteControlDisableResponse["request_id"])) != "remote-control-disable-1" {
		t.Fatalf("unexpected remote_control disable request id: %#v", remoteControlDisableResp)
	}
	remoteControlDisablePayload, _ := remoteControlDisableResponse["response"].(map[string]any)
	if strings.TrimSpace(asString(remoteControlDisablePayload["session_url"])) != "" || strings.TrimSpace(asString(remoteControlDisablePayload["connect_url"])) != "" || strings.TrimSpace(asString(remoteControlDisablePayload["environment_id"])) != "" {
		t.Fatalf("unexpected remote_control disable payload: %#v", remoteControlDisableResp)
	}

	if err := ws.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": "end-session-1",
		"request": map[string]any{
			"subtype": "end_session",
			"reason":  "test shutdown",
		},
	}); err != nil {
		t.Fatalf("write end_session request failed: %v", err)
	}
	var endSessionResp map[string]any
	if err := ws.ReadJSON(&endSessionResp); err != nil {
		t.Fatalf("read end_session response failed: %v", err)
	}
	if endSessionResp["type"] != "control_response" {
		t.Fatalf("unexpected end_session response: %#v", endSessionResp)
	}
	response, _ := endSessionResp["response"].(map[string]any)
	if strings.TrimSpace(asString(response["request_id"])) != "end-session-1" {
		t.Fatalf("unexpected end_session request id: %#v", endSessionResp)
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

func TestDeleteSessionStopsBackendAndReleasesCapacity(t *testing.T) {
	lockfile := filepath.Join(t.TempDir(), "server.lock.json")
	sessionIndex := filepath.Join(t.TempDir(), "sessions.json")
	t.Setenv("CLAUDE_CODE_GO_SERVER_LOCKFILE", lockfile)
	t.Setenv("CLAUDE_CODE_GO_SERVER_SESSION_INDEX", sessionIndex)

	running, err := Start([]string{
		"--host", "127.0.0.1",
		"--port", "0",
		"--auth-token", "demo-token",
		"--max-sessions", "1",
	})
	if err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	defer func() {
		if err := running.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	}()

	createReq, err := http.NewRequest(http.MethodPost, running.Result.SessionsEndpoint, bytes.NewBufferString(`{"cwd":"/tmp/delete-me"}`))
	if err != nil {
		t.Fatalf("NewRequest returned error: %v", err)
	}
	createReq.Header.Set("Authorization", "Bearer demo-token")
	createReq.Header.Set("Content-Type", "application/json")
	createResp, err := http.DefaultClient.Do(createReq)
	if err != nil {
		t.Fatalf("create session failed: %v", err)
	}
	defer createResp.Body.Close()
	var created map[string]string
	if err := json.NewDecoder(createResp.Body).Decode(&created); err != nil {
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

	deleteReq, err := http.NewRequest(http.MethodDelete, strings.TrimRight(running.Result.SessionsEndpoint, "/")+"/"+created["session_id"], nil)
	if err != nil {
		t.Fatalf("build delete request: %v", err)
	}
	deleteReq.Header.Set("Authorization", "Bearer demo-token")
	deleteResp, err := http.DefaultClient.Do(deleteReq)
	if err != nil {
		t.Fatalf("delete session failed: %v", err)
	}
	defer deleteResp.Body.Close()
	if deleteResp.StatusCode != http.StatusOK {
		t.Fatalf("expected delete to succeed, got %s", deleteResp.Status)
	}
	var stopped sessionStateResponse
	if err := json.NewDecoder(deleteResp.Body).Decode(&stopped); err != nil {
		t.Fatalf("decode delete response: %v", err)
	}
	if stopped.Status != "stopped" || stopped.BackendStatus != "stopped" || stopped.BackendPID <= 0 || stopped.BackendStoppedAt <= 0 {
		t.Fatalf("expected stopped lifecycle in delete response, got %#v", stopped)
	}

	replacementReq, err := http.NewRequest(http.MethodPost, running.Result.SessionsEndpoint, bytes.NewBufferString(`{"cwd":"/tmp/replacement"}`))
	if err != nil {
		t.Fatalf("build replacement request: %v", err)
	}
	replacementReq.Header.Set("Authorization", "Bearer demo-token")
	replacementReq.Header.Set("Content-Type", "application/json")
	replacementResp, err := http.DefaultClient.Do(replacementReq)
	if err != nil {
		t.Fatalf("create replacement session failed: %v", err)
	}
	defer replacementResp.Body.Close()
	if replacementResp.StatusCode != http.StatusOK {
		t.Fatalf("expected replacement session create to succeed, got %s", replacementResp.Status)
	}

	state := fetchSessionState(t, running.Result.SessionsEndpoint, created["session_id"], "demo-token")
	if state.Status != "stopped" || state.BackendStatus != "stopped" {
		t.Fatalf("expected persisted stopped state after delete, got %#v", state)
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
	for i, subtype := range []string{"init", "", "status"} {
		var event map[string]any
		if err := ws.ReadJSON(&event); err != nil {
			t.Fatalf("read initial event %d failed: %v", i, err)
		}
		if subtype == "" {
			if event["type"] != "auth_status" {
				t.Fatalf("unexpected auth event: %#v", event)
			}
			continue
		}
		if event["type"] != "system" || strings.TrimSpace(asString(event["subtype"])) != subtype {
			t.Fatalf("unexpected system event: %#v", event)
		}
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
			"content": []map[string]any{{"type": "text", "text": "resume replay seed"}},
		},
	}); err != nil {
		t.Fatalf("write replay seed user failed: %v", err)
	}
	var runningState map[string]any
	if err := ws.ReadJSON(&runningState); err != nil {
		t.Fatalf("read seed running state failed: %v", err)
	}
	var requiresActionState map[string]any
	if err := ws.ReadJSON(&requiresActionState); err != nil {
		t.Fatalf("read seed requires_action state failed: %v", err)
	}
	var controlReq map[string]any
	if err := ws.ReadJSON(&controlReq); err != nil {
		t.Fatalf("read seed control request failed: %v", err)
	}
	requestID := strings.TrimSpace(asString(controlReq["request_id"]))
	if requestID == "" {
		t.Fatalf("missing seed control request id: %#v", controlReq)
	}
	if err := ws.WriteJSON(map[string]any{
		"type": "control_response",
		"response": map[string]any{
			"subtype":    "success",
			"request_id": requestID,
			"response": map[string]any{
				"behavior": "allow",
				"updatedInput": map[string]any{
					"text": "resume replay seed [approved]",
				},
			},
		},
	}); err != nil {
		t.Fatalf("write seed control response failed: %v", err)
	}
	for i := 0; i < 32; i++ {
		var event map[string]any
		if err := ws.ReadJSON(&event); err != nil {
			t.Fatalf("read seed completion event %d failed: %v", i, err)
		}
		if event["type"] == "system" && strings.TrimSpace(asString(event["subtype"])) == "hook_response" {
			break
		}
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
	for i, subtype := range []string{"init", "", "status"} {
		var event map[string]any
		if err := ws.ReadJSON(&event); err != nil {
			t.Fatalf("read resumed initial event %d failed: %v", i, err)
		}
		if subtype == "" {
			if event["type"] != "auth_status" {
				t.Fatalf("unexpected resumed auth event: %#v", event)
			}
			continue
		}
		if event["type"] != "system" || strings.TrimSpace(asString(event["subtype"])) != subtype {
			t.Fatalf("unexpected resumed system event: %#v", event)
		}
	}
	if err := ws.ReadJSON(&keepAlive); err != nil {
		t.Fatalf("read resumed keep_alive failed: %v", err)
	}
	if keepAlive["type"] != "keep_alive" {
		t.Fatalf("unexpected resumed keep_alive event: %#v", keepAlive)
	}
	var replayedUser map[string]any
	if err := ws.ReadJSON(&replayedUser); err != nil {
		t.Fatalf("read replayed user failed: %v", err)
	}
	if replayedUser["type"] != "user" || replayedUser["isReplay"] != true || strings.TrimSpace(asString(replayedUser["session_id"])) != created["session_id"] || strings.TrimSpace(asString(replayedUser["uuid"])) == "" {
		t.Fatalf("unexpected replayed user payload: %#v", replayedUser)
	}
	message, _ := replayedUser["message"].(map[string]any)
	if strings.TrimSpace(asString(message["role"])) != "user" || extractPromptText(replayedUser) != "resume replay seed" {
		t.Fatalf("unexpected replayed user message payload: %#v", replayedUser)
	}
	var replayedToolResult map[string]any
	if err := ws.ReadJSON(&replayedToolResult); err != nil {
		t.Fatalf("read replayed tool_result failed: %v", err)
	}
	if replayedToolResult["type"] != "user" || replayedToolResult["isReplay"] != true || strings.TrimSpace(asString(replayedToolResult["session_id"])) != created["session_id"] || strings.TrimSpace(asString(replayedToolResult["uuid"])) == "" {
		t.Fatalf("unexpected replayed tool_result payload: %#v", replayedToolResult)
	}
	toolResultMessage, _ := replayedToolResult["message"].(map[string]any)
	if strings.TrimSpace(asString(toolResultMessage["role"])) != "user" {
		t.Fatalf("unexpected replayed tool_result message payload: %#v", replayedToolResult)
	}
	content, _ := toolResultMessage["content"].([]any)
	if len(content) == 0 {
		t.Fatalf("missing replayed tool_result content: %#v", replayedToolResult)
	}
	firstBlock, _ := content[0].(map[string]any)
	if strings.TrimSpace(asString(firstBlock["type"])) != "tool_result" || strings.TrimSpace(asString(firstBlock["tool_use_id"])) == "" || strings.TrimSpace(asString(firstBlock["content"])) != "echo:resume replay seed [approved]" {
		t.Fatalf("unexpected replayed tool_result content payload: %#v", replayedToolResult)
	}
	toolUseResult, _ := replayedToolResult["tool_use_result"].(map[string]any)
	if strings.TrimSpace(asString(toolUseResult["tool_use_id"])) == "" || strings.TrimSpace(asString(toolUseResult["content"])) != "echo:resume replay seed [approved]" {
		t.Fatalf("unexpected replayed tool_use_result payload: %#v", replayedToolResult)
	}
	var replayedAssistant map[string]any
	if err := ws.ReadJSON(&replayedAssistant); err != nil {
		t.Fatalf("read replayed assistant failed: %v", err)
	}
	if replayedAssistant["type"] != "assistant" || strings.TrimSpace(asString(replayedAssistant["session_id"])) != created["session_id"] || strings.TrimSpace(asString(replayedAssistant["uuid"])) == "" {
		t.Fatalf("unexpected replayed assistant payload: %#v", replayedAssistant)
	}
	if replayedAssistant["parent_tool_use_id"] != nil {
		t.Fatalf("expected replayed assistant parent_tool_use_id=nil, got %#v", replayedAssistant)
	}
	assistantMessage, _ := replayedAssistant["message"].(map[string]any)
	if strings.TrimSpace(asString(assistantMessage["role"])) != "assistant" {
		t.Fatalf("unexpected replayed assistant message payload: %#v", replayedAssistant)
	}
	assistantContent, _ := assistantMessage["content"].([]any)
	if len(assistantContent) == 0 {
		t.Fatalf("missing replayed assistant content: %#v", replayedAssistant)
	}
	assistantBlock, _ := assistantContent[0].(map[string]any)
	if strings.TrimSpace(asString(assistantBlock["type"])) != "text" || strings.TrimSpace(asString(assistantBlock["text"])) != "echo:resume replay seed [approved]" {
		t.Fatalf("unexpected replayed assistant content payload: %#v", replayedAssistant)
	}
	var replayedCompactBoundary map[string]any
	if err := ws.ReadJSON(&replayedCompactBoundary); err != nil {
		t.Fatalf("read replayed compact_boundary failed: %v", err)
	}
	if replayedCompactBoundary["type"] != "system" || strings.TrimSpace(asString(replayedCompactBoundary["subtype"])) != "compact_boundary" || strings.TrimSpace(asString(replayedCompactBoundary["session_id"])) != created["session_id"] || strings.TrimSpace(asString(replayedCompactBoundary["uuid"])) == "" {
		t.Fatalf("unexpected replayed compact_boundary payload: %#v", replayedCompactBoundary)
	}
	replayedCompactMetadata, _ := replayedCompactBoundary["compact_metadata"].(map[string]any)
	if strings.TrimSpace(asString(replayedCompactMetadata["trigger"])) != "auto" || int(replayedCompactMetadata["pre_tokens"].(float64)) != 128 {
		t.Fatalf("invalid replayed compact_boundary payload: %#v", replayedCompactBoundary)
	}
	var replayedLocalBreadcrumb map[string]any
	if err := ws.ReadJSON(&replayedLocalBreadcrumb); err != nil {
		t.Fatalf("read replayed local-command breadcrumb failed: %v", err)
	}
	if replayedLocalBreadcrumb["type"] != "user" || replayedLocalBreadcrumb["isReplay"] != true || strings.TrimSpace(asString(replayedLocalBreadcrumb["session_id"])) != created["session_id"] || strings.TrimSpace(asString(replayedLocalBreadcrumb["uuid"])) == "" {
		t.Fatalf("unexpected replayed local-command breadcrumb payload: %#v", replayedLocalBreadcrumb)
	}
	breadcrumbMessage, _ := replayedLocalBreadcrumb["message"].(map[string]any)
	if strings.TrimSpace(asString(breadcrumbMessage["role"])) != "user" {
		t.Fatalf("unexpected replayed local-command breadcrumb message payload: %#v", replayedLocalBreadcrumb)
	}
	if !strings.Contains(strings.TrimSpace(asString(breadcrumbMessage["content"])), "<local-command-stdout>") {
		t.Fatalf("expected replayed local-command breadcrumb stdout tag, got %#v", replayedLocalBreadcrumb)
	}
	var replayedLocalErrBreadcrumb map[string]any
	if err := ws.ReadJSON(&replayedLocalErrBreadcrumb); err != nil {
		t.Fatalf("read replayed local-command stderr breadcrumb failed: %v", err)
	}
	if replayedLocalErrBreadcrumb["type"] != "user" || replayedLocalErrBreadcrumb["isReplay"] != true || strings.TrimSpace(asString(replayedLocalErrBreadcrumb["session_id"])) != created["session_id"] || strings.TrimSpace(asString(replayedLocalErrBreadcrumb["uuid"])) == "" {
		t.Fatalf("unexpected replayed local-command stderr breadcrumb payload: %#v", replayedLocalErrBreadcrumb)
	}
	errBreadcrumbMessage, _ := replayedLocalErrBreadcrumb["message"].(map[string]any)
	if strings.TrimSpace(asString(errBreadcrumbMessage["role"])) != "user" {
		t.Fatalf("unexpected replayed local-command stderr breadcrumb message payload: %#v", replayedLocalErrBreadcrumb)
	}
	if !strings.Contains(strings.TrimSpace(asString(errBreadcrumbMessage["content"])), "<local-command-stderr>") {
		t.Fatalf("expected replayed local-command stderr breadcrumb stderr tag, got %#v", replayedLocalErrBreadcrumb)
	}
	var replayedQueuedCommand map[string]any
	if err := ws.ReadJSON(&replayedQueuedCommand); err != nil {
		t.Fatalf("read replayed queued_command failed: %v", err)
	}
	if replayedQueuedCommand["type"] != "user" || replayedQueuedCommand["isReplay"] != true || strings.TrimSpace(asString(replayedQueuedCommand["session_id"])) != created["session_id"] || strings.TrimSpace(asString(replayedQueuedCommand["uuid"])) == "" {
		t.Fatalf("unexpected replayed queued_command payload: %#v", replayedQueuedCommand)
	}
	queuedMessage, _ := replayedQueuedCommand["message"].(map[string]any)
	if strings.TrimSpace(asString(queuedMessage["role"])) != "user" || strings.TrimSpace(asString(queuedMessage["content"])) != "resume replay seed" {
		t.Fatalf("unexpected replayed queued_command message payload: %#v", replayedQueuedCommand)
	}
	attachment, _ := queuedMessage["attachment"].(map[string]any)
	if strings.TrimSpace(asString(attachment["type"])) != "queued_command" || strings.TrimSpace(asString(attachment["prompt"])) != "resume replay seed" {
		t.Fatalf("unexpected replayed queued_command attachment payload: %#v", replayedQueuedCommand)
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
