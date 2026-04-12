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
	var ackedInitialUser map[string]any
	if err := ws.ReadJSON(&ackedInitialUser); err != nil {
		t.Fatalf("read initial user ack replay failed: %v", err)
	}
	if ackedInitialUser["type"] != "user" || ackedInitialUser["isReplay"] != true || strings.TrimSpace(asString(ackedInitialUser["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(ackedInitialUser["uuid"])) == "" || strings.TrimSpace(asString(ackedInitialUser["timestamp"])) == "" {
		t.Fatalf("unexpected initial user ack replay payload: %#v", ackedInitialUser)
	}
	if _, ok := ackedInitialUser["isSynthetic"]; ok {
		t.Fatalf("expected initial user ack replay to omit isSynthetic, got %#v", ackedInitialUser)
	}
	if ackedInitialUser["parent_tool_use_id"] != nil {
		t.Fatalf("expected initial user ack replay parent_tool_use_id=nil, got %#v", ackedInitialUser)
	}
	ackedInitialMessage, _ := ackedInitialUser["message"].(map[string]any)
	if strings.TrimSpace(asString(ackedInitialMessage["role"])) != "user" || extractPromptText(ackedInitialUser) != "hello" {
		t.Fatalf("unexpected initial user ack replay message payload: %#v", ackedInitialUser)
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
	var hookPermissionDecisionAttachment map[string]any
	if err := ws.ReadJSON(&hookPermissionDecisionAttachment); err != nil {
		t.Fatalf("read hook_permission_decision attachment failed: %v", err)
	}
	if hookPermissionDecisionAttachment["type"] != "attachment" || strings.TrimSpace(asString(hookPermissionDecisionAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected hook_permission_decision attachment envelope: %#v", hookPermissionDecisionAttachment)
	}
	hookPermissionDecisionPayload, _ := hookPermissionDecisionAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(hookPermissionDecisionPayload["type"])) != "hook_permission_decision" ||
		strings.TrimSpace(asString(hookPermissionDecisionPayload["decision"])) != "allow" ||
		strings.TrimSpace(asString(hookPermissionDecisionPayload["toolUseID"])) != strings.TrimSpace(asString(request["tool_use_id"])) ||
		strings.TrimSpace(asString(hookPermissionDecisionPayload["hookEvent"])) != "PermissionRequest" {
		t.Fatalf("unexpected hook_permission_decision attachment payload: %#v", hookPermissionDecisionAttachment)
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
	var messageStartEvent map[string]any
	if err := ws.ReadJSON(&messageStartEvent); err != nil {
		t.Fatalf("read message_start event failed: %v", err)
	}
	if messageStartEvent["type"] != "stream_event" {
		t.Fatalf("unexpected message_start event envelope: %#v", messageStartEvent)
	}
	messageStartPayload, _ := messageStartEvent["event"].(map[string]any)
	messageStartMessage, _ := messageStartPayload["message"].(map[string]any)
	if strings.TrimSpace(asString(messageStartPayload["type"])) != "message_start" || strings.TrimSpace(asString(messageStartMessage["id"])) == "" || strings.TrimSpace(asString(messageStartMessage["type"])) != "message" || strings.TrimSpace(asString(messageStartMessage["role"])) != "assistant" || strings.TrimSpace(asString(messageStartMessage["model"])) != "claude-sonnet-4-5" {
		t.Fatalf("unexpected message_start payload: %#v", messageStartEvent)
	}
	assertZeroUsageShape(t, messageStartMessage, "message_start")
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
	var thinkingStreamEvent map[string]any
	if err := ws.ReadJSON(&thinkingStreamEvent); err != nil {
		t.Fatalf("read thinking stream event failed: %v", err)
	}
	if thinkingStreamEvent["type"] != "stream_event" {
		t.Fatalf("unexpected thinking stream event envelope: %#v", thinkingStreamEvent)
	}
	thinkingStreamPayload, _ := thinkingStreamEvent["event"].(map[string]any)
	thinkingStreamDelta, _ := thinkingStreamPayload["delta"].(map[string]any)
	if strings.TrimSpace(asString(thinkingStreamPayload["type"])) != "content_block_delta" || strings.TrimSpace(asString(thinkingStreamDelta["type"])) != "thinking_delta" || strings.TrimSpace(asString(thinkingStreamDelta["thinking"])) != "direct-connect stub thinking" {
		t.Fatalf("unexpected thinking stream event payload: %#v", thinkingStreamEvent)
	}
	var signatureStreamEvent map[string]any
	if err := ws.ReadJSON(&signatureStreamEvent); err != nil {
		t.Fatalf("read signature stream event failed: %v", err)
	}
	if signatureStreamEvent["type"] != "stream_event" {
		t.Fatalf("unexpected signature stream event envelope: %#v", signatureStreamEvent)
	}
	signatureStreamPayload, _ := signatureStreamEvent["event"].(map[string]any)
	signatureStreamDelta, _ := signatureStreamPayload["delta"].(map[string]any)
	if strings.TrimSpace(asString(signatureStreamPayload["type"])) != "content_block_delta" || strings.TrimSpace(asString(signatureStreamDelta["type"])) != "signature_delta" || strings.TrimSpace(asString(signatureStreamDelta["signature"])) != "sig-direct-connect-stub" {
		t.Fatalf("unexpected signature stream event payload: %#v", signatureStreamEvent)
	}
	var toolUseStartEvent map[string]any
	if err := ws.ReadJSON(&toolUseStartEvent); err != nil {
		t.Fatalf("read tool_use start event failed: %v", err)
	}
	if toolUseStartEvent["type"] != "stream_event" {
		t.Fatalf("unexpected tool_use start event envelope: %#v", toolUseStartEvent)
	}
	toolUseStartPayload, _ := toolUseStartEvent["event"].(map[string]any)
	toolUseContentBlock, _ := toolUseStartPayload["content_block"].(map[string]any)
	if strings.TrimSpace(asString(toolUseStartPayload["type"])) != "content_block_start" || strings.TrimSpace(asString(toolUseContentBlock["type"])) != "tool_use" || strings.TrimSpace(asString(toolUseContentBlock["id"])) != strings.TrimSpace(asString(request["tool_use_id"])) || strings.TrimSpace(asString(toolUseContentBlock["name"])) != directConnectEchoToolName || strings.TrimSpace(asString(toolUseContentBlock["input"])) != "" {
		t.Fatalf("unexpected tool_use start event payload: %#v", toolUseStartEvent)
	}
	var toolUseStreamEvent map[string]any
	if err := ws.ReadJSON(&toolUseStreamEvent); err != nil {
		t.Fatalf("read tool_use stream event failed: %v", err)
	}
	if toolUseStreamEvent["type"] != "stream_event" {
		t.Fatalf("unexpected tool_use stream event envelope: %#v", toolUseStreamEvent)
	}
	toolUseStreamPayload, _ := toolUseStreamEvent["event"].(map[string]any)
	toolUseStreamDelta, _ := toolUseStreamPayload["delta"].(map[string]any)
	if strings.TrimSpace(asString(toolUseStreamPayload["type"])) != "content_block_delta" || strings.TrimSpace(asString(toolUseStreamDelta["type"])) != "input_json_delta" || strings.TrimSpace(asString(toolUseStreamDelta["partial_json"])) != "{\"text\":\"hello [approved]\"}" {
		t.Fatalf("unexpected tool_use stream event payload: %#v", toolUseStreamEvent)
	}
	var toolUseStopEvent map[string]any
	if err := ws.ReadJSON(&toolUseStopEvent); err != nil {
		t.Fatalf("read tool_use stop event failed: %v", err)
	}
	if toolUseStopEvent["type"] != "stream_event" {
		t.Fatalf("unexpected tool_use stop event envelope: %#v", toolUseStopEvent)
	}
	toolUseStopPayload, _ := toolUseStopEvent["event"].(map[string]any)
	if strings.TrimSpace(asString(toolUseStopPayload["type"])) != "content_block_stop" {
		t.Fatalf("unexpected tool_use stop event payload: %#v", toolUseStopEvent)
	}
	var messageDeltaEvent map[string]any
	if err := ws.ReadJSON(&messageDeltaEvent); err != nil {
		t.Fatalf("read message_delta event failed: %v", err)
	}
	if messageDeltaEvent["type"] != "stream_event" {
		t.Fatalf("unexpected message_delta event envelope: %#v", messageDeltaEvent)
	}
	messageDeltaPayload, _ := messageDeltaEvent["event"].(map[string]any)
	messageDeltaDelta, _ := messageDeltaPayload["delta"].(map[string]any)
	if strings.TrimSpace(asString(messageDeltaPayload["type"])) != "message_delta" || strings.TrimSpace(asString(messageDeltaDelta["stop_reason"])) != "end_turn" {
		t.Fatalf("unexpected message_delta payload: %#v", messageDeltaEvent)
	}
	assertZeroUsageShape(t, messageDeltaPayload, "message_delta")
	var messageStopEvent map[string]any
	if err := ws.ReadJSON(&messageStopEvent); err != nil {
		t.Fatalf("read message_stop event failed: %v", err)
	}
	if messageStopEvent["type"] != "stream_event" {
		t.Fatalf("unexpected message_stop event envelope: %#v", messageStopEvent)
	}
	messageStopPayload, _ := messageStopEvent["event"].(map[string]any)
	if strings.TrimSpace(asString(messageStopPayload["type"])) != "message_stop" {
		t.Fatalf("unexpected message_stop payload: %#v", messageStopEvent)
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
	if len(content) < 3 {
		t.Fatalf("unexpected assistant payload: %#v", assistant)
	}
	if strings.TrimSpace(asString(assistant["stop_reason"])) != "end_turn" {
		t.Fatalf("unexpected assistant stop_reason: %#v", assistant)
	}
	assertZeroUsageShape(t, assistant, "assistant")
	thinkingBlock, _ := content[0].(map[string]any)
	toolUseBlock, _ := content[1].(map[string]any)
	textBlock, _ := content[2].(map[string]any)
	toolUseInput, _ := toolUseBlock["input"].(map[string]any)
	if strings.TrimSpace(asString(thinkingBlock["type"])) != "thinking" || strings.TrimSpace(asString(thinkingBlock["thinking"])) != "direct-connect stub thinking" || strings.TrimSpace(asString(thinkingBlock["signature"])) != "sig-direct-connect-stub" || strings.TrimSpace(asString(toolUseBlock["type"])) != "tool_use" || strings.TrimSpace(asString(toolUseBlock["id"])) != strings.TrimSpace(asString(request["tool_use_id"])) || strings.TrimSpace(asString(toolUseBlock["name"])) != directConnectEchoToolName || strings.TrimSpace(asString(toolUseInput["text"])) != "hello [approved]" || strings.TrimSpace(asString(textBlock["type"])) != "text" || strings.TrimSpace(asString(textBlock["text"])) != "echo:hello [approved]" {
		t.Fatalf("unexpected assistant payload: %#v", assistant)
	}
	var toolSummary map[string]any
	if err := ws.ReadJSON(&toolSummary); err != nil {
		t.Fatalf("read tool summary failed: %v", err)
	}
	precedingToolUseIDs, _ := toolSummary["preceding_tool_use_ids"].([]any)
	if toolSummary["type"] != "tool_use_summary" || strings.TrimSpace(asString(toolSummary["tool_name"])) != directConnectEchoToolName || strings.TrimSpace(asString(toolSummary["tool_use_id"])) != strings.TrimSpace(asString(request["tool_use_id"])) || strings.TrimSpace(asString(toolSummary["output_preview"])) != "echo:hello [approved]" || strings.TrimSpace(asString(toolSummary["summary"])) != "Used echo 1 time" || len(precedingToolUseIDs) == 0 || strings.TrimSpace(asString(precedingToolUseIDs[0])) != strings.TrimSpace(asString(request["tool_use_id"])) {
		t.Fatalf("unexpected tool summary payload: %#v", toolSummary)
	}
	var streamlinedToolSummary map[string]any
	if err := ws.ReadJSON(&streamlinedToolSummary); err != nil {
		t.Fatalf("read streamlined_tool_use_summary failed: %v", err)
	}
	if streamlinedToolSummary["type"] != "streamlined_tool_use_summary" || strings.TrimSpace(asString(streamlinedToolSummary["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(streamlinedToolSummary["tool_summary"])) != "Used echo 1 time" {
		t.Fatalf("unexpected streamlined_tool_use_summary payload: %#v", streamlinedToolSummary)
	}
	var structuredOutputAttachment map[string]any
	if err := ws.ReadJSON(&structuredOutputAttachment); err != nil {
		t.Fatalf("read structured_output attachment failed: %v", err)
	}
	if structuredOutputAttachment["type"] != "attachment" || strings.TrimSpace(asString(structuredOutputAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected structured_output attachment envelope: %#v", structuredOutputAttachment)
	}
	structuredOutputAttachmentPayload, _ := structuredOutputAttachment["attachment"].(map[string]any)
	structuredOutputAttachmentData, _ := structuredOutputAttachmentPayload["data"].(map[string]any)
	if strings.TrimSpace(asString(structuredOutputAttachmentPayload["type"])) != "structured_output" || strings.TrimSpace(asString(structuredOutputAttachmentData["text"])) != "echo:hello [approved]" {
		t.Fatalf("unexpected structured_output attachment payload: %#v", structuredOutputAttachment)
	}
	var result map[string]any
	if err := ws.ReadJSON(&result); err != nil {
		t.Fatalf("read result event failed: %v", err)
	}
	if result["type"] != "result" || strings.TrimSpace(asString(result["subtype"])) != "success" || strings.TrimSpace(asString(result["result"])) != "echo:hello [approved]" || strings.TrimSpace(asString(result["fast_mode_state"])) != "off" {
		t.Fatalf("unexpected result event: %#v", result)
	}
	structuredOutput, _ := result["structured_output"].(map[string]any)
	if strings.TrimSpace(asString(structuredOutput["text"])) != "echo:hello [approved]" {
		t.Fatalf("unexpected result structured_output: %#v", result)
	}
	usage, _ := result["usage"].(map[string]any)
	serverToolUse, _ := usage["server_tool_use"].(map[string]any)
	cacheCreation, _ := usage["cache_creation"].(map[string]any)
	iterations, _ := usage["iterations"].([]any)
	if intFromAny(usage["input_tokens"]) != 0 || intFromAny(usage["cache_creation_input_tokens"]) != 0 || intFromAny(usage["cache_read_input_tokens"]) != 0 || intFromAny(usage["output_tokens"]) != 0 || intFromAny(serverToolUse["web_search_requests"]) != 0 || intFromAny(serverToolUse["web_fetch_requests"]) != 0 || strings.TrimSpace(asString(usage["service_tier"])) != "standard" || intFromAny(cacheCreation["ephemeral_1h_input_tokens"]) != 0 || intFromAny(cacheCreation["ephemeral_5m_input_tokens"]) != 0 || strings.TrimSpace(asString(usage["inference_geo"])) != "" || len(iterations) != 0 || strings.TrimSpace(asString(usage["speed"])) != "standard" {
		t.Fatalf("unexpected result usage: %#v", result)
	}
	modelUsage, _ := result["modelUsage"].(map[string]any)
	modelUsageEntry, _ := modelUsage["claude-sonnet-4-5"].(map[string]any)
	if len(modelUsageEntry) == 0 || intFromAny(modelUsageEntry["inputTokens"]) != 0 || intFromAny(modelUsageEntry["outputTokens"]) != 0 || intFromAny(modelUsageEntry["cacheReadInputTokens"]) != 0 || intFromAny(modelUsageEntry["cacheCreationInputTokens"]) != 0 || intFromAny(modelUsageEntry["webSearchRequests"]) != 0 || intFromAny(modelUsageEntry["contextWindow"]) != 0 || float64FromAny(modelUsageEntry["costUSD"]) != 0 {
		t.Fatalf("unexpected result modelUsage: %#v", result)
	}
	permissionDenials, _ := result["permission_denials"].([]any)
	if len(permissionDenials) != 0 {
		t.Fatalf("unexpected success result permission_denials: %#v", result)
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
	var queuedCommandAttachment map[string]any
	if err := ws.ReadJSON(&queuedCommandAttachment); err != nil {
		t.Fatalf("read queued_command attachment failed: %v", err)
	}
	if queuedCommandAttachment["type"] != "attachment" || strings.TrimSpace(asString(queuedCommandAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected queued_command attachment envelope: %#v", queuedCommandAttachment)
	}
	queuedCommandPayload, _ := queuedCommandAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(queuedCommandPayload["type"])) != "queued_command" || strings.TrimSpace(asString(queuedCommandPayload["commandMode"])) != "task-notification" || strings.TrimSpace(asString(queuedCommandPayload["prompt"])) == "" {
		t.Fatalf("unexpected queued_command attachment payload: %#v", queuedCommandAttachment)
	}
	assertTaskStatusAttachment(t, ws, parsed["session_id"], strings.TrimSpace(asString(taskStarted["task_id"])), "direct-connect echo task", "echo:hello [approved]", "task_notification")
	var taskReminderAttachment map[string]any
	if err := ws.ReadJSON(&taskReminderAttachment); err != nil {
		t.Fatalf("read task_reminder attachment failed: %v", err)
	}
	if taskReminderAttachment["type"] != "attachment" || strings.TrimSpace(asString(taskReminderAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected task_reminder attachment envelope: %#v", taskReminderAttachment)
	}
	taskReminderPayload, _ := taskReminderAttachment["attachment"].(map[string]any)
	taskReminderContent, _ := taskReminderPayload["content"].([]any)
	firstTaskReminder, _ := taskReminderContent[0].(map[string]any)
	if strings.TrimSpace(asString(taskReminderPayload["type"])) != "task_reminder" || intFromAny(taskReminderPayload["itemCount"]) != 1 || len(taskReminderContent) != 1 || strings.TrimSpace(asString(firstTaskReminder["id"])) != strings.TrimSpace(asString(taskStarted["task_id"])) || strings.TrimSpace(asString(firstTaskReminder["status"])) != "completed" || strings.TrimSpace(asString(firstTaskReminder["subject"])) != "direct-connect echo task" {
		t.Fatalf("unexpected task_reminder attachment payload: %#v", taskReminderAttachment)
	}
	var todoReminderAttachment map[string]any
	if err := ws.ReadJSON(&todoReminderAttachment); err != nil {
		t.Fatalf("read todo_reminder attachment failed: %v", err)
	}
	if todoReminderAttachment["type"] != "attachment" || strings.TrimSpace(asString(todoReminderAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected todo_reminder attachment envelope: %#v", todoReminderAttachment)
	}
	todoReminderPayload, _ := todoReminderAttachment["attachment"].(map[string]any)
	todoReminderContent, _ := todoReminderPayload["content"].([]any)
	firstTodoReminder, _ := todoReminderContent[0].(map[string]any)
	if strings.TrimSpace(asString(todoReminderPayload["type"])) != "todo_reminder" || intFromAny(todoReminderPayload["itemCount"]) != 1 || len(todoReminderContent) != 1 || strings.TrimSpace(asString(firstTodoReminder["content"])) != "direct-connect echo task" || strings.TrimSpace(asString(firstTodoReminder["status"])) != "completed" || strings.TrimSpace(asString(firstTodoReminder["activeForm"])) != "Completing direct-connect echo task" {
		t.Fatalf("unexpected todo_reminder attachment payload: %#v", todoReminderAttachment)
	}
	var agentMentionAttachment map[string]any
	if err := ws.ReadJSON(&agentMentionAttachment); err != nil {
		t.Fatalf("read agent_mention attachment failed: %v", err)
	}
	if agentMentionAttachment["type"] != "attachment" || strings.TrimSpace(asString(agentMentionAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected agent_mention attachment envelope: %#v", agentMentionAttachment)
	}
	agentMentionPayload, _ := agentMentionAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(agentMentionPayload["type"])) != "agent_mention" || strings.TrimSpace(asString(agentMentionPayload["agentType"])) != stubAgentMentionType {
		t.Fatalf("unexpected agent_mention attachment payload: %#v", agentMentionAttachment)
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
	var localCommandOutputAssistant map[string]any
	if err := ws.ReadJSON(&localCommandOutputAssistant); err != nil {
		t.Fatalf("read local_command_output assistant mirror failed: %v", err)
	}
	if localCommandOutputAssistant["type"] != "assistant" || strings.TrimSpace(asString(localCommandOutputAssistant["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(localCommandOutputAssistant["uuid"])) == "" {
		t.Fatalf("unexpected local_command_output assistant mirror payload: %#v", localCommandOutputAssistant)
	}
	if localCommandOutputAssistant["parent_tool_use_id"] != nil {
		t.Fatalf("expected local_command_output assistant mirror parent_tool_use_id=nil, got %#v", localCommandOutputAssistant)
	}
	localCommandOutputAssistantMessage, _ := localCommandOutputAssistant["message"].(map[string]any)
	if strings.TrimSpace(asString(localCommandOutputAssistantMessage["role"])) != "assistant" {
		t.Fatalf("invalid local_command_output assistant mirror message payload: %#v", localCommandOutputAssistant)
	}
	localCommandOutputAssistantContent, _ := localCommandOutputAssistantMessage["content"].([]any)
	if len(localCommandOutputAssistantContent) == 0 {
		t.Fatalf("missing local_command_output assistant mirror content: %#v", localCommandOutputAssistant)
	}
	localCommandOutputAssistantText, _ := localCommandOutputAssistantContent[0].(map[string]any)
	if strings.TrimSpace(asString(localCommandOutputAssistantText["type"])) != "text" || strings.TrimSpace(asString(localCommandOutputAssistantText["text"])) != "local command output: persisted direct-connect artifacts" {
		t.Fatalf("invalid local_command_output assistant mirror content payload: %#v", localCommandOutputAssistant)
	}
	var compactSummary map[string]any
	if err := ws.ReadJSON(&compactSummary); err != nil {
		t.Fatalf("read compact summary failed: %v", err)
	}
	if compactSummary["type"] != "user" || compactSummary["isReplay"] != false || compactSummary["isSynthetic"] != true || strings.TrimSpace(asString(compactSummary["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(compactSummary["uuid"])) == "" || strings.TrimSpace(asString(compactSummary["timestamp"])) == "" {
		t.Fatalf("unexpected compact summary payload: %#v", compactSummary)
	}
	if compactSummary["parent_tool_use_id"] != nil {
		t.Fatalf("expected compact summary parent_tool_use_id=nil, got %#v", compactSummary)
	}
	compactSummaryMessage, _ := compactSummary["message"].(map[string]any)
	if strings.TrimSpace(asString(compactSummaryMessage["role"])) != "user" || strings.TrimSpace(asString(compactSummaryMessage["content"])) == "" {
		t.Fatalf("invalid compact summary message payload: %#v", compactSummary)
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
	var criticalSystemReminderAttachment map[string]any
	if err := ws.ReadJSON(&criticalSystemReminderAttachment); err != nil {
		t.Fatalf("read critical_system_reminder attachment failed: %v", err)
	}
	if criticalSystemReminderAttachment["type"] != "attachment" || strings.TrimSpace(asString(criticalSystemReminderAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected critical_system_reminder attachment envelope: %#v", criticalSystemReminderAttachment)
	}
	criticalSystemReminderPayload, _ := criticalSystemReminderAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(criticalSystemReminderPayload["type"])) != "critical_system_reminder" || strings.TrimSpace(asString(criticalSystemReminderPayload["content"])) != "Critical system reminder: stay inside the local workspace and avoid destructive actions without explicit confirmation." {
		t.Fatalf("unexpected critical_system_reminder attachment payload: %#v", criticalSystemReminderAttachment)
	}
	var outputStyleAttachment map[string]any
	if err := ws.ReadJSON(&outputStyleAttachment); err != nil {
		t.Fatalf("read output_style attachment failed: %v", err)
	}
	if outputStyleAttachment["type"] != "attachment" || strings.TrimSpace(asString(outputStyleAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected output_style attachment envelope: %#v", outputStyleAttachment)
	}
	outputStylePayload, _ := outputStyleAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(outputStylePayload["type"])) != "output_style" || strings.TrimSpace(asString(outputStylePayload["style"])) != "explanatory" {
		t.Fatalf("unexpected output_style attachment payload: %#v", outputStyleAttachment)
	}
	var selectedLinesInIDEAttachment map[string]any
	if err := ws.ReadJSON(&selectedLinesInIDEAttachment); err != nil {
		t.Fatalf("read selected_lines_in_ide attachment failed: %v", err)
	}
	if selectedLinesInIDEAttachment["type"] != "attachment" || strings.TrimSpace(asString(selectedLinesInIDEAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected selected_lines_in_ide attachment envelope: %#v", selectedLinesInIDEAttachment)
	}
	selectedLinesInIDEPayload, _ := selectedLinesInIDEAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(selectedLinesInIDEPayload["type"])) != "selected_lines_in_ide" ||
		strings.TrimSpace(asString(selectedLinesInIDEPayload["ideName"])) != "VS Code" ||
		intFromAny(selectedLinesInIDEPayload["lineStart"]) != 12 ||
		intFromAny(selectedLinesInIDEPayload["lineEnd"]) != 14 ||
		strings.TrimSpace(asString(selectedLinesInIDEPayload["filename"])) != "internal/server/server.go" ||
		asString(selectedLinesInIDEPayload["content"]) != "func streamReply() {\n\twriteAttachment(\"selected_lines_in_ide\")\n}\n" ||
		strings.TrimSpace(asString(selectedLinesInIDEPayload["displayPath"])) != "internal/server/server.go" {
		t.Fatalf("unexpected selected_lines_in_ide attachment payload: %#v", selectedLinesInIDEAttachment)
	}
	var openedFileInIDEAttachment map[string]any
	if err := ws.ReadJSON(&openedFileInIDEAttachment); err != nil {
		t.Fatalf("read opened_file_in_ide attachment failed: %v", err)
	}
	if openedFileInIDEAttachment["type"] != "attachment" || strings.TrimSpace(asString(openedFileInIDEAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected opened_file_in_ide attachment envelope: %#v", openedFileInIDEAttachment)
	}
	openedFileInIDEPayload, _ := openedFileInIDEAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(openedFileInIDEPayload["type"])) != "opened_file_in_ide" || strings.TrimSpace(asString(openedFileInIDEPayload["filename"])) != "internal/server/server.go" {
		t.Fatalf("unexpected opened_file_in_ide attachment payload: %#v", openedFileInIDEAttachment)
	}
	assertDiagnosticsAttachment(t, ws, parsed["session_id"], "diagnostics")
	assertDiagnosticsAttachment(t, ws, parsed["session_id"], "lsp_diagnostics")
	assertTaskStatusAttachment(t, ws, parsed["session_id"], strings.TrimSpace(asString(taskStarted["task_id"])), "direct-connect echo task", "echo:hello [approved]", "unified_tasks")
	var mcpResourceAttachment map[string]any
	if err := ws.ReadJSON(&mcpResourceAttachment); err != nil {
		t.Fatalf("read mcp_resource attachment failed: %v", err)
	}
	if mcpResourceAttachment["type"] != "attachment" || strings.TrimSpace(asString(mcpResourceAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected mcp_resource attachment envelope: %#v", mcpResourceAttachment)
	}
	mcpResourcePayload, _ := mcpResourceAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(mcpResourcePayload["type"])) != "mcp_resource" ||
		strings.TrimSpace(asString(mcpResourcePayload["server"])) != "demo-mcp" ||
		strings.TrimSpace(asString(mcpResourcePayload["uri"])) != "resource://demo/readme" ||
		strings.TrimSpace(asString(mcpResourcePayload["name"])) != "Demo README" ||
		strings.TrimSpace(asString(mcpResourcePayload["description"])) != "demo resource" {
		t.Fatalf("unexpected mcp_resource attachment payload: %#v", mcpResourceAttachment)
	}
	mcpResourceContent, _ := mcpResourcePayload["content"].(map[string]any)
	mcpResourceContents, _ := mcpResourceContent["contents"].([]any)
	if len(mcpResourceContents) != 1 {
		t.Fatalf("unexpected mcp_resource contents: %#v", mcpResourceAttachment)
	}
	mcpResourceItem, _ := mcpResourceContents[0].(map[string]any)
	if strings.TrimSpace(asString(mcpResourceItem["uri"])) != "resource://demo/readme" ||
		strings.TrimSpace(asString(mcpResourceItem["mimeType"])) != "text/plain" ||
		strings.TrimSpace(asString(mcpResourceItem["text"])) != "Demo MCP resource contents." {
		t.Fatalf("unexpected mcp_resource content item: %#v", mcpResourceAttachment)
	}
	var budgetUSDAttachment map[string]any
	if err := ws.ReadJSON(&budgetUSDAttachment); err != nil {
		t.Fatalf("read budget_usd attachment failed: %v", err)
	}
	if budgetUSDAttachment["type"] != "attachment" || strings.TrimSpace(asString(budgetUSDAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected budget_usd attachment envelope: %#v", budgetUSDAttachment)
	}
	budgetUSDPayload, _ := budgetUSDAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(budgetUSDPayload["type"])) != "budget_usd" || int(budgetUSDPayload["used"].(float64)) != 12 || int(budgetUSDPayload["total"].(float64)) != 20 || int(budgetUSDPayload["remaining"].(float64)) != 8 {
		t.Fatalf("unexpected budget_usd attachment payload: %#v", budgetUSDAttachment)
	}
	var compactionReminderAttachment map[string]any
	if err := ws.ReadJSON(&compactionReminderAttachment); err != nil {
		t.Fatalf("read compaction_reminder attachment failed: %v", err)
	}
	if compactionReminderAttachment["type"] != "attachment" || strings.TrimSpace(asString(compactionReminderAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected compaction_reminder attachment envelope: %#v", compactionReminderAttachment)
	}
	compactionReminderPayload, _ := compactionReminderAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(compactionReminderPayload["type"])) != "compaction_reminder" {
		t.Fatalf("unexpected compaction_reminder attachment payload: %#v", compactionReminderAttachment)
	}
	var contextEfficiencyAttachment map[string]any
	if err := ws.ReadJSON(&contextEfficiencyAttachment); err != nil {
		t.Fatalf("read context_efficiency attachment failed: %v", err)
	}
	if contextEfficiencyAttachment["type"] != "attachment" || strings.TrimSpace(asString(contextEfficiencyAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected context_efficiency attachment envelope: %#v", contextEfficiencyAttachment)
	}
	contextEfficiencyPayload, _ := contextEfficiencyAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(contextEfficiencyPayload["type"])) != "context_efficiency" {
		t.Fatalf("unexpected context_efficiency attachment payload: %#v", contextEfficiencyAttachment)
	}
	var autoModeAttachment map[string]any
	if err := ws.ReadJSON(&autoModeAttachment); err != nil {
		t.Fatalf("read auto_mode attachment failed: %v", err)
	}
	if autoModeAttachment["type"] != "attachment" || strings.TrimSpace(asString(autoModeAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected auto_mode attachment envelope: %#v", autoModeAttachment)
	}
	autoModePayload, _ := autoModeAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(autoModePayload["type"])) != "auto_mode" || strings.TrimSpace(asString(autoModePayload["reminderType"])) != "full" {
		t.Fatalf("unexpected auto_mode attachment payload: %#v", autoModeAttachment)
	}
	var autoModeExitAttachment map[string]any
	if err := ws.ReadJSON(&autoModeExitAttachment); err != nil {
		t.Fatalf("read auto_mode_exit attachment failed: %v", err)
	}
	if autoModeExitAttachment["type"] != "attachment" || strings.TrimSpace(asString(autoModeExitAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected auto_mode_exit attachment envelope: %#v", autoModeExitAttachment)
	}
	autoModeExitPayload, _ := autoModeExitAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(autoModeExitPayload["type"])) != "auto_mode_exit" {
		t.Fatalf("unexpected auto_mode_exit attachment payload: %#v", autoModeExitAttachment)
	}
	var planModeAttachment map[string]any
	if err := ws.ReadJSON(&planModeAttachment); err != nil {
		t.Fatalf("read plan_mode attachment failed: %v", err)
	}
	if planModeAttachment["type"] != "attachment" || strings.TrimSpace(asString(planModeAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected plan_mode attachment envelope: %#v", planModeAttachment)
	}
	planModePayload, _ := planModeAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(planModePayload["type"])) != "plan_mode" || strings.TrimSpace(asString(planModePayload["reminderType"])) != "full" || strings.TrimSpace(asString(planModePayload["planFilePath"])) == "" {
		t.Fatalf("unexpected plan_mode attachment payload: %#v", planModeAttachment)
	}
	if planExists, ok := planModePayload["planExists"].(bool); !ok || planExists {
		t.Fatalf("invalid plan_mode attachment payload: %#v", planModeAttachment)
	}
	if isSubAgent, ok := planModePayload["isSubAgent"].(bool); !ok || isSubAgent {
		t.Fatalf("invalid plan_mode attachment payload: %#v", planModeAttachment)
	}
	var planModeExitAttachment map[string]any
	if err := ws.ReadJSON(&planModeExitAttachment); err != nil {
		t.Fatalf("read plan_mode_exit attachment failed: %v", err)
	}
	if planModeExitAttachment["type"] != "attachment" || strings.TrimSpace(asString(planModeExitAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected plan_mode_exit attachment envelope: %#v", planModeExitAttachment)
	}
	planModeExitPayload, _ := planModeExitAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(planModeExitPayload["type"])) != "plan_mode_exit" || strings.TrimSpace(asString(planModeExitPayload["planFilePath"])) == "" {
		t.Fatalf("unexpected plan_mode_exit attachment payload: %#v", planModeExitAttachment)
	}
	if planExists, ok := planModeExitPayload["planExists"].(bool); !ok || planExists {
		t.Fatalf("invalid plan_mode_exit attachment payload: %#v", planModeExitAttachment)
	}
	var planModeReentryAttachment map[string]any
	if err := ws.ReadJSON(&planModeReentryAttachment); err != nil {
		t.Fatalf("read plan_mode_reentry attachment failed: %v", err)
	}
	if planModeReentryAttachment["type"] != "attachment" || strings.TrimSpace(asString(planModeReentryAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected plan_mode_reentry attachment envelope: %#v", planModeReentryAttachment)
	}
	planModeReentryPayload, _ := planModeReentryAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(planModeReentryPayload["type"])) != "plan_mode_reentry" || strings.TrimSpace(asString(planModeReentryPayload["planFilePath"])) == "" {
		t.Fatalf("unexpected plan_mode_reentry attachment payload: %#v", planModeReentryAttachment)
	}
	var planFileReferenceAttachment map[string]any
	if err := ws.ReadJSON(&planFileReferenceAttachment); err != nil {
		t.Fatalf("read plan_file_reference attachment failed: %v", err)
	}
	if planFileReferenceAttachment["type"] != "attachment" || strings.TrimSpace(asString(planFileReferenceAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected plan_file_reference attachment envelope: %#v", planFileReferenceAttachment)
	}
	planFileReferencePayload, _ := planFileReferenceAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(planFileReferencePayload["type"])) != "plan_file_reference" || strings.TrimSpace(asString(planFileReferencePayload["planFilePath"])) == "" {
		t.Fatalf("unexpected plan_file_reference attachment payload: %#v", planFileReferenceAttachment)
	}
	if strings.TrimSpace(asString(planFileReferencePayload["planContent"])) != stubPlanFileReferenceContent {
		t.Fatalf("invalid plan_file_reference attachment payload: %#v", planFileReferenceAttachment)
	}
	var invokedSkillsAttachment map[string]any
	if err := ws.ReadJSON(&invokedSkillsAttachment); err != nil {
		t.Fatalf("read invoked_skills attachment failed: %v", err)
	}
	if invokedSkillsAttachment["type"] != "attachment" || strings.TrimSpace(asString(invokedSkillsAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected invoked_skills attachment envelope: %#v", invokedSkillsAttachment)
	}
	invokedSkillsPayload, _ := invokedSkillsAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(invokedSkillsPayload["type"])) != "invoked_skills" {
		t.Fatalf("unexpected invoked_skills attachment payload: %#v", invokedSkillsAttachment)
	}
	skills, _ := invokedSkillsPayload["skills"].([]any)
	if len(skills) != 1 {
		t.Fatalf("invalid invoked_skills attachment payload: %#v", invokedSkillsAttachment)
	}
	firstSkill, _ := skills[0].(map[string]any)
	if strings.TrimSpace(asString(firstSkill["name"])) != stubInvokedSkillName || strings.TrimSpace(asString(firstSkill["path"])) != stubInvokedSkillPath || strings.TrimSpace(asString(firstSkill["content"])) != stubInvokedSkillContent {
		t.Fatalf("invalid invoked_skills attachment payload: %#v", invokedSkillsAttachment)
	}
	var dateChangeAttachment map[string]any
	if err := ws.ReadJSON(&dateChangeAttachment); err != nil {
		t.Fatalf("read date_change attachment failed: %v", err)
	}
	if dateChangeAttachment["type"] != "attachment" || strings.TrimSpace(asString(dateChangeAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected date_change attachment envelope: %#v", dateChangeAttachment)
	}
	dateChangePayload, _ := dateChangeAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(dateChangePayload["type"])) != "date_change" || strings.TrimSpace(asString(dateChangePayload["newDate"])) != "2026-04-09" {
		t.Fatalf("unexpected date_change attachment payload: %#v", dateChangeAttachment)
	}
	var ultrathinkEffortAttachment map[string]any
	if err := ws.ReadJSON(&ultrathinkEffortAttachment); err != nil {
		t.Fatalf("read ultrathink_effort attachment failed: %v", err)
	}
	if ultrathinkEffortAttachment["type"] != "attachment" || strings.TrimSpace(asString(ultrathinkEffortAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected ultrathink_effort attachment envelope: %#v", ultrathinkEffortAttachment)
	}
	ultrathinkEffortPayload, _ := ultrathinkEffortAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(ultrathinkEffortPayload["type"])) != "ultrathink_effort" || strings.TrimSpace(asString(ultrathinkEffortPayload["level"])) != "high" {
		t.Fatalf("unexpected ultrathink_effort attachment payload: %#v", ultrathinkEffortAttachment)
	}
	var deferredToolsDeltaAttachment map[string]any
	if err := ws.ReadJSON(&deferredToolsDeltaAttachment); err != nil {
		t.Fatalf("read deferred_tools_delta attachment failed: %v", err)
	}
	if deferredToolsDeltaAttachment["type"] != "attachment" || strings.TrimSpace(asString(deferredToolsDeltaAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected deferred_tools_delta attachment envelope: %#v", deferredToolsDeltaAttachment)
	}
	deferredToolsDeltaPayload, _ := deferredToolsDeltaAttachment["attachment"].(map[string]any)
	addedNames, _ := deferredToolsDeltaPayload["addedNames"].([]any)
	addedLines, _ := deferredToolsDeltaPayload["addedLines"].([]any)
	removedNames, _ := deferredToolsDeltaPayload["removedNames"].([]any)
	if strings.TrimSpace(asString(deferredToolsDeltaPayload["type"])) != "deferred_tools_delta" || len(addedNames) != 1 || strings.TrimSpace(asString(addedNames[0])) != "ToolSearch" || len(addedLines) != 1 || strings.TrimSpace(asString(addedLines[0])) != "- ToolSearch: Search deferred tools on demand" || len(removedNames) != 0 {
		t.Fatalf("unexpected deferred_tools_delta attachment payload: %#v", deferredToolsDeltaAttachment)
	}
	var agentListingDeltaAttachment map[string]any
	if err := ws.ReadJSON(&agentListingDeltaAttachment); err != nil {
		t.Fatalf("read agent_listing_delta attachment failed: %v", err)
	}
	if agentListingDeltaAttachment["type"] != "attachment" || strings.TrimSpace(asString(agentListingDeltaAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected agent_listing_delta attachment envelope: %#v", agentListingDeltaAttachment)
	}
	agentListingDeltaPayload, _ := agentListingDeltaAttachment["attachment"].(map[string]any)
	addedTypes, _ := agentListingDeltaPayload["addedTypes"].([]any)
	agentAddedLines, _ := agentListingDeltaPayload["addedLines"].([]any)
	removedTypes, _ := agentListingDeltaPayload["removedTypes"].([]any)
	if strings.TrimSpace(asString(agentListingDeltaPayload["type"])) != "agent_listing_delta" || len(addedTypes) != 1 || strings.TrimSpace(asString(addedTypes[0])) != "explorer" || len(agentAddedLines) != 1 || strings.TrimSpace(asString(agentAddedLines[0])) != "- explorer: Fast codebase explorer for scoped questions" || len(removedTypes) != 0 || !agentListingDeltaPayload["isInitial"].(bool) || !agentListingDeltaPayload["showConcurrencyNote"].(bool) {
		t.Fatalf("unexpected agent_listing_delta attachment payload: %#v", agentListingDeltaAttachment)
	}
	var mcpInstructionsDeltaAttachment map[string]any
	if err := ws.ReadJSON(&mcpInstructionsDeltaAttachment); err != nil {
		t.Fatalf("read mcp_instructions_delta attachment failed: %v", err)
	}
	if mcpInstructionsDeltaAttachment["type"] != "attachment" || strings.TrimSpace(asString(mcpInstructionsDeltaAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected mcp_instructions_delta attachment envelope: %#v", mcpInstructionsDeltaAttachment)
	}
	mcpInstructionsDeltaPayload, _ := mcpInstructionsDeltaAttachment["attachment"].(map[string]any)
	mcpAddedNames, _ := mcpInstructionsDeltaPayload["addedNames"].([]any)
	mcpAddedBlocks, _ := mcpInstructionsDeltaPayload["addedBlocks"].([]any)
	mcpRemovedNames, _ := mcpInstructionsDeltaPayload["removedNames"].([]any)
	if strings.TrimSpace(asString(mcpInstructionsDeltaPayload["type"])) != "mcp_instructions_delta" || len(mcpAddedNames) != 1 || strings.TrimSpace(asString(mcpAddedNames[0])) != "chrome" || len(mcpAddedBlocks) != 1 || strings.TrimSpace(asString(mcpAddedBlocks[0])) != "## chrome\nUse ToolSearch before browser actions." || len(mcpRemovedNames) != 0 {
		t.Fatalf("unexpected mcp_instructions_delta attachment payload: %#v", mcpInstructionsDeltaAttachment)
	}
	var companionIntroAttachment map[string]any
	if err := ws.ReadJSON(&companionIntroAttachment); err != nil {
		t.Fatalf("read companion_intro attachment failed: %v", err)
	}
	if companionIntroAttachment["type"] != "attachment" || strings.TrimSpace(asString(companionIntroAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected companion_intro attachment envelope: %#v", companionIntroAttachment)
	}
	companionIntroPayload, _ := companionIntroAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(companionIntroPayload["type"])) != "companion_intro" || strings.TrimSpace(asString(companionIntroPayload["name"])) != "Mochi" || strings.TrimSpace(asString(companionIntroPayload["species"])) != "otter" {
		t.Fatalf("unexpected companion_intro attachment payload: %#v", companionIntroAttachment)
	}
	var asyncHookResponseAttachment map[string]any
	if err := ws.ReadJSON(&asyncHookResponseAttachment); err != nil {
		t.Fatalf("read async_hook_response attachment failed: %v", err)
	}
	if asyncHookResponseAttachment["type"] != "attachment" || strings.TrimSpace(asString(asyncHookResponseAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected async_hook_response attachment envelope: %#v", asyncHookResponseAttachment)
	}
	asyncHookResponsePayload, _ := asyncHookResponseAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(asyncHookResponsePayload["type"])) != "async_hook_response" ||
		strings.TrimSpace(asString(asyncHookResponsePayload["hookName"])) != "PostToolUse" ||
		strings.TrimSpace(asString(asyncHookResponsePayload["sessionId"])) != parsed["session_id"] ||
		strings.TrimSpace(asString(asyncHookResponsePayload["toolUseID"])) != "toolu_demo_async_hook" ||
		strings.TrimSpace(asString(asyncHookResponsePayload["content"])) != "Async hook completed: captured post-tool summary." {
		t.Fatalf("unexpected async_hook_response attachment payload: %#v", asyncHookResponseAttachment)
	}
	var tokenUsageAttachment map[string]any
	if err := ws.ReadJSON(&tokenUsageAttachment); err != nil {
		t.Fatalf("read token_usage attachment failed: %v", err)
	}
	if tokenUsageAttachment["type"] != "attachment" || strings.TrimSpace(asString(tokenUsageAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected token_usage attachment envelope: %#v", tokenUsageAttachment)
	}
	tokenUsagePayload, _ := tokenUsageAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(tokenUsagePayload["type"])) != "token_usage" || int(tokenUsagePayload["used"].(float64)) != 1024 || int(tokenUsagePayload["total"].(float64)) != 200000 || int(tokenUsagePayload["remaining"].(float64)) != 198976 {
		t.Fatalf("unexpected token_usage attachment payload: %#v", tokenUsageAttachment)
	}
	var outputTokenUsageAttachment map[string]any
	if err := ws.ReadJSON(&outputTokenUsageAttachment); err != nil {
		t.Fatalf("read output_token_usage attachment failed: %v", err)
	}
	if outputTokenUsageAttachment["type"] != "attachment" || strings.TrimSpace(asString(outputTokenUsageAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected output_token_usage attachment envelope: %#v", outputTokenUsageAttachment)
	}
	outputTokenUsagePayload, _ := outputTokenUsageAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(outputTokenUsagePayload["type"])) != "output_token_usage" || int(outputTokenUsagePayload["turn"].(float64)) != 256 || int(outputTokenUsagePayload["session"].(float64)) != 512 || int(outputTokenUsagePayload["budget"].(float64)) != 1024 {
		t.Fatalf("unexpected output_token_usage attachment payload: %#v", outputTokenUsageAttachment)
	}
	var verifyPlanReminderAttachment map[string]any
	if err := ws.ReadJSON(&verifyPlanReminderAttachment); err != nil {
		t.Fatalf("read verify_plan_reminder attachment failed: %v", err)
	}
	if verifyPlanReminderAttachment["type"] != "attachment" || strings.TrimSpace(asString(verifyPlanReminderAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected verify_plan_reminder attachment envelope: %#v", verifyPlanReminderAttachment)
	}
	verifyPlanReminderPayload, _ := verifyPlanReminderAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(verifyPlanReminderPayload["type"])) != "verify_plan_reminder" {
		t.Fatalf("unexpected verify_plan_reminder attachment payload: %#v", verifyPlanReminderAttachment)
	}
	var currentSessionMemoryAttachment map[string]any
	if err := ws.ReadJSON(&currentSessionMemoryAttachment); err != nil {
		t.Fatalf("read current_session_memory attachment failed: %v", err)
	}
	if currentSessionMemoryAttachment["type"] != "attachment" || strings.TrimSpace(asString(currentSessionMemoryAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected current_session_memory attachment envelope: %#v", currentSessionMemoryAttachment)
	}
	currentSessionMemoryPayload, _ := currentSessionMemoryAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(currentSessionMemoryPayload["type"])) != "current_session_memory" || strings.TrimSpace(asString(currentSessionMemoryPayload["content"])) != "Remember: keep this session focused." || strings.TrimSpace(asString(currentSessionMemoryPayload["path"])) != "MEMORY.md" || int(currentSessionMemoryPayload["tokenCount"].(float64)) != 7 {
		t.Fatalf("unexpected current_session_memory attachment payload: %#v", currentSessionMemoryAttachment)
	}
	var relevantMemoriesAttachment map[string]any
	if err := ws.ReadJSON(&relevantMemoriesAttachment); err != nil {
		t.Fatalf("read relevant_memories attachment failed: %v", err)
	}
	if relevantMemoriesAttachment["type"] != "attachment" || strings.TrimSpace(asString(relevantMemoriesAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected relevant_memories attachment envelope: %#v", relevantMemoriesAttachment)
	}
	relevantMemoriesPayload, _ := relevantMemoriesAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(relevantMemoriesPayload["type"])) != "relevant_memories" {
		t.Fatalf("unexpected relevant_memories attachment payload: %#v", relevantMemoriesAttachment)
	}
	relevantMemoriesList, _ := relevantMemoriesPayload["memories"].([]any)
	if len(relevantMemoriesList) != 1 {
		t.Fatalf("unexpected relevant_memories list: %#v", relevantMemoriesAttachment)
	}
	relevantMemory, _ := relevantMemoriesList[0].(map[string]any)
	mtimeMs, ok := relevantMemory["mtimeMs"].(float64)
	if strings.TrimSpace(asString(relevantMemory["path"])) != "memory/project.md" ||
		strings.TrimSpace(asString(relevantMemory["content"])) != "Project memory: keep nested context stable." ||
		!ok || int64(mtimeMs) != 1712700000000 ||
		strings.TrimSpace(asString(relevantMemory["header"])) != "## memory/project.md" ||
		int(relevantMemory["limit"].(float64)) != 1 {
		t.Fatalf("unexpected relevant_memories entry: %#v", relevantMemoriesAttachment)
	}
	var nestedMemoryAttachment map[string]any
	if err := ws.ReadJSON(&nestedMemoryAttachment); err != nil {
		t.Fatalf("read nested_memory attachment failed: %v", err)
	}
	if nestedMemoryAttachment["type"] != "attachment" || strings.TrimSpace(asString(nestedMemoryAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected nested_memory attachment envelope: %#v", nestedMemoryAttachment)
	}
	nestedMemoryPayload, _ := nestedMemoryAttachment["attachment"].(map[string]any)
	nestedMemoryContent, _ := nestedMemoryPayload["content"].(map[string]any)
	if strings.TrimSpace(asString(nestedMemoryPayload["type"])) != "nested_memory" || strings.TrimSpace(asString(nestedMemoryPayload["path"])) != "memory/project.md" || strings.TrimSpace(asString(nestedMemoryPayload["displayPath"])) != "memory/project.md" {
		t.Fatalf("unexpected nested_memory attachment payload: %#v", nestedMemoryAttachment)
	}
	if strings.TrimSpace(asString(nestedMemoryContent["path"])) != "memory/project.md" || strings.TrimSpace(asString(nestedMemoryContent["type"])) != "memory_file" || strings.TrimSpace(asString(nestedMemoryContent["content"])) != "Project memory: keep nested context stable." {
		t.Fatalf("unexpected nested_memory content payload: %#v", nestedMemoryAttachment)
	}
	var teammateShutdownBatchAttachment map[string]any
	if err := ws.ReadJSON(&teammateShutdownBatchAttachment); err != nil {
		t.Fatalf("read teammate_shutdown_batch attachment failed: %v", err)
	}
	if teammateShutdownBatchAttachment["type"] != "attachment" || strings.TrimSpace(asString(teammateShutdownBatchAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected teammate_shutdown_batch attachment envelope: %#v", teammateShutdownBatchAttachment)
	}
	teammateShutdownBatchPayload, _ := teammateShutdownBatchAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(teammateShutdownBatchPayload["type"])) != "teammate_shutdown_batch" || int(teammateShutdownBatchPayload["count"].(float64)) != 2 {
		t.Fatalf("unexpected teammate_shutdown_batch attachment payload: %#v", teammateShutdownBatchAttachment)
	}
	var bagelConsoleAttachment map[string]any
	if err := ws.ReadJSON(&bagelConsoleAttachment); err != nil {
		t.Fatalf("read bagel_console attachment failed: %v", err)
	}
	if bagelConsoleAttachment["type"] != "attachment" || strings.TrimSpace(asString(bagelConsoleAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected bagel_console attachment envelope: %#v", bagelConsoleAttachment)
	}
	bagelConsolePayload, _ := bagelConsoleAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(bagelConsolePayload["type"])) != "bagel_console" || int(bagelConsolePayload["errorCount"].(float64)) != 1 || int(bagelConsolePayload["warningCount"].(float64)) != 2 || strings.TrimSpace(asString(bagelConsolePayload["sample"])) != "bagel: sample warning" {
		t.Fatalf("unexpected bagel_console attachment payload: %#v", bagelConsoleAttachment)
	}
	var teammateMailboxAttachment map[string]any
	if err := ws.ReadJSON(&teammateMailboxAttachment); err != nil {
		t.Fatalf("read teammate_mailbox attachment failed: %v", err)
	}
	if teammateMailboxAttachment["type"] != "attachment" || strings.TrimSpace(asString(teammateMailboxAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected teammate_mailbox attachment envelope: %#v", teammateMailboxAttachment)
	}
	teammateMailboxPayload, _ := teammateMailboxAttachment["attachment"].(map[string]any)
	teammateMailboxMessages, _ := teammateMailboxPayload["messages"].([]any)
	if strings.TrimSpace(asString(teammateMailboxPayload["type"])) != "teammate_mailbox" || len(teammateMailboxMessages) != 1 {
		t.Fatalf("unexpected teammate_mailbox attachment payload: %#v", teammateMailboxAttachment)
	}
	teammateMailboxMessage, _ := teammateMailboxMessages[0].(map[string]any)
	if strings.TrimSpace(asString(teammateMailboxMessage["from"])) != "team-lead" || strings.TrimSpace(asString(teammateMailboxMessage["text"])) != "Please pick up the next task." || strings.TrimSpace(asString(teammateMailboxMessage["timestamp"])) != "2026-04-09T12:00:00Z" || strings.TrimSpace(asString(teammateMailboxMessage["color"])) != "blue" || strings.TrimSpace(asString(teammateMailboxMessage["summary"])) != "next task" {
		t.Fatalf("unexpected teammate_mailbox message payload: %#v", teammateMailboxAttachment)
	}
	var teamContextAttachment map[string]any
	if err := ws.ReadJSON(&teamContextAttachment); err != nil {
		t.Fatalf("read team_context attachment failed: %v", err)
	}
	if teamContextAttachment["type"] != "attachment" || strings.TrimSpace(asString(teamContextAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected team_context attachment envelope: %#v", teamContextAttachment)
	}
	teamContextPayload, _ := teamContextAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(teamContextPayload["type"])) != "team_context" || strings.TrimSpace(asString(teamContextPayload["agentId"])) != "agent-dev" || strings.TrimSpace(asString(teamContextPayload["agentName"])) != "dev" || strings.TrimSpace(asString(teamContextPayload["teamName"])) != "alpha" || strings.TrimSpace(asString(teamContextPayload["teamConfigPath"])) != ".claude/team.yaml" || strings.TrimSpace(asString(teamContextPayload["taskListPath"])) != ".claude/tasks.json" {
		t.Fatalf("unexpected team_context attachment payload: %#v", teamContextAttachment)
	}
	var skillDiscoveryAttachment map[string]any
	if err := ws.ReadJSON(&skillDiscoveryAttachment); err != nil {
		t.Fatalf("read skill_discovery attachment failed: %v", err)
	}
	if skillDiscoveryAttachment["type"] != "attachment" || strings.TrimSpace(asString(skillDiscoveryAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected skill_discovery attachment envelope: %#v", skillDiscoveryAttachment)
	}
	skillDiscoveryPayload, _ := skillDiscoveryAttachment["attachment"].(map[string]any)
	skillDiscoverySkills, _ := skillDiscoveryPayload["skills"].([]any)
	if strings.TrimSpace(asString(skillDiscoveryPayload["type"])) != "skill_discovery" || strings.TrimSpace(asString(skillDiscoveryPayload["signal"])) != "user_input" || strings.TrimSpace(asString(skillDiscoveryPayload["source"])) != "native" || len(skillDiscoverySkills) != 1 {
		t.Fatalf("unexpected skill_discovery attachment payload: %#v", skillDiscoveryAttachment)
	}
	skillDiscoverySkill, _ := skillDiscoverySkills[0].(map[string]any)
	if strings.TrimSpace(asString(skillDiscoverySkill["name"])) != "agent-manager" || strings.TrimSpace(asString(skillDiscoverySkill["description"])) != "Coordinate and track teammate work." || strings.TrimSpace(asString(skillDiscoverySkill["shortId"])) != "am" {
		t.Fatalf("unexpected skill_discovery skill payload: %#v", skillDiscoveryAttachment)
	}
	var dynamicSkillAttachment map[string]any
	if err := ws.ReadJSON(&dynamicSkillAttachment); err != nil {
		t.Fatalf("read dynamic_skill attachment failed: %v", err)
	}
	if dynamicSkillAttachment["type"] != "attachment" || strings.TrimSpace(asString(dynamicSkillAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected dynamic_skill attachment envelope: %#v", dynamicSkillAttachment)
	}
	dynamicSkillPayload, _ := dynamicSkillAttachment["attachment"].(map[string]any)
	dynamicSkillNames, _ := dynamicSkillPayload["skillNames"].([]any)
	if strings.TrimSpace(asString(dynamicSkillPayload["type"])) != "dynamic_skill" || strings.TrimSpace(asString(dynamicSkillPayload["skillDir"])) != ".codex/skills/agent-manager" || strings.TrimSpace(asString(dynamicSkillPayload["displayPath"])) != ".codex/skills" || len(dynamicSkillNames) != 2 {
		t.Fatalf("unexpected dynamic_skill attachment payload: %#v", dynamicSkillAttachment)
	}
	if strings.TrimSpace(asString(dynamicSkillNames[0])) != "agent-manager" || strings.TrimSpace(asString(dynamicSkillNames[1])) != "use-fractalbot" {
		t.Fatalf("unexpected dynamic_skill skillNames payload: %#v", dynamicSkillAttachment)
	}
	var skillListingAttachment map[string]any
	if err := ws.ReadJSON(&skillListingAttachment); err != nil {
		t.Fatalf("read skill_listing attachment failed: %v", err)
	}
	if skillListingAttachment["type"] != "attachment" || strings.TrimSpace(asString(skillListingAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected skill_listing attachment envelope: %#v", skillListingAttachment)
	}
	skillListingPayload, _ := skillListingAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(skillListingPayload["type"])) != "skill_listing" || strings.TrimSpace(asString(skillListingPayload["content"])) != "agent-manager: Coordinate and track teammate work." || int(skillListingPayload["skillCount"].(float64)) != 1 || skillListingPayload["isInitial"] != true {
		t.Fatalf("unexpected skill_listing attachment payload: %#v", skillListingAttachment)
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
	preservedSegment, _ := compactMetadata["preserved_segment"].(map[string]any)
	if strings.TrimSpace(asString(preservedSegment["head_uuid"])) != "seg-head-stub" || strings.TrimSpace(asString(preservedSegment["anchor_uuid"])) != "seg-anchor-stub" || strings.TrimSpace(asString(preservedSegment["tail_uuid"])) != "seg-tail-stub" {
		t.Fatalf("invalid compact_boundary preserved_segment payload: %#v", compactBoundary)
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
	var hookNonBlockingErrorAttachment map[string]any
	if err := ws.ReadJSON(&hookNonBlockingErrorAttachment); err != nil {
		t.Fatalf("read hook_non_blocking_error attachment failed: %v", err)
	}
	if hookNonBlockingErrorAttachment["type"] != "attachment" || strings.TrimSpace(asString(hookNonBlockingErrorAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected hook_non_blocking_error attachment envelope: %#v", hookNonBlockingErrorAttachment)
	}
	hookNonBlockingErrorPayload, _ := hookNonBlockingErrorAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(hookNonBlockingErrorPayload["type"])) != "hook_non_blocking_error" ||
		strings.TrimSpace(asString(hookNonBlockingErrorPayload["hookName"])) != "DirectConnectEchoHook" ||
		strings.TrimSpace(asString(hookNonBlockingErrorPayload["stderr"])) != "Direct-connect demo hook reported a recoverable issue." ||
		strings.TrimSpace(asString(hookNonBlockingErrorPayload["stdout"])) != "echo:hello [approved]" ||
		fmt.Sprint(hookNonBlockingErrorPayload["exitCode"]) != "1" ||
		strings.TrimSpace(asString(hookNonBlockingErrorPayload["toolUseID"])) != strings.TrimSpace(asString(request["tool_use_id"])) ||
		strings.TrimSpace(asString(hookNonBlockingErrorPayload["hookEvent"])) != "Stop" {
		t.Fatalf("unexpected hook_non_blocking_error attachment payload: %#v", hookNonBlockingErrorAttachment)
	}
	var hookCancelledAttachment map[string]any
	if err := ws.ReadJSON(&hookCancelledAttachment); err != nil {
		t.Fatalf("read hook_cancelled attachment failed: %v", err)
	}
	if hookCancelledAttachment["type"] != "attachment" || strings.TrimSpace(asString(hookCancelledAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected hook_cancelled attachment envelope: %#v", hookCancelledAttachment)
	}
	hookCancelledPayload, _ := hookCancelledAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(hookCancelledPayload["type"])) != "hook_cancelled" ||
		strings.TrimSpace(asString(hookCancelledPayload["hookName"])) != "DirectConnectEchoHook" ||
		strings.TrimSpace(asString(hookCancelledPayload["toolUseID"])) != strings.TrimSpace(asString(request["tool_use_id"])) ||
		strings.TrimSpace(asString(hookCancelledPayload["hookEvent"])) != "Stop" {
		t.Fatalf("unexpected hook_cancelled attachment payload: %#v", hookCancelledAttachment)
	}
	var hookSuccessAttachment map[string]any
	if err := ws.ReadJSON(&hookSuccessAttachment); err != nil {
		t.Fatalf("read hook_success attachment failed: %v", err)
	}
	if hookSuccessAttachment["type"] != "attachment" || strings.TrimSpace(asString(hookSuccessAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected hook_success attachment envelope: %#v", hookSuccessAttachment)
	}
	hookSuccessPayload, _ := hookSuccessAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(hookSuccessPayload["type"])) != "hook_success" ||
		strings.TrimSpace(asString(hookSuccessPayload["content"])) != "echo:hello [approved]" ||
		strings.TrimSpace(asString(hookSuccessPayload["hookName"])) != "DirectConnectEchoHook" ||
		strings.TrimSpace(asString(hookSuccessPayload["toolUseID"])) != strings.TrimSpace(asString(request["tool_use_id"])) ||
		strings.TrimSpace(asString(hookSuccessPayload["hookEvent"])) != "Stop" {
		t.Fatalf("unexpected hook_success attachment payload: %#v", hookSuccessAttachment)
	}
	var hookStoppedContinuationAttachment map[string]any
	if err := ws.ReadJSON(&hookStoppedContinuationAttachment); err != nil {
		t.Fatalf("read hook_stopped_continuation attachment failed: %v", err)
	}
	if hookStoppedContinuationAttachment["type"] != "attachment" || strings.TrimSpace(asString(hookStoppedContinuationAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected hook_stopped_continuation attachment envelope: %#v", hookStoppedContinuationAttachment)
	}
	hookStoppedContinuationPayload, _ := hookStoppedContinuationAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(hookStoppedContinuationPayload["type"])) != "hook_stopped_continuation" ||
		strings.TrimSpace(asString(hookStoppedContinuationPayload["message"])) != "Execution stopped by DirectConnectEchoHook." ||
		strings.TrimSpace(asString(hookStoppedContinuationPayload["hookName"])) != "DirectConnectEchoHook" ||
		strings.TrimSpace(asString(hookStoppedContinuationPayload["toolUseID"])) != strings.TrimSpace(asString(request["tool_use_id"])) ||
		strings.TrimSpace(asString(hookStoppedContinuationPayload["hookEvent"])) != "Stop" {
		t.Fatalf("unexpected hook_stopped_continuation attachment payload: %#v", hookStoppedContinuationAttachment)
	}
	var hookSystemMessageAttachment map[string]any
	if err := ws.ReadJSON(&hookSystemMessageAttachment); err != nil {
		t.Fatalf("read hook_system_message attachment failed: %v", err)
	}
	if hookSystemMessageAttachment["type"] != "attachment" || strings.TrimSpace(asString(hookSystemMessageAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected hook_system_message attachment envelope: %#v", hookSystemMessageAttachment)
	}
	hookSystemMessagePayload, _ := hookSystemMessageAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(hookSystemMessagePayload["type"])) != "hook_system_message" ||
		strings.TrimSpace(asString(hookSystemMessagePayload["content"])) != "Direct-connect echo stop hook acknowledged." ||
		strings.TrimSpace(asString(hookSystemMessagePayload["hookName"])) != "DirectConnectEchoHook" ||
		strings.TrimSpace(asString(hookSystemMessagePayload["toolUseID"])) != strings.TrimSpace(asString(request["tool_use_id"])) ||
		strings.TrimSpace(asString(hookSystemMessagePayload["hookEvent"])) != "Stop" {
		t.Fatalf("unexpected hook_system_message attachment payload: %#v", hookSystemMessageAttachment)
	}
	var hookAdditionalContextAttachment map[string]any
	if err := ws.ReadJSON(&hookAdditionalContextAttachment); err != nil {
		t.Fatalf("read hook_additional_context attachment failed: %v", err)
	}
	if hookAdditionalContextAttachment["type"] != "attachment" || strings.TrimSpace(asString(hookAdditionalContextAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected hook_additional_context attachment envelope: %#v", hookAdditionalContextAttachment)
	}
	hookAdditionalContextPayload, _ := hookAdditionalContextAttachment["attachment"].(map[string]any)
	hookAdditionalContextContent, _ := hookAdditionalContextPayload["content"].([]any)
	if strings.TrimSpace(asString(hookAdditionalContextPayload["type"])) != "hook_additional_context" ||
		len(hookAdditionalContextContent) != 1 ||
		strings.TrimSpace(asString(hookAdditionalContextContent[0])) != "Hook context: preserve the direct-connect stop-hook summary." ||
		strings.TrimSpace(asString(hookAdditionalContextPayload["hookName"])) != "DirectConnectEchoHook" ||
		strings.TrimSpace(asString(hookAdditionalContextPayload["toolUseID"])) != strings.TrimSpace(asString(request["tool_use_id"])) ||
		strings.TrimSpace(asString(hookAdditionalContextPayload["hookEvent"])) != "Stop" {
		t.Fatalf("unexpected hook_additional_context attachment payload: %#v", hookAdditionalContextAttachment)
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
	var secondHookPermissionDecisionAttachment map[string]any
	if err := ws.ReadJSON(&secondHookPermissionDecisionAttachment); err != nil {
		t.Fatalf("read second hook_permission_decision attachment failed: %v", err)
	}
	if secondHookPermissionDecisionAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondHookPermissionDecisionAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second hook_permission_decision attachment envelope: %#v", secondHookPermissionDecisionAttachment)
	}
	secondHookPermissionDecisionPayload, _ := secondHookPermissionDecisionAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondHookPermissionDecisionPayload["type"])) != "hook_permission_decision" ||
		strings.TrimSpace(asString(secondHookPermissionDecisionPayload["decision"])) != "allow" ||
		strings.TrimSpace(asString(secondHookPermissionDecisionPayload["toolUseID"])) != strings.TrimSpace(asString(secondRequest["tool_use_id"])) ||
		strings.TrimSpace(asString(secondHookPermissionDecisionPayload["hookEvent"])) != "PermissionRequest" {
		t.Fatalf("unexpected second hook_permission_decision attachment payload: %#v", secondHookPermissionDecisionAttachment)
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
	var secondMessageStartEvent map[string]any
	if err := ws.ReadJSON(&secondMessageStartEvent); err != nil {
		t.Fatalf("read second message_start event failed: %v", err)
	}
	if secondMessageStartEvent["type"] != "stream_event" {
		t.Fatalf("unexpected second message_start event envelope: %#v", secondMessageStartEvent)
	}
	secondMessageStartPayload, _ := secondMessageStartEvent["event"].(map[string]any)
	secondMessageStartMessage, _ := secondMessageStartPayload["message"].(map[string]any)
	if strings.TrimSpace(asString(secondMessageStartPayload["type"])) != "message_start" || strings.TrimSpace(asString(secondMessageStartMessage["id"])) == "" || strings.TrimSpace(asString(secondMessageStartMessage["type"])) != "message" || strings.TrimSpace(asString(secondMessageStartMessage["role"])) != "assistant" || strings.TrimSpace(asString(secondMessageStartMessage["model"])) != "claude-sonnet-4-5" {
		t.Fatalf("unexpected second message_start payload: %#v", secondMessageStartEvent)
	}
	assertZeroUsageShape(t, secondMessageStartMessage, "second message_start")
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
	var secondThinkingStreamEvent map[string]any
	if err := ws.ReadJSON(&secondThinkingStreamEvent); err != nil {
		t.Fatalf("read second thinking stream event failed: %v", err)
	}
	if secondThinkingStreamEvent["type"] != "stream_event" {
		t.Fatalf("unexpected second thinking stream event envelope: %#v", secondThinkingStreamEvent)
	}
	secondThinkingStreamPayload, _ := secondThinkingStreamEvent["event"].(map[string]any)
	secondThinkingStreamDelta, _ := secondThinkingStreamPayload["delta"].(map[string]any)
	if strings.TrimSpace(asString(secondThinkingStreamPayload["type"])) != "content_block_delta" || strings.TrimSpace(asString(secondThinkingStreamDelta["type"])) != "thinking_delta" || strings.TrimSpace(asString(secondThinkingStreamDelta["thinking"])) != "direct-connect stub thinking" {
		t.Fatalf("unexpected second thinking stream event payload: %#v", secondThinkingStreamEvent)
	}
	var secondSignatureStreamEvent map[string]any
	if err := ws.ReadJSON(&secondSignatureStreamEvent); err != nil {
		t.Fatalf("read second signature stream event failed: %v", err)
	}
	if secondSignatureStreamEvent["type"] != "stream_event" {
		t.Fatalf("unexpected second signature stream event envelope: %#v", secondSignatureStreamEvent)
	}
	secondSignatureStreamPayload, _ := secondSignatureStreamEvent["event"].(map[string]any)
	secondSignatureStreamDelta, _ := secondSignatureStreamPayload["delta"].(map[string]any)
	if strings.TrimSpace(asString(secondSignatureStreamPayload["type"])) != "content_block_delta" || strings.TrimSpace(asString(secondSignatureStreamDelta["type"])) != "signature_delta" || strings.TrimSpace(asString(secondSignatureStreamDelta["signature"])) != "sig-direct-connect-stub" {
		t.Fatalf("unexpected second signature stream event payload: %#v", secondSignatureStreamEvent)
	}
	var secondToolUseStartEvent map[string]any
	if err := ws.ReadJSON(&secondToolUseStartEvent); err != nil {
		t.Fatalf("read second tool_use start event failed: %v", err)
	}
	if secondToolUseStartEvent["type"] != "stream_event" {
		t.Fatalf("unexpected second tool_use start event envelope: %#v", secondToolUseStartEvent)
	}
	secondToolUseStartPayload, _ := secondToolUseStartEvent["event"].(map[string]any)
	secondToolUseContentBlock, _ := secondToolUseStartPayload["content_block"].(map[string]any)
	if strings.TrimSpace(asString(secondToolUseStartPayload["type"])) != "content_block_start" || strings.TrimSpace(asString(secondToolUseContentBlock["type"])) != "tool_use" || strings.TrimSpace(asString(secondToolUseContentBlock["id"])) != strings.TrimSpace(asString(secondRequest["tool_use_id"])) || strings.TrimSpace(asString(secondToolUseContentBlock["name"])) != directConnectEchoToolName || strings.TrimSpace(asString(secondToolUseContentBlock["input"])) != "" {
		t.Fatalf("unexpected second tool_use start event payload: %#v", secondToolUseStartEvent)
	}
	var secondToolUseStreamEvent map[string]any
	if err := ws.ReadJSON(&secondToolUseStreamEvent); err != nil {
		t.Fatalf("read second tool_use stream event failed: %v", err)
	}
	if secondToolUseStreamEvent["type"] != "stream_event" {
		t.Fatalf("unexpected second tool_use stream event envelope: %#v", secondToolUseStreamEvent)
	}
	secondToolUseStreamPayload, _ := secondToolUseStreamEvent["event"].(map[string]any)
	secondToolUseStreamDelta, _ := secondToolUseStreamPayload["delta"].(map[string]any)
	if strings.TrimSpace(asString(secondToolUseStreamPayload["type"])) != "content_block_delta" || strings.TrimSpace(asString(secondToolUseStreamDelta["type"])) != "input_json_delta" || strings.TrimSpace(asString(secondToolUseStreamDelta["partial_json"])) != "{\"text\":\"hello again [approved]\"}" {
		t.Fatalf("unexpected second tool_use stream event payload: %#v", secondToolUseStreamEvent)
	}
	var secondToolUseStopEvent map[string]any
	if err := ws.ReadJSON(&secondToolUseStopEvent); err != nil {
		t.Fatalf("read second tool_use stop event failed: %v", err)
	}
	if secondToolUseStopEvent["type"] != "stream_event" {
		t.Fatalf("unexpected second tool_use stop event envelope: %#v", secondToolUseStopEvent)
	}
	secondToolUseStopPayload, _ := secondToolUseStopEvent["event"].(map[string]any)
	if strings.TrimSpace(asString(secondToolUseStopPayload["type"])) != "content_block_stop" {
		t.Fatalf("unexpected second tool_use stop event payload: %#v", secondToolUseStopEvent)
	}
	var secondMessageDeltaEvent map[string]any
	if err := ws.ReadJSON(&secondMessageDeltaEvent); err != nil {
		t.Fatalf("read second message_delta event failed: %v", err)
	}
	if secondMessageDeltaEvent["type"] != "stream_event" {
		t.Fatalf("unexpected second message_delta event envelope: %#v", secondMessageDeltaEvent)
	}
	secondMessageDeltaPayload, _ := secondMessageDeltaEvent["event"].(map[string]any)
	secondMessageDeltaDelta, _ := secondMessageDeltaPayload["delta"].(map[string]any)
	if strings.TrimSpace(asString(secondMessageDeltaPayload["type"])) != "message_delta" || strings.TrimSpace(asString(secondMessageDeltaDelta["stop_reason"])) != "end_turn" {
		t.Fatalf("unexpected second message_delta payload: %#v", secondMessageDeltaEvent)
	}
	assertZeroUsageShape(t, secondMessageDeltaPayload, "second message_delta")
	var secondMessageStopEvent map[string]any
	if err := ws.ReadJSON(&secondMessageStopEvent); err != nil {
		t.Fatalf("read second message_stop event failed: %v", err)
	}
	if secondMessageStopEvent["type"] != "stream_event" {
		t.Fatalf("unexpected second message_stop event envelope: %#v", secondMessageStopEvent)
	}
	secondMessageStopPayload, _ := secondMessageStopEvent["event"].(map[string]any)
	if strings.TrimSpace(asString(secondMessageStopPayload["type"])) != "message_stop" {
		t.Fatalf("unexpected second message_stop payload: %#v", secondMessageStopEvent)
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
	if len(secondContent) < 3 {
		t.Fatalf("unexpected second assistant payload: %#v", secondAssistant)
	}
	if strings.TrimSpace(asString(secondAssistant["stop_reason"])) != "end_turn" {
		t.Fatalf("unexpected second assistant stop_reason: %#v", secondAssistant)
	}
	assertZeroUsageShape(t, secondAssistant, "second assistant")
	secondThinkingBlock, _ := secondContent[0].(map[string]any)
	secondToolUseBlock, _ := secondContent[1].(map[string]any)
	secondTextBlock, _ := secondContent[2].(map[string]any)
	secondToolUseInput, _ := secondToolUseBlock["input"].(map[string]any)
	if strings.TrimSpace(asString(secondThinkingBlock["type"])) != "thinking" || strings.TrimSpace(asString(secondThinkingBlock["thinking"])) != "direct-connect stub thinking" || strings.TrimSpace(asString(secondThinkingBlock["signature"])) != "sig-direct-connect-stub" || strings.TrimSpace(asString(secondToolUseBlock["type"])) != "tool_use" || strings.TrimSpace(asString(secondToolUseBlock["id"])) != strings.TrimSpace(asString(secondRequest["tool_use_id"])) || strings.TrimSpace(asString(secondToolUseBlock["name"])) != directConnectEchoToolName || strings.TrimSpace(asString(secondToolUseInput["text"])) != "hello again [approved]" || strings.TrimSpace(asString(secondTextBlock["type"])) != "text" || strings.TrimSpace(asString(secondTextBlock["text"])) != "echo:hello again [approved]" {
		t.Fatalf("unexpected second assistant payload: %#v", secondAssistant)
	}
	var secondToolSummary map[string]any
	if err := ws.ReadJSON(&secondToolSummary); err != nil {
		t.Fatalf("read second tool summary failed: %v", err)
	}
	secondPrecedingToolUseIDs, _ := secondToolSummary["preceding_tool_use_ids"].([]any)
	if secondToolSummary["type"] != "tool_use_summary" || strings.TrimSpace(asString(secondToolSummary["tool_name"])) != directConnectEchoToolName || strings.TrimSpace(asString(secondToolSummary["tool_use_id"])) != strings.TrimSpace(asString(secondRequest["tool_use_id"])) || strings.TrimSpace(asString(secondToolSummary["output_preview"])) != "echo:hello again [approved]" || strings.TrimSpace(asString(secondToolSummary["summary"])) != "Used echo 1 time" || len(secondPrecedingToolUseIDs) == 0 || strings.TrimSpace(asString(secondPrecedingToolUseIDs[0])) != strings.TrimSpace(asString(secondRequest["tool_use_id"])) {
		t.Fatalf("unexpected second tool summary payload: %#v", secondToolSummary)
	}
	var secondStreamlinedToolSummary map[string]any
	if err := ws.ReadJSON(&secondStreamlinedToolSummary); err != nil {
		t.Fatalf("read second streamlined_tool_use_summary failed: %v", err)
	}
	if secondStreamlinedToolSummary["type"] != "streamlined_tool_use_summary" || strings.TrimSpace(asString(secondStreamlinedToolSummary["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(secondStreamlinedToolSummary["tool_summary"])) != "Used echo 1 time" {
		t.Fatalf("unexpected second streamlined_tool_use_summary payload: %#v", secondStreamlinedToolSummary)
	}
	var secondStructuredOutputAttachment map[string]any
	if err := ws.ReadJSON(&secondStructuredOutputAttachment); err != nil {
		t.Fatalf("read second structured_output attachment failed: %v", err)
	}
	if secondStructuredOutputAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondStructuredOutputAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second structured_output attachment envelope: %#v", secondStructuredOutputAttachment)
	}
	secondStructuredOutputAttachmentPayload, _ := secondStructuredOutputAttachment["attachment"].(map[string]any)
	secondStructuredOutputAttachmentData, _ := secondStructuredOutputAttachmentPayload["data"].(map[string]any)
	if strings.TrimSpace(asString(secondStructuredOutputAttachmentPayload["type"])) != "structured_output" || strings.TrimSpace(asString(secondStructuredOutputAttachmentData["text"])) != "echo:hello again [approved]" {
		t.Fatalf("unexpected second structured_output attachment payload: %#v", secondStructuredOutputAttachment)
	}
	var secondResult map[string]any
	if err := ws.ReadJSON(&secondResult); err != nil {
		t.Fatalf("read second result event failed: %v", err)
	}
	if secondResult["type"] != "result" || strings.TrimSpace(asString(secondResult["subtype"])) != "success" || strings.TrimSpace(asString(secondResult["result"])) != "echo:hello again [approved]" || strings.TrimSpace(asString(secondResult["fast_mode_state"])) != "off" {
		t.Fatalf("unexpected second result event: %#v", secondResult)
	}
	secondStructuredOutput, _ := secondResult["structured_output"].(map[string]any)
	if strings.TrimSpace(asString(secondStructuredOutput["text"])) != "echo:hello again [approved]" {
		t.Fatalf("unexpected second result structured_output: %#v", secondResult)
	}
	secondUsage, _ := secondResult["usage"].(map[string]any)
	secondServerToolUse, _ := secondUsage["server_tool_use"].(map[string]any)
	secondCacheCreation, _ := secondUsage["cache_creation"].(map[string]any)
	secondIterations, _ := secondUsage["iterations"].([]any)
	if intFromAny(secondUsage["input_tokens"]) != 0 || intFromAny(secondUsage["cache_creation_input_tokens"]) != 0 || intFromAny(secondUsage["cache_read_input_tokens"]) != 0 || intFromAny(secondUsage["output_tokens"]) != 0 || intFromAny(secondServerToolUse["web_search_requests"]) != 0 || intFromAny(secondServerToolUse["web_fetch_requests"]) != 0 || strings.TrimSpace(asString(secondUsage["service_tier"])) != "standard" || intFromAny(secondCacheCreation["ephemeral_1h_input_tokens"]) != 0 || intFromAny(secondCacheCreation["ephemeral_5m_input_tokens"]) != 0 || strings.TrimSpace(asString(secondUsage["inference_geo"])) != "" || len(secondIterations) != 0 || strings.TrimSpace(asString(secondUsage["speed"])) != "standard" {
		t.Fatalf("unexpected second result usage: %#v", secondResult)
	}
	secondModelUsage, _ := secondResult["modelUsage"].(map[string]any)
	secondModelUsageEntry, _ := secondModelUsage["claude-sonnet-4-5"].(map[string]any)
	if len(secondModelUsageEntry) == 0 || intFromAny(secondModelUsageEntry["inputTokens"]) != 0 || intFromAny(secondModelUsageEntry["outputTokens"]) != 0 || intFromAny(secondModelUsageEntry["cacheReadInputTokens"]) != 0 || intFromAny(secondModelUsageEntry["cacheCreationInputTokens"]) != 0 || intFromAny(secondModelUsageEntry["webSearchRequests"]) != 0 || intFromAny(secondModelUsageEntry["contextWindow"]) != 0 || float64FromAny(secondModelUsageEntry["costUSD"]) != 0 {
		t.Fatalf("unexpected second result modelUsage: %#v", secondResult)
	}
	secondPermissionDenials, _ := secondResult["permission_denials"].([]any)
	if len(secondPermissionDenials) != 0 {
		t.Fatalf("unexpected second success result permission_denials: %#v", secondResult)
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
	var secondQueuedCommandAttachment map[string]any
	if err := ws.ReadJSON(&secondQueuedCommandAttachment); err != nil {
		t.Fatalf("read second queued_command attachment failed: %v", err)
	}
	if secondQueuedCommandAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondQueuedCommandAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second queued_command attachment envelope: %#v", secondQueuedCommandAttachment)
	}
	secondQueuedCommandPayload, _ := secondQueuedCommandAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondQueuedCommandPayload["type"])) != "queued_command" || strings.TrimSpace(asString(secondQueuedCommandPayload["commandMode"])) != "task-notification" || strings.TrimSpace(asString(secondQueuedCommandPayload["prompt"])) == "" {
		t.Fatalf("unexpected second queued_command attachment payload: %#v", secondQueuedCommandAttachment)
	}
	assertTaskStatusAttachment(t, ws, parsed["session_id"], strings.TrimSpace(asString(secondTaskStarted["task_id"])), "direct-connect echo task", "echo:hello again [approved]", "second task_notification")
	var secondTaskReminderAttachment map[string]any
	if err := ws.ReadJSON(&secondTaskReminderAttachment); err != nil {
		t.Fatalf("read second task_reminder attachment failed: %v", err)
	}
	if secondTaskReminderAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondTaskReminderAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second task_reminder attachment envelope: %#v", secondTaskReminderAttachment)
	}
	secondTaskReminderPayload, _ := secondTaskReminderAttachment["attachment"].(map[string]any)
	secondTaskReminderContent, _ := secondTaskReminderPayload["content"].([]any)
	secondTaskReminder, _ := secondTaskReminderContent[0].(map[string]any)
	if strings.TrimSpace(asString(secondTaskReminderPayload["type"])) != "task_reminder" || intFromAny(secondTaskReminderPayload["itemCount"]) != 1 || len(secondTaskReminderContent) != 1 || strings.TrimSpace(asString(secondTaskReminder["id"])) != strings.TrimSpace(asString(secondTaskStarted["task_id"])) || strings.TrimSpace(asString(secondTaskReminder["status"])) != "completed" || strings.TrimSpace(asString(secondTaskReminder["subject"])) != "direct-connect echo task" {
		t.Fatalf("unexpected second task_reminder attachment payload: %#v", secondTaskReminderAttachment)
	}
	var secondTodoReminderAttachment map[string]any
	if err := ws.ReadJSON(&secondTodoReminderAttachment); err != nil {
		t.Fatalf("read second todo_reminder attachment failed: %v", err)
	}
	if secondTodoReminderAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondTodoReminderAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second todo_reminder attachment envelope: %#v", secondTodoReminderAttachment)
	}
	secondTodoReminderPayload, _ := secondTodoReminderAttachment["attachment"].(map[string]any)
	secondTodoReminderContent, _ := secondTodoReminderPayload["content"].([]any)
	secondTodoReminder, _ := secondTodoReminderContent[0].(map[string]any)
	if strings.TrimSpace(asString(secondTodoReminderPayload["type"])) != "todo_reminder" || intFromAny(secondTodoReminderPayload["itemCount"]) != 1 || len(secondTodoReminderContent) != 1 || strings.TrimSpace(asString(secondTodoReminder["content"])) != "direct-connect echo task" || strings.TrimSpace(asString(secondTodoReminder["status"])) != "completed" || strings.TrimSpace(asString(secondTodoReminder["activeForm"])) != "Completing direct-connect echo task" {
		t.Fatalf("unexpected second todo_reminder attachment payload: %#v", secondTodoReminderAttachment)
	}
	var secondAgentMentionAttachment map[string]any
	if err := ws.ReadJSON(&secondAgentMentionAttachment); err != nil {
		t.Fatalf("read second agent_mention attachment failed: %v", err)
	}
	if secondAgentMentionAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondAgentMentionAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second agent_mention attachment envelope: %#v", secondAgentMentionAttachment)
	}
	secondAgentMentionPayload, _ := secondAgentMentionAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondAgentMentionPayload["type"])) != "agent_mention" || strings.TrimSpace(asString(secondAgentMentionPayload["agentType"])) != stubAgentMentionType {
		t.Fatalf("unexpected second agent_mention attachment payload: %#v", secondAgentMentionAttachment)
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
	var secondLocalCommandOutputAssistant map[string]any
	if err := ws.ReadJSON(&secondLocalCommandOutputAssistant); err != nil {
		t.Fatalf("read second local_command_output assistant mirror failed: %v", err)
	}
	if secondLocalCommandOutputAssistant["type"] != "assistant" || strings.TrimSpace(asString(secondLocalCommandOutputAssistant["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(secondLocalCommandOutputAssistant["uuid"])) == "" {
		t.Fatalf("unexpected second local_command_output assistant mirror payload: %#v", secondLocalCommandOutputAssistant)
	}
	if secondLocalCommandOutputAssistant["parent_tool_use_id"] != nil {
		t.Fatalf("expected second local_command_output assistant mirror parent_tool_use_id=nil, got %#v", secondLocalCommandOutputAssistant)
	}
	secondLocalCommandOutputAssistantMessage, _ := secondLocalCommandOutputAssistant["message"].(map[string]any)
	if strings.TrimSpace(asString(secondLocalCommandOutputAssistantMessage["role"])) != "assistant" {
		t.Fatalf("invalid second local_command_output assistant mirror message payload: %#v", secondLocalCommandOutputAssistant)
	}
	secondLocalCommandOutputAssistantContent, _ := secondLocalCommandOutputAssistantMessage["content"].([]any)
	if len(secondLocalCommandOutputAssistantContent) == 0 {
		t.Fatalf("missing second local_command_output assistant mirror content: %#v", secondLocalCommandOutputAssistant)
	}
	secondLocalCommandOutputAssistantText, _ := secondLocalCommandOutputAssistantContent[0].(map[string]any)
	if strings.TrimSpace(asString(secondLocalCommandOutputAssistantText["type"])) != "text" || strings.TrimSpace(asString(secondLocalCommandOutputAssistantText["text"])) != "local command output: persisted direct-connect artifacts" {
		t.Fatalf("invalid second local_command_output assistant mirror content payload: %#v", secondLocalCommandOutputAssistant)
	}
	var secondCompactSummary map[string]any
	if err := ws.ReadJSON(&secondCompactSummary); err != nil {
		t.Fatalf("read second compact summary failed: %v", err)
	}
	if secondCompactSummary["type"] != "user" || secondCompactSummary["isReplay"] != false || secondCompactSummary["isSynthetic"] != true || strings.TrimSpace(asString(secondCompactSummary["session_id"])) != parsed["session_id"] || strings.TrimSpace(asString(secondCompactSummary["uuid"])) == "" || strings.TrimSpace(asString(secondCompactSummary["timestamp"])) == "" {
		t.Fatalf("unexpected second compact summary payload: %#v", secondCompactSummary)
	}
	if secondCompactSummary["parent_tool_use_id"] != nil {
		t.Fatalf("expected second compact summary parent_tool_use_id=nil, got %#v", secondCompactSummary)
	}
	secondCompactSummaryMessage, _ := secondCompactSummary["message"].(map[string]any)
	if strings.TrimSpace(asString(secondCompactSummaryMessage["role"])) != "user" || strings.TrimSpace(asString(secondCompactSummaryMessage["content"])) == "" {
		t.Fatalf("invalid second compact summary message payload: %#v", secondCompactSummary)
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
	var secondCriticalSystemReminderAttachment map[string]any
	if err := ws.ReadJSON(&secondCriticalSystemReminderAttachment); err != nil {
		t.Fatalf("read second critical_system_reminder attachment failed: %v", err)
	}
	if secondCriticalSystemReminderAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondCriticalSystemReminderAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second critical_system_reminder attachment envelope: %#v", secondCriticalSystemReminderAttachment)
	}
	secondCriticalSystemReminderPayload, _ := secondCriticalSystemReminderAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondCriticalSystemReminderPayload["type"])) != "critical_system_reminder" || strings.TrimSpace(asString(secondCriticalSystemReminderPayload["content"])) != "Critical system reminder: stay inside the local workspace and avoid destructive actions without explicit confirmation." {
		t.Fatalf("unexpected second critical_system_reminder attachment payload: %#v", secondCriticalSystemReminderAttachment)
	}
	var secondOutputStyleAttachment map[string]any
	if err := ws.ReadJSON(&secondOutputStyleAttachment); err != nil {
		t.Fatalf("read second output_style attachment failed: %v", err)
	}
	if secondOutputStyleAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondOutputStyleAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second output_style attachment envelope: %#v", secondOutputStyleAttachment)
	}
	secondOutputStylePayload, _ := secondOutputStyleAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondOutputStylePayload["type"])) != "output_style" || strings.TrimSpace(asString(secondOutputStylePayload["style"])) != "explanatory" {
		t.Fatalf("unexpected second output_style attachment payload: %#v", secondOutputStyleAttachment)
	}
	var secondSelectedLinesInIDEAttachment map[string]any
	if err := ws.ReadJSON(&secondSelectedLinesInIDEAttachment); err != nil {
		t.Fatalf("read second selected_lines_in_ide attachment failed: %v", err)
	}
	if secondSelectedLinesInIDEAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondSelectedLinesInIDEAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second selected_lines_in_ide attachment envelope: %#v", secondSelectedLinesInIDEAttachment)
	}
	secondSelectedLinesInIDEPayload, _ := secondSelectedLinesInIDEAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondSelectedLinesInIDEPayload["type"])) != "selected_lines_in_ide" ||
		strings.TrimSpace(asString(secondSelectedLinesInIDEPayload["ideName"])) != "VS Code" ||
		intFromAny(secondSelectedLinesInIDEPayload["lineStart"]) != 12 ||
		intFromAny(secondSelectedLinesInIDEPayload["lineEnd"]) != 14 ||
		strings.TrimSpace(asString(secondSelectedLinesInIDEPayload["filename"])) != "internal/server/server.go" ||
		asString(secondSelectedLinesInIDEPayload["content"]) != "func streamReply() {\n\twriteAttachment(\"selected_lines_in_ide\")\n}\n" ||
		strings.TrimSpace(asString(secondSelectedLinesInIDEPayload["displayPath"])) != "internal/server/server.go" {
		t.Fatalf("unexpected second selected_lines_in_ide attachment payload: %#v", secondSelectedLinesInIDEAttachment)
	}
	var secondOpenedFileInIDEAttachment map[string]any
	if err := ws.ReadJSON(&secondOpenedFileInIDEAttachment); err != nil {
		t.Fatalf("read second opened_file_in_ide attachment failed: %v", err)
	}
	if secondOpenedFileInIDEAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondOpenedFileInIDEAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second opened_file_in_ide attachment envelope: %#v", secondOpenedFileInIDEAttachment)
	}
	secondOpenedFileInIDEPayload, _ := secondOpenedFileInIDEAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondOpenedFileInIDEPayload["type"])) != "opened_file_in_ide" || strings.TrimSpace(asString(secondOpenedFileInIDEPayload["filename"])) != "internal/server/server.go" {
		t.Fatalf("unexpected second opened_file_in_ide attachment payload: %#v", secondOpenedFileInIDEAttachment)
	}
	assertDiagnosticsAttachment(t, ws, parsed["session_id"], "second diagnostics")
	assertDiagnosticsAttachment(t, ws, parsed["session_id"], "second lsp_diagnostics")
	assertTaskStatusAttachment(t, ws, parsed["session_id"], strings.TrimSpace(asString(secondTaskStarted["task_id"])), "direct-connect echo task", "echo:hello again [approved]", "second unified_tasks")
	var secondMCPResourceAttachment map[string]any
	if err := ws.ReadJSON(&secondMCPResourceAttachment); err != nil {
		t.Fatalf("read second mcp_resource attachment failed: %v", err)
	}
	if secondMCPResourceAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondMCPResourceAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second mcp_resource attachment envelope: %#v", secondMCPResourceAttachment)
	}
	secondMCPResourcePayload, _ := secondMCPResourceAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondMCPResourcePayload["type"])) != "mcp_resource" ||
		strings.TrimSpace(asString(secondMCPResourcePayload["server"])) != "demo-mcp" ||
		strings.TrimSpace(asString(secondMCPResourcePayload["uri"])) != "resource://demo/readme" ||
		strings.TrimSpace(asString(secondMCPResourcePayload["name"])) != "Demo README" ||
		strings.TrimSpace(asString(secondMCPResourcePayload["description"])) != "demo resource" {
		t.Fatalf("unexpected second mcp_resource attachment payload: %#v", secondMCPResourceAttachment)
	}
	secondMCPResourceContent, _ := secondMCPResourcePayload["content"].(map[string]any)
	secondMCPResourceContents, _ := secondMCPResourceContent["contents"].([]any)
	if len(secondMCPResourceContents) != 1 {
		t.Fatalf("unexpected second mcp_resource contents: %#v", secondMCPResourceAttachment)
	}
	secondMCPResourceItem, _ := secondMCPResourceContents[0].(map[string]any)
	if strings.TrimSpace(asString(secondMCPResourceItem["uri"])) != "resource://demo/readme" ||
		strings.TrimSpace(asString(secondMCPResourceItem["mimeType"])) != "text/plain" ||
		strings.TrimSpace(asString(secondMCPResourceItem["text"])) != "Demo MCP resource contents." {
		t.Fatalf("unexpected second mcp_resource content item: %#v", secondMCPResourceAttachment)
	}
	var secondBudgetUSDAttachment map[string]any
	if err := ws.ReadJSON(&secondBudgetUSDAttachment); err != nil {
		t.Fatalf("read second budget_usd attachment failed: %v", err)
	}
	if secondBudgetUSDAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondBudgetUSDAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second budget_usd attachment envelope: %#v", secondBudgetUSDAttachment)
	}
	secondBudgetUSDPayload, _ := secondBudgetUSDAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondBudgetUSDPayload["type"])) != "budget_usd" || int(secondBudgetUSDPayload["used"].(float64)) != 12 || int(secondBudgetUSDPayload["total"].(float64)) != 20 || int(secondBudgetUSDPayload["remaining"].(float64)) != 8 {
		t.Fatalf("unexpected second budget_usd attachment payload: %#v", secondBudgetUSDAttachment)
	}
	var secondCompactionReminderAttachment map[string]any
	if err := ws.ReadJSON(&secondCompactionReminderAttachment); err != nil {
		t.Fatalf("read second compaction_reminder attachment failed: %v", err)
	}
	if secondCompactionReminderAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondCompactionReminderAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second compaction_reminder attachment envelope: %#v", secondCompactionReminderAttachment)
	}
	secondCompactionReminderPayload, _ := secondCompactionReminderAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondCompactionReminderPayload["type"])) != "compaction_reminder" {
		t.Fatalf("unexpected second compaction_reminder attachment payload: %#v", secondCompactionReminderAttachment)
	}
	var secondContextEfficiencyAttachment map[string]any
	if err := ws.ReadJSON(&secondContextEfficiencyAttachment); err != nil {
		t.Fatalf("read second context_efficiency attachment failed: %v", err)
	}
	if secondContextEfficiencyAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondContextEfficiencyAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second context_efficiency attachment envelope: %#v", secondContextEfficiencyAttachment)
	}
	secondContextEfficiencyPayload, _ := secondContextEfficiencyAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondContextEfficiencyPayload["type"])) != "context_efficiency" {
		t.Fatalf("unexpected second context_efficiency attachment payload: %#v", secondContextEfficiencyAttachment)
	}
	var secondAutoModeAttachment map[string]any
	if err := ws.ReadJSON(&secondAutoModeAttachment); err != nil {
		t.Fatalf("read second auto_mode attachment failed: %v", err)
	}
	if secondAutoModeAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondAutoModeAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second auto_mode attachment envelope: %#v", secondAutoModeAttachment)
	}
	secondAutoModePayload, _ := secondAutoModeAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondAutoModePayload["type"])) != "auto_mode" || strings.TrimSpace(asString(secondAutoModePayload["reminderType"])) != "full" {
		t.Fatalf("unexpected second auto_mode attachment payload: %#v", secondAutoModeAttachment)
	}
	var secondAutoModeExitAttachment map[string]any
	if err := ws.ReadJSON(&secondAutoModeExitAttachment); err != nil {
		t.Fatalf("read second auto_mode_exit attachment failed: %v", err)
	}
	if secondAutoModeExitAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondAutoModeExitAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second auto_mode_exit attachment envelope: %#v", secondAutoModeExitAttachment)
	}
	secondAutoModeExitPayload, _ := secondAutoModeExitAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondAutoModeExitPayload["type"])) != "auto_mode_exit" {
		t.Fatalf("unexpected second auto_mode_exit attachment payload: %#v", secondAutoModeExitAttachment)
	}
	var secondPlanModeAttachment map[string]any
	if err := ws.ReadJSON(&secondPlanModeAttachment); err != nil {
		t.Fatalf("read second plan_mode attachment failed: %v", err)
	}
	if secondPlanModeAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondPlanModeAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second plan_mode attachment envelope: %#v", secondPlanModeAttachment)
	}
	secondPlanModePayload, _ := secondPlanModeAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondPlanModePayload["type"])) != "plan_mode" || strings.TrimSpace(asString(secondPlanModePayload["reminderType"])) != "full" || strings.TrimSpace(asString(secondPlanModePayload["planFilePath"])) == "" {
		t.Fatalf("unexpected second plan_mode attachment payload: %#v", secondPlanModeAttachment)
	}
	if planExists, ok := secondPlanModePayload["planExists"].(bool); !ok || planExists {
		t.Fatalf("invalid second plan_mode attachment payload: %#v", secondPlanModeAttachment)
	}
	if isSubAgent, ok := secondPlanModePayload["isSubAgent"].(bool); !ok || isSubAgent {
		t.Fatalf("invalid second plan_mode attachment payload: %#v", secondPlanModeAttachment)
	}
	var secondPlanModeExitAttachment map[string]any
	if err := ws.ReadJSON(&secondPlanModeExitAttachment); err != nil {
		t.Fatalf("read second plan_mode_exit attachment failed: %v", err)
	}
	if secondPlanModeExitAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondPlanModeExitAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second plan_mode_exit attachment envelope: %#v", secondPlanModeExitAttachment)
	}
	secondPlanModeExitPayload, _ := secondPlanModeExitAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondPlanModeExitPayload["type"])) != "plan_mode_exit" || strings.TrimSpace(asString(secondPlanModeExitPayload["planFilePath"])) == "" {
		t.Fatalf("unexpected second plan_mode_exit attachment payload: %#v", secondPlanModeExitAttachment)
	}
	if planExists, ok := secondPlanModeExitPayload["planExists"].(bool); !ok || planExists {
		t.Fatalf("invalid second plan_mode_exit attachment payload: %#v", secondPlanModeExitAttachment)
	}
	var secondPlanModeReentryAttachment map[string]any
	if err := ws.ReadJSON(&secondPlanModeReentryAttachment); err != nil {
		t.Fatalf("read second plan_mode_reentry attachment failed: %v", err)
	}
	if secondPlanModeReentryAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondPlanModeReentryAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second plan_mode_reentry attachment envelope: %#v", secondPlanModeReentryAttachment)
	}
	secondPlanModeReentryPayload, _ := secondPlanModeReentryAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondPlanModeReentryPayload["type"])) != "plan_mode_reentry" || strings.TrimSpace(asString(secondPlanModeReentryPayload["planFilePath"])) == "" {
		t.Fatalf("unexpected second plan_mode_reentry attachment payload: %#v", secondPlanModeReentryAttachment)
	}
	var secondPlanFileReferenceAttachment map[string]any
	if err := ws.ReadJSON(&secondPlanFileReferenceAttachment); err != nil {
		t.Fatalf("read second plan_file_reference attachment failed: %v", err)
	}
	if secondPlanFileReferenceAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondPlanFileReferenceAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second plan_file_reference attachment envelope: %#v", secondPlanFileReferenceAttachment)
	}
	secondPlanFileReferencePayload, _ := secondPlanFileReferenceAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondPlanFileReferencePayload["type"])) != "plan_file_reference" || strings.TrimSpace(asString(secondPlanFileReferencePayload["planFilePath"])) == "" {
		t.Fatalf("unexpected second plan_file_reference attachment payload: %#v", secondPlanFileReferenceAttachment)
	}
	if strings.TrimSpace(asString(secondPlanFileReferencePayload["planContent"])) != stubPlanFileReferenceContent {
		t.Fatalf("invalid second plan_file_reference attachment payload: %#v", secondPlanFileReferenceAttachment)
	}
	var secondInvokedSkillsAttachment map[string]any
	if err := ws.ReadJSON(&secondInvokedSkillsAttachment); err != nil {
		t.Fatalf("read second invoked_skills attachment failed: %v", err)
	}
	if secondInvokedSkillsAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondInvokedSkillsAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second invoked_skills attachment envelope: %#v", secondInvokedSkillsAttachment)
	}
	secondInvokedSkillsPayload, _ := secondInvokedSkillsAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondInvokedSkillsPayload["type"])) != "invoked_skills" {
		t.Fatalf("unexpected second invoked_skills attachment payload: %#v", secondInvokedSkillsAttachment)
	}
	secondSkills, _ := secondInvokedSkillsPayload["skills"].([]any)
	if len(secondSkills) != 1 {
		t.Fatalf("invalid second invoked_skills attachment payload: %#v", secondInvokedSkillsAttachment)
	}
	secondFirstSkill, _ := secondSkills[0].(map[string]any)
	if strings.TrimSpace(asString(secondFirstSkill["name"])) != stubInvokedSkillName || strings.TrimSpace(asString(secondFirstSkill["path"])) != stubInvokedSkillPath || strings.TrimSpace(asString(secondFirstSkill["content"])) != stubInvokedSkillContent {
		t.Fatalf("invalid second invoked_skills attachment payload: %#v", secondInvokedSkillsAttachment)
	}
	var secondDateChangeAttachment map[string]any
	if err := ws.ReadJSON(&secondDateChangeAttachment); err != nil {
		t.Fatalf("read second date_change attachment failed: %v", err)
	}
	if secondDateChangeAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondDateChangeAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second date_change attachment envelope: %#v", secondDateChangeAttachment)
	}
	secondDateChangePayload, _ := secondDateChangeAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondDateChangePayload["type"])) != "date_change" || strings.TrimSpace(asString(secondDateChangePayload["newDate"])) != "2026-04-09" {
		t.Fatalf("unexpected second date_change attachment payload: %#v", secondDateChangeAttachment)
	}
	var secondUltrathinkEffortAttachment map[string]any
	if err := ws.ReadJSON(&secondUltrathinkEffortAttachment); err != nil {
		t.Fatalf("read second ultrathink_effort attachment failed: %v", err)
	}
	if secondUltrathinkEffortAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondUltrathinkEffortAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second ultrathink_effort attachment envelope: %#v", secondUltrathinkEffortAttachment)
	}
	secondUltrathinkEffortPayload, _ := secondUltrathinkEffortAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondUltrathinkEffortPayload["type"])) != "ultrathink_effort" || strings.TrimSpace(asString(secondUltrathinkEffortPayload["level"])) != "high" {
		t.Fatalf("unexpected second ultrathink_effort attachment payload: %#v", secondUltrathinkEffortAttachment)
	}
	var secondDeferredToolsDeltaAttachment map[string]any
	if err := ws.ReadJSON(&secondDeferredToolsDeltaAttachment); err != nil {
		t.Fatalf("read second deferred_tools_delta attachment failed: %v", err)
	}
	if secondDeferredToolsDeltaAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondDeferredToolsDeltaAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second deferred_tools_delta attachment envelope: %#v", secondDeferredToolsDeltaAttachment)
	}
	secondDeferredToolsDeltaPayload, _ := secondDeferredToolsDeltaAttachment["attachment"].(map[string]any)
	secondAddedNames, _ := secondDeferredToolsDeltaPayload["addedNames"].([]any)
	secondAddedLines, _ := secondDeferredToolsDeltaPayload["addedLines"].([]any)
	secondRemovedNames, _ := secondDeferredToolsDeltaPayload["removedNames"].([]any)
	if strings.TrimSpace(asString(secondDeferredToolsDeltaPayload["type"])) != "deferred_tools_delta" || len(secondAddedNames) != 1 || strings.TrimSpace(asString(secondAddedNames[0])) != "ToolSearch" || len(secondAddedLines) != 1 || strings.TrimSpace(asString(secondAddedLines[0])) != "- ToolSearch: Search deferred tools on demand" || len(secondRemovedNames) != 0 {
		t.Fatalf("unexpected second deferred_tools_delta attachment payload: %#v", secondDeferredToolsDeltaAttachment)
	}
	var secondAgentListingDeltaAttachment map[string]any
	if err := ws.ReadJSON(&secondAgentListingDeltaAttachment); err != nil {
		t.Fatalf("read second agent_listing_delta attachment failed: %v", err)
	}
	if secondAgentListingDeltaAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondAgentListingDeltaAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second agent_listing_delta attachment envelope: %#v", secondAgentListingDeltaAttachment)
	}
	secondAgentListingDeltaPayload, _ := secondAgentListingDeltaAttachment["attachment"].(map[string]any)
	secondAddedTypes, _ := secondAgentListingDeltaPayload["addedTypes"].([]any)
	secondAgentAddedLines, _ := secondAgentListingDeltaPayload["addedLines"].([]any)
	secondRemovedTypes, _ := secondAgentListingDeltaPayload["removedTypes"].([]any)
	if strings.TrimSpace(asString(secondAgentListingDeltaPayload["type"])) != "agent_listing_delta" || len(secondAddedTypes) != 1 || strings.TrimSpace(asString(secondAddedTypes[0])) != "explorer" || len(secondAgentAddedLines) != 1 || strings.TrimSpace(asString(secondAgentAddedLines[0])) != "- explorer: Fast codebase explorer for scoped questions" || len(secondRemovedTypes) != 0 || !secondAgentListingDeltaPayload["isInitial"].(bool) || !secondAgentListingDeltaPayload["showConcurrencyNote"].(bool) {
		t.Fatalf("unexpected second agent_listing_delta attachment payload: %#v", secondAgentListingDeltaAttachment)
	}
	var secondMCPInstructionsDeltaAttachment map[string]any
	if err := ws.ReadJSON(&secondMCPInstructionsDeltaAttachment); err != nil {
		t.Fatalf("read second mcp_instructions_delta attachment failed: %v", err)
	}
	if secondMCPInstructionsDeltaAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondMCPInstructionsDeltaAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second mcp_instructions_delta attachment envelope: %#v", secondMCPInstructionsDeltaAttachment)
	}
	secondMCPInstructionsDeltaPayload, _ := secondMCPInstructionsDeltaAttachment["attachment"].(map[string]any)
	secondMCPAddedNames, _ := secondMCPInstructionsDeltaPayload["addedNames"].([]any)
	secondMCPAddedBlocks, _ := secondMCPInstructionsDeltaPayload["addedBlocks"].([]any)
	secondMCPRemovedNames, _ := secondMCPInstructionsDeltaPayload["removedNames"].([]any)
	if strings.TrimSpace(asString(secondMCPInstructionsDeltaPayload["type"])) != "mcp_instructions_delta" || len(secondMCPAddedNames) != 1 || strings.TrimSpace(asString(secondMCPAddedNames[0])) != "chrome" || len(secondMCPAddedBlocks) != 1 || strings.TrimSpace(asString(secondMCPAddedBlocks[0])) != "## chrome\nUse ToolSearch before browser actions." || len(secondMCPRemovedNames) != 0 {
		t.Fatalf("unexpected second mcp_instructions_delta attachment payload: %#v", secondMCPInstructionsDeltaAttachment)
	}
	var secondCompanionIntroAttachment map[string]any
	if err := ws.ReadJSON(&secondCompanionIntroAttachment); err != nil {
		t.Fatalf("read second companion_intro attachment failed: %v", err)
	}
	if secondCompanionIntroAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondCompanionIntroAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second companion_intro attachment envelope: %#v", secondCompanionIntroAttachment)
	}
	secondCompanionIntroPayload, _ := secondCompanionIntroAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondCompanionIntroPayload["type"])) != "companion_intro" || strings.TrimSpace(asString(secondCompanionIntroPayload["name"])) != "Mochi" || strings.TrimSpace(asString(secondCompanionIntroPayload["species"])) != "otter" {
		t.Fatalf("unexpected second companion_intro attachment payload: %#v", secondCompanionIntroAttachment)
	}
	var secondAsyncHookResponseAttachment map[string]any
	if err := ws.ReadJSON(&secondAsyncHookResponseAttachment); err != nil {
		t.Fatalf("read second async_hook_response attachment failed: %v", err)
	}
	if secondAsyncHookResponseAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondAsyncHookResponseAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second async_hook_response attachment envelope: %#v", secondAsyncHookResponseAttachment)
	}
	secondAsyncHookResponsePayload, _ := secondAsyncHookResponseAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondAsyncHookResponsePayload["type"])) != "async_hook_response" ||
		strings.TrimSpace(asString(secondAsyncHookResponsePayload["hookName"])) != "PostToolUse" ||
		strings.TrimSpace(asString(secondAsyncHookResponsePayload["sessionId"])) != parsed["session_id"] ||
		strings.TrimSpace(asString(secondAsyncHookResponsePayload["toolUseID"])) != "toolu_demo_async_hook" ||
		strings.TrimSpace(asString(secondAsyncHookResponsePayload["content"])) != "Async hook completed: captured post-tool summary." {
		t.Fatalf("unexpected second async_hook_response attachment payload: %#v", secondAsyncHookResponseAttachment)
	}
	var secondTokenUsageAttachment map[string]any
	if err := ws.ReadJSON(&secondTokenUsageAttachment); err != nil {
		t.Fatalf("read second token_usage attachment failed: %v", err)
	}
	if secondTokenUsageAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondTokenUsageAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second token_usage attachment envelope: %#v", secondTokenUsageAttachment)
	}
	secondTokenUsagePayload, _ := secondTokenUsageAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondTokenUsagePayload["type"])) != "token_usage" || int(secondTokenUsagePayload["used"].(float64)) != 1024 || int(secondTokenUsagePayload["total"].(float64)) != 200000 || int(secondTokenUsagePayload["remaining"].(float64)) != 198976 {
		t.Fatalf("unexpected second token_usage attachment payload: %#v", secondTokenUsageAttachment)
	}
	var secondOutputTokenUsageAttachment map[string]any
	if err := ws.ReadJSON(&secondOutputTokenUsageAttachment); err != nil {
		t.Fatalf("read second output_token_usage attachment failed: %v", err)
	}
	if secondOutputTokenUsageAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondOutputTokenUsageAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second output_token_usage attachment envelope: %#v", secondOutputTokenUsageAttachment)
	}
	secondOutputTokenUsagePayload, _ := secondOutputTokenUsageAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondOutputTokenUsagePayload["type"])) != "output_token_usage" || int(secondOutputTokenUsagePayload["turn"].(float64)) != 256 || int(secondOutputTokenUsagePayload["session"].(float64)) != 512 || int(secondOutputTokenUsagePayload["budget"].(float64)) != 1024 {
		t.Fatalf("unexpected second output_token_usage attachment payload: %#v", secondOutputTokenUsageAttachment)
	}
	var secondVerifyPlanReminderAttachment map[string]any
	if err := ws.ReadJSON(&secondVerifyPlanReminderAttachment); err != nil {
		t.Fatalf("read second verify_plan_reminder attachment failed: %v", err)
	}
	if secondVerifyPlanReminderAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondVerifyPlanReminderAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second verify_plan_reminder attachment envelope: %#v", secondVerifyPlanReminderAttachment)
	}
	secondVerifyPlanReminderPayload, _ := secondVerifyPlanReminderAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondVerifyPlanReminderPayload["type"])) != "verify_plan_reminder" {
		t.Fatalf("unexpected second verify_plan_reminder attachment payload: %#v", secondVerifyPlanReminderAttachment)
	}
	var secondCurrentSessionMemoryAttachment map[string]any
	if err := ws.ReadJSON(&secondCurrentSessionMemoryAttachment); err != nil {
		t.Fatalf("read second current_session_memory attachment failed: %v", err)
	}
	if secondCurrentSessionMemoryAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondCurrentSessionMemoryAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second current_session_memory attachment envelope: %#v", secondCurrentSessionMemoryAttachment)
	}
	secondCurrentSessionMemoryPayload, _ := secondCurrentSessionMemoryAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondCurrentSessionMemoryPayload["type"])) != "current_session_memory" || strings.TrimSpace(asString(secondCurrentSessionMemoryPayload["content"])) != "Remember: keep this session focused." || strings.TrimSpace(asString(secondCurrentSessionMemoryPayload["path"])) != "MEMORY.md" || int(secondCurrentSessionMemoryPayload["tokenCount"].(float64)) != 7 {
		t.Fatalf("unexpected second current_session_memory attachment payload: %#v", secondCurrentSessionMemoryAttachment)
	}
	var secondRelevantMemoriesAttachment map[string]any
	if err := ws.ReadJSON(&secondRelevantMemoriesAttachment); err != nil {
		t.Fatalf("read second relevant_memories attachment failed: %v", err)
	}
	if secondRelevantMemoriesAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondRelevantMemoriesAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second relevant_memories attachment envelope: %#v", secondRelevantMemoriesAttachment)
	}
	secondRelevantMemoriesPayload, _ := secondRelevantMemoriesAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondRelevantMemoriesPayload["type"])) != "relevant_memories" {
		t.Fatalf("unexpected second relevant_memories attachment payload: %#v", secondRelevantMemoriesAttachment)
	}
	secondRelevantMemoriesList, _ := secondRelevantMemoriesPayload["memories"].([]any)
	if len(secondRelevantMemoriesList) != 1 {
		t.Fatalf("unexpected second relevant_memories list: %#v", secondRelevantMemoriesAttachment)
	}
	secondRelevantMemory, _ := secondRelevantMemoriesList[0].(map[string]any)
	secondMtimeMs, ok := secondRelevantMemory["mtimeMs"].(float64)
	if strings.TrimSpace(asString(secondRelevantMemory["path"])) != "memory/project.md" ||
		strings.TrimSpace(asString(secondRelevantMemory["content"])) != "Project memory: keep nested context stable." ||
		!ok || int64(secondMtimeMs) != 1712700000000 ||
		strings.TrimSpace(asString(secondRelevantMemory["header"])) != "## memory/project.md" ||
		int(secondRelevantMemory["limit"].(float64)) != 1 {
		t.Fatalf("unexpected second relevant_memories entry: %#v", secondRelevantMemoriesAttachment)
	}
	var secondNestedMemoryAttachment map[string]any
	if err := ws.ReadJSON(&secondNestedMemoryAttachment); err != nil {
		t.Fatalf("read second nested_memory attachment failed: %v", err)
	}
	if secondNestedMemoryAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondNestedMemoryAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second nested_memory attachment envelope: %#v", secondNestedMemoryAttachment)
	}
	secondNestedMemoryPayload, _ := secondNestedMemoryAttachment["attachment"].(map[string]any)
	secondNestedMemoryContent, _ := secondNestedMemoryPayload["content"].(map[string]any)
	if strings.TrimSpace(asString(secondNestedMemoryPayload["type"])) != "nested_memory" || strings.TrimSpace(asString(secondNestedMemoryPayload["path"])) != "memory/project.md" || strings.TrimSpace(asString(secondNestedMemoryPayload["displayPath"])) != "memory/project.md" {
		t.Fatalf("unexpected second nested_memory attachment payload: %#v", secondNestedMemoryAttachment)
	}
	if strings.TrimSpace(asString(secondNestedMemoryContent["path"])) != "memory/project.md" || strings.TrimSpace(asString(secondNestedMemoryContent["type"])) != "memory_file" || strings.TrimSpace(asString(secondNestedMemoryContent["content"])) != "Project memory: keep nested context stable." {
		t.Fatalf("unexpected second nested_memory content payload: %#v", secondNestedMemoryAttachment)
	}
	var secondTeammateShutdownBatchAttachment map[string]any
	if err := ws.ReadJSON(&secondTeammateShutdownBatchAttachment); err != nil {
		t.Fatalf("read second teammate_shutdown_batch attachment failed: %v", err)
	}
	if secondTeammateShutdownBatchAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondTeammateShutdownBatchAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second teammate_shutdown_batch attachment envelope: %#v", secondTeammateShutdownBatchAttachment)
	}
	secondTeammateShutdownBatchPayload, _ := secondTeammateShutdownBatchAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondTeammateShutdownBatchPayload["type"])) != "teammate_shutdown_batch" || int(secondTeammateShutdownBatchPayload["count"].(float64)) != 2 {
		t.Fatalf("unexpected second teammate_shutdown_batch attachment payload: %#v", secondTeammateShutdownBatchAttachment)
	}
	var secondBagelConsoleAttachment map[string]any
	if err := ws.ReadJSON(&secondBagelConsoleAttachment); err != nil {
		t.Fatalf("read second bagel_console attachment failed: %v", err)
	}
	if secondBagelConsoleAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondBagelConsoleAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second bagel_console attachment envelope: %#v", secondBagelConsoleAttachment)
	}
	secondBagelConsolePayload, _ := secondBagelConsoleAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondBagelConsolePayload["type"])) != "bagel_console" || int(secondBagelConsolePayload["errorCount"].(float64)) != 1 || int(secondBagelConsolePayload["warningCount"].(float64)) != 2 || strings.TrimSpace(asString(secondBagelConsolePayload["sample"])) != "bagel: sample warning" {
		t.Fatalf("unexpected second bagel_console attachment payload: %#v", secondBagelConsoleAttachment)
	}
	var secondTeammateMailboxAttachment map[string]any
	if err := ws.ReadJSON(&secondTeammateMailboxAttachment); err != nil {
		t.Fatalf("read second teammate_mailbox attachment failed: %v", err)
	}
	if secondTeammateMailboxAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondTeammateMailboxAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second teammate_mailbox attachment envelope: %#v", secondTeammateMailboxAttachment)
	}
	secondTeammateMailboxPayload, _ := secondTeammateMailboxAttachment["attachment"].(map[string]any)
	secondTeammateMailboxMessages, _ := secondTeammateMailboxPayload["messages"].([]any)
	if strings.TrimSpace(asString(secondTeammateMailboxPayload["type"])) != "teammate_mailbox" || len(secondTeammateMailboxMessages) != 1 {
		t.Fatalf("unexpected second teammate_mailbox attachment payload: %#v", secondTeammateMailboxAttachment)
	}
	secondTeammateMailboxMessage, _ := secondTeammateMailboxMessages[0].(map[string]any)
	if strings.TrimSpace(asString(secondTeammateMailboxMessage["from"])) != "team-lead" || strings.TrimSpace(asString(secondTeammateMailboxMessage["text"])) != "Please pick up the next task." || strings.TrimSpace(asString(secondTeammateMailboxMessage["timestamp"])) != "2026-04-09T12:00:00Z" || strings.TrimSpace(asString(secondTeammateMailboxMessage["color"])) != "blue" || strings.TrimSpace(asString(secondTeammateMailboxMessage["summary"])) != "next task" {
		t.Fatalf("unexpected second teammate_mailbox message payload: %#v", secondTeammateMailboxAttachment)
	}
	var secondTeamContextAttachment map[string]any
	if err := ws.ReadJSON(&secondTeamContextAttachment); err != nil {
		t.Fatalf("read second team_context attachment failed: %v", err)
	}
	if secondTeamContextAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondTeamContextAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second team_context attachment envelope: %#v", secondTeamContextAttachment)
	}
	secondTeamContextPayload, _ := secondTeamContextAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondTeamContextPayload["type"])) != "team_context" || strings.TrimSpace(asString(secondTeamContextPayload["agentId"])) != "agent-dev" || strings.TrimSpace(asString(secondTeamContextPayload["agentName"])) != "dev" || strings.TrimSpace(asString(secondTeamContextPayload["teamName"])) != "alpha" || strings.TrimSpace(asString(secondTeamContextPayload["teamConfigPath"])) != ".claude/team.yaml" || strings.TrimSpace(asString(secondTeamContextPayload["taskListPath"])) != ".claude/tasks.json" {
		t.Fatalf("unexpected second team_context attachment payload: %#v", secondTeamContextAttachment)
	}
	var secondSkillDiscoveryAttachment map[string]any
	if err := ws.ReadJSON(&secondSkillDiscoveryAttachment); err != nil {
		t.Fatalf("read second skill_discovery attachment failed: %v", err)
	}
	if secondSkillDiscoveryAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondSkillDiscoveryAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second skill_discovery attachment envelope: %#v", secondSkillDiscoveryAttachment)
	}
	secondSkillDiscoveryPayload, _ := secondSkillDiscoveryAttachment["attachment"].(map[string]any)
	secondSkillDiscoverySkills, _ := secondSkillDiscoveryPayload["skills"].([]any)
	if strings.TrimSpace(asString(secondSkillDiscoveryPayload["type"])) != "skill_discovery" || strings.TrimSpace(asString(secondSkillDiscoveryPayload["signal"])) != "user_input" || strings.TrimSpace(asString(secondSkillDiscoveryPayload["source"])) != "native" || len(secondSkillDiscoverySkills) != 1 {
		t.Fatalf("unexpected second skill_discovery attachment payload: %#v", secondSkillDiscoveryAttachment)
	}
	secondSkillDiscoverySkill, _ := secondSkillDiscoverySkills[0].(map[string]any)
	if strings.TrimSpace(asString(secondSkillDiscoverySkill["name"])) != "agent-manager" || strings.TrimSpace(asString(secondSkillDiscoverySkill["description"])) != "Coordinate and track teammate work." || strings.TrimSpace(asString(secondSkillDiscoverySkill["shortId"])) != "am" {
		t.Fatalf("unexpected second skill_discovery skill payload: %#v", secondSkillDiscoveryAttachment)
	}
	var secondDynamicSkillAttachment map[string]any
	if err := ws.ReadJSON(&secondDynamicSkillAttachment); err != nil {
		t.Fatalf("read second dynamic_skill attachment failed: %v", err)
	}
	if secondDynamicSkillAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondDynamicSkillAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second dynamic_skill attachment envelope: %#v", secondDynamicSkillAttachment)
	}
	secondDynamicSkillPayload, _ := secondDynamicSkillAttachment["attachment"].(map[string]any)
	secondDynamicSkillNames, _ := secondDynamicSkillPayload["skillNames"].([]any)
	if strings.TrimSpace(asString(secondDynamicSkillPayload["type"])) != "dynamic_skill" || strings.TrimSpace(asString(secondDynamicSkillPayload["skillDir"])) != ".codex/skills/agent-manager" || strings.TrimSpace(asString(secondDynamicSkillPayload["displayPath"])) != ".codex/skills" || len(secondDynamicSkillNames) != 2 {
		t.Fatalf("unexpected second dynamic_skill attachment payload: %#v", secondDynamicSkillAttachment)
	}
	if strings.TrimSpace(asString(secondDynamicSkillNames[0])) != "agent-manager" || strings.TrimSpace(asString(secondDynamicSkillNames[1])) != "use-fractalbot" {
		t.Fatalf("unexpected second dynamic_skill skillNames payload: %#v", secondDynamicSkillAttachment)
	}
	var secondSkillListingAttachment map[string]any
	if err := ws.ReadJSON(&secondSkillListingAttachment); err != nil {
		t.Fatalf("read second skill_listing attachment failed: %v", err)
	}
	if secondSkillListingAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondSkillListingAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second skill_listing attachment envelope: %#v", secondSkillListingAttachment)
	}
	secondSkillListingPayload, _ := secondSkillListingAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondSkillListingPayload["type"])) != "skill_listing" || strings.TrimSpace(asString(secondSkillListingPayload["content"])) != "agent-manager: Coordinate and track teammate work." || int(secondSkillListingPayload["skillCount"].(float64)) != 1 || secondSkillListingPayload["isInitial"] != true {
		t.Fatalf("unexpected second skill_listing attachment payload: %#v", secondSkillListingAttachment)
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
	secondPreservedSegment, _ := secondCompactMetadata["preserved_segment"].(map[string]any)
	if strings.TrimSpace(asString(secondPreservedSegment["head_uuid"])) != "seg-head-stub" || strings.TrimSpace(asString(secondPreservedSegment["anchor_uuid"])) != "seg-anchor-stub" || strings.TrimSpace(asString(secondPreservedSegment["tail_uuid"])) != "seg-tail-stub" {
		t.Fatalf("invalid second compact_boundary preserved_segment payload: %#v", secondCompactBoundary)
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
	var secondHookNonBlockingErrorAttachment map[string]any
	if err := ws.ReadJSON(&secondHookNonBlockingErrorAttachment); err != nil {
		t.Fatalf("read second hook_non_blocking_error attachment failed: %v", err)
	}
	if secondHookNonBlockingErrorAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondHookNonBlockingErrorAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second hook_non_blocking_error attachment envelope: %#v", secondHookNonBlockingErrorAttachment)
	}
	secondHookNonBlockingErrorPayload, _ := secondHookNonBlockingErrorAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondHookNonBlockingErrorPayload["type"])) != "hook_non_blocking_error" ||
		strings.TrimSpace(asString(secondHookNonBlockingErrorPayload["hookName"])) != "DirectConnectEchoHook" ||
		strings.TrimSpace(asString(secondHookNonBlockingErrorPayload["stderr"])) != "Direct-connect demo hook reported a recoverable issue." ||
		strings.TrimSpace(asString(secondHookNonBlockingErrorPayload["stdout"])) != "echo:hello again [approved]" ||
		fmt.Sprint(secondHookNonBlockingErrorPayload["exitCode"]) != "1" ||
		strings.TrimSpace(asString(secondHookNonBlockingErrorPayload["toolUseID"])) != strings.TrimSpace(asString(secondRequest["tool_use_id"])) ||
		strings.TrimSpace(asString(secondHookNonBlockingErrorPayload["hookEvent"])) != "Stop" {
		t.Fatalf("unexpected second hook_non_blocking_error attachment payload: %#v", secondHookNonBlockingErrorAttachment)
	}
	var secondHookCancelledAttachment map[string]any
	if err := ws.ReadJSON(&secondHookCancelledAttachment); err != nil {
		t.Fatalf("read second hook_cancelled attachment failed: %v", err)
	}
	if secondHookCancelledAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondHookCancelledAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second hook_cancelled attachment envelope: %#v", secondHookCancelledAttachment)
	}
	secondHookCancelledPayload, _ := secondHookCancelledAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondHookCancelledPayload["type"])) != "hook_cancelled" ||
		strings.TrimSpace(asString(secondHookCancelledPayload["hookName"])) != "DirectConnectEchoHook" ||
		strings.TrimSpace(asString(secondHookCancelledPayload["toolUseID"])) != strings.TrimSpace(asString(secondRequest["tool_use_id"])) ||
		strings.TrimSpace(asString(secondHookCancelledPayload["hookEvent"])) != "Stop" {
		t.Fatalf("unexpected second hook_cancelled attachment payload: %#v", secondHookCancelledAttachment)
	}
	var secondHookSuccessAttachment map[string]any
	if err := ws.ReadJSON(&secondHookSuccessAttachment); err != nil {
		t.Fatalf("read second hook_success attachment failed: %v", err)
	}
	if secondHookSuccessAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondHookSuccessAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second hook_success attachment envelope: %#v", secondHookSuccessAttachment)
	}
	secondHookSuccessPayload, _ := secondHookSuccessAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondHookSuccessPayload["type"])) != "hook_success" ||
		strings.TrimSpace(asString(secondHookSuccessPayload["content"])) != "echo:hello again [approved]" ||
		strings.TrimSpace(asString(secondHookSuccessPayload["hookName"])) != "DirectConnectEchoHook" ||
		strings.TrimSpace(asString(secondHookSuccessPayload["toolUseID"])) != strings.TrimSpace(asString(secondRequest["tool_use_id"])) ||
		strings.TrimSpace(asString(secondHookSuccessPayload["hookEvent"])) != "Stop" {
		t.Fatalf("unexpected second hook_success attachment payload: %#v", secondHookSuccessAttachment)
	}
	var secondHookStoppedContinuationAttachment map[string]any
	if err := ws.ReadJSON(&secondHookStoppedContinuationAttachment); err != nil {
		t.Fatalf("read second hook_stopped_continuation attachment failed: %v", err)
	}
	if secondHookStoppedContinuationAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondHookStoppedContinuationAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second hook_stopped_continuation attachment envelope: %#v", secondHookStoppedContinuationAttachment)
	}
	secondHookStoppedContinuationPayload, _ := secondHookStoppedContinuationAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondHookStoppedContinuationPayload["type"])) != "hook_stopped_continuation" ||
		strings.TrimSpace(asString(secondHookStoppedContinuationPayload["message"])) != "Execution stopped by DirectConnectEchoHook." ||
		strings.TrimSpace(asString(secondHookStoppedContinuationPayload["hookName"])) != "DirectConnectEchoHook" ||
		strings.TrimSpace(asString(secondHookStoppedContinuationPayload["toolUseID"])) != strings.TrimSpace(asString(secondRequest["tool_use_id"])) ||
		strings.TrimSpace(asString(secondHookStoppedContinuationPayload["hookEvent"])) != "Stop" {
		t.Fatalf("unexpected second hook_stopped_continuation attachment payload: %#v", secondHookStoppedContinuationAttachment)
	}
	var secondHookSystemMessageAttachment map[string]any
	if err := ws.ReadJSON(&secondHookSystemMessageAttachment); err != nil {
		t.Fatalf("read second hook_system_message attachment failed: %v", err)
	}
	if secondHookSystemMessageAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondHookSystemMessageAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second hook_system_message attachment envelope: %#v", secondHookSystemMessageAttachment)
	}
	secondHookSystemMessagePayload, _ := secondHookSystemMessageAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(secondHookSystemMessagePayload["type"])) != "hook_system_message" ||
		strings.TrimSpace(asString(secondHookSystemMessagePayload["content"])) != "Direct-connect echo stop hook acknowledged." ||
		strings.TrimSpace(asString(secondHookSystemMessagePayload["hookName"])) != "DirectConnectEchoHook" ||
		strings.TrimSpace(asString(secondHookSystemMessagePayload["toolUseID"])) != strings.TrimSpace(asString(secondRequest["tool_use_id"])) ||
		strings.TrimSpace(asString(secondHookSystemMessagePayload["hookEvent"])) != "Stop" {
		t.Fatalf("unexpected second hook_system_message attachment payload: %#v", secondHookSystemMessageAttachment)
	}
	var secondHookAdditionalContextAttachment map[string]any
	if err := ws.ReadJSON(&secondHookAdditionalContextAttachment); err != nil {
		t.Fatalf("read second hook_additional_context attachment failed: %v", err)
	}
	if secondHookAdditionalContextAttachment["type"] != "attachment" || strings.TrimSpace(asString(secondHookAdditionalContextAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected second hook_additional_context attachment envelope: %#v", secondHookAdditionalContextAttachment)
	}
	secondHookAdditionalContextPayload, _ := secondHookAdditionalContextAttachment["attachment"].(map[string]any)
	secondHookAdditionalContextContent, _ := secondHookAdditionalContextPayload["content"].([]any)
	if strings.TrimSpace(asString(secondHookAdditionalContextPayload["type"])) != "hook_additional_context" ||
		len(secondHookAdditionalContextContent) != 1 ||
		strings.TrimSpace(asString(secondHookAdditionalContextContent[0])) != "Hook context: preserve the direct-connect stop-hook summary." ||
		strings.TrimSpace(asString(secondHookAdditionalContextPayload["hookName"])) != "DirectConnectEchoHook" ||
		strings.TrimSpace(asString(secondHookAdditionalContextPayload["toolUseID"])) != strings.TrimSpace(asString(secondRequest["tool_use_id"])) ||
		strings.TrimSpace(asString(secondHookAdditionalContextPayload["hookEvent"])) != "Stop" {
		t.Fatalf("unexpected second hook_additional_context attachment payload: %#v", secondHookAdditionalContextAttachment)
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
	var denyHookPermissionDecisionAttachment map[string]any
	if err := ws.ReadJSON(&denyHookPermissionDecisionAttachment); err != nil {
		t.Fatalf("read deny hook_permission_decision attachment failed: %v", err)
	}
	if denyHookPermissionDecisionAttachment["type"] != "attachment" || strings.TrimSpace(asString(denyHookPermissionDecisionAttachment["session_id"])) != parsed["session_id"] {
		t.Fatalf("unexpected deny hook_permission_decision attachment envelope: %#v", denyHookPermissionDecisionAttachment)
	}
	denyHookPermissionDecisionPayload, _ := denyHookPermissionDecisionAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(denyHookPermissionDecisionPayload["type"])) != "hook_permission_decision" ||
		strings.TrimSpace(asString(denyHookPermissionDecisionPayload["decision"])) != "deny" ||
		strings.TrimSpace(asString(denyHookPermissionDecisionPayload["toolUseID"])) != denyToolUseID ||
		strings.TrimSpace(asString(denyHookPermissionDecisionPayload["hookEvent"])) != "PermissionRequest" {
		t.Fatalf("unexpected deny hook_permission_decision attachment payload: %#v", denyHookPermissionDecisionAttachment)
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
	denyPermissionDenials, _ := denyResult["permission_denials"].([]any)
	if len(denyPermissionDenials) != 1 {
		t.Fatalf("expected single permission denial, got %#v", denyResult)
	}
	denial, _ := denyPermissionDenials[0].(map[string]any)
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
	if strings.TrimSpace(asString(denyResult["fast_mode_state"])) != "off" {
		t.Fatalf("unexpected deny fast_mode_state: %#v", denyResult)
	}
	assertZeroModelUsageShape(t, denyResult, "deny result")
	assertZeroUsageShape(t, denyResult, "deny result")

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

	var maxTurnsAttachment map[string]any
	if err := ws.ReadJSON(&maxTurnsAttachment); err != nil {
		t.Fatalf("read max-turns attachment failed: %v", err)
	}
	if maxTurnsAttachment["type"] != "attachment" {
		t.Fatalf("unexpected max-turns attachment envelope: %#v", maxTurnsAttachment)
	}
	maxTurnsAttachmentPayload, _ := maxTurnsAttachment["attachment"].(map[string]any)
	if strings.TrimSpace(asString(maxTurnsAttachmentPayload["type"])) != "max_turns_reached" || intFromAny(maxTurnsAttachmentPayload["turnCount"]) != 2 || intFromAny(maxTurnsAttachmentPayload["maxTurns"]) != 2 {
		t.Fatalf("unexpected max-turns attachment payload: %#v", maxTurnsAttachment)
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
	if strings.TrimSpace(asString(maxTurnsResult["fast_mode_state"])) != "off" {
		t.Fatalf("unexpected max-turns fast_mode_state: %#v", maxTurnsResult)
	}
	assertZeroModelUsageShape(t, maxTurnsResult, "max-turns result")
	assertEmptyPermissionDenials(t, maxTurnsResult, "max-turns result")
	assertZeroUsageShape(t, maxTurnsResult, "max-turns result")

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
	if strings.TrimSpace(asString(maxBudgetResult["fast_mode_state"])) != "off" {
		t.Fatalf("unexpected max-budget-usd fast_mode_state: %#v", maxBudgetResult)
	}
	assertZeroModelUsageShape(t, maxBudgetResult, "max-budget-usd result")
	assertEmptyPermissionDenials(t, maxBudgetResult, "max-budget-usd result")
	assertZeroUsageShape(t, maxBudgetResult, "max-budget-usd result")

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
	if strings.TrimSpace(asString(maxStructuredResult["fast_mode_state"])) != "off" {
		t.Fatalf("unexpected max-structured-output-retries fast_mode_state: %#v", maxStructuredResult)
	}
	assertZeroModelUsageShape(t, maxStructuredResult, "max-structured-output-retries result")
	assertEmptyPermissionDenials(t, maxStructuredResult, "max-structured-output-retries result")
	assertZeroUsageShape(t, maxStructuredResult, "max-structured-output-retries result")

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
	var ackedInitialUser map[string]any
	if err := ws.ReadJSON(&ackedInitialUser); err != nil {
		t.Fatalf("read seed initial user ack replay failed: %v", err)
	}
	if ackedInitialUser["type"] != "user" || ackedInitialUser["isReplay"] != true || strings.TrimSpace(asString(ackedInitialUser["session_id"])) != created["session_id"] || strings.TrimSpace(asString(ackedInitialUser["uuid"])) == "" || strings.TrimSpace(asString(ackedInitialUser["timestamp"])) == "" {
		t.Fatalf("unexpected seed initial user ack replay payload: %#v", ackedInitialUser)
	}
	if _, ok := ackedInitialUser["isSynthetic"]; ok {
		t.Fatalf("expected seed initial user ack replay to omit isSynthetic, got %#v", ackedInitialUser)
	}
	if ackedInitialUser["parent_tool_use_id"] != nil {
		t.Fatalf("expected seed initial user ack replay parent_tool_use_id=nil, got %#v", ackedInitialUser)
	}
	ackedInitialMessage, _ := ackedInitialUser["message"].(map[string]any)
	if strings.TrimSpace(asString(ackedInitialMessage["role"])) != "user" || extractPromptText(ackedInitialUser) != "resume replay seed" {
		t.Fatalf("unexpected seed initial user ack replay message payload: %#v", ackedInitialUser)
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
	if replayedUser["type"] != "user" || replayedUser["isReplay"] != true || replayedUser["isSynthetic"] != false || strings.TrimSpace(asString(replayedUser["session_id"])) != created["session_id"] || strings.TrimSpace(asString(replayedUser["uuid"])) == "" || strings.TrimSpace(asString(replayedUser["timestamp"])) == "" {
		t.Fatalf("unexpected replayed user payload: %#v", replayedUser)
	}
	if replayedUser["parent_tool_use_id"] != nil {
		t.Fatalf("expected replayed user parent_tool_use_id=nil, got %#v", replayedUser)
	}
	message, _ := replayedUser["message"].(map[string]any)
	if strings.TrimSpace(asString(message["role"])) != "user" || extractPromptText(replayedUser) != "resume replay seed" {
		t.Fatalf("unexpected replayed user message payload: %#v", replayedUser)
	}
	var replayedToolResult map[string]any
	if err := ws.ReadJSON(&replayedToolResult); err != nil {
		t.Fatalf("read replayed tool_result failed: %v", err)
	}
	if replayedToolResult["type"] != "user" || replayedToolResult["isReplay"] != true || replayedToolResult["isSynthetic"] != true || strings.TrimSpace(asString(replayedToolResult["session_id"])) != created["session_id"] || strings.TrimSpace(asString(replayedToolResult["uuid"])) == "" || strings.TrimSpace(asString(replayedToolResult["timestamp"])) == "" {
		t.Fatalf("unexpected replayed tool_result payload: %#v", replayedToolResult)
	}
	if replayedToolResult["parent_tool_use_id"] != nil {
		t.Fatalf("expected replayed tool_result parent_tool_use_id=nil, got %#v", replayedToolResult)
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
	replayedPreservedSegment, _ := replayedCompactMetadata["preserved_segment"].(map[string]any)
	if strings.TrimSpace(asString(replayedPreservedSegment["head_uuid"])) != "seg-head-stub" || strings.TrimSpace(asString(replayedPreservedSegment["anchor_uuid"])) != "seg-anchor-stub" || strings.TrimSpace(asString(replayedPreservedSegment["tail_uuid"])) != "seg-tail-stub" {
		t.Fatalf("invalid replayed compact_boundary preserved_segment payload: %#v", replayedCompactBoundary)
	}
	var replayedLocalBreadcrumb map[string]any
	if err := ws.ReadJSON(&replayedLocalBreadcrumb); err != nil {
		t.Fatalf("read replayed local-command breadcrumb failed: %v", err)
	}
	if replayedLocalBreadcrumb["type"] != "user" || replayedLocalBreadcrumb["isReplay"] != true || replayedLocalBreadcrumb["isSynthetic"] != true || strings.TrimSpace(asString(replayedLocalBreadcrumb["session_id"])) != created["session_id"] || strings.TrimSpace(asString(replayedLocalBreadcrumb["uuid"])) == "" || strings.TrimSpace(asString(replayedLocalBreadcrumb["timestamp"])) == "" {
		t.Fatalf("unexpected replayed local-command breadcrumb payload: %#v", replayedLocalBreadcrumb)
	}
	if replayedLocalBreadcrumb["parent_tool_use_id"] != nil {
		t.Fatalf("expected replayed local-command breadcrumb parent_tool_use_id=nil, got %#v", replayedLocalBreadcrumb)
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
	if replayedLocalErrBreadcrumb["type"] != "user" || replayedLocalErrBreadcrumb["isReplay"] != true || replayedLocalErrBreadcrumb["isSynthetic"] != true || strings.TrimSpace(asString(replayedLocalErrBreadcrumb["session_id"])) != created["session_id"] || strings.TrimSpace(asString(replayedLocalErrBreadcrumb["uuid"])) == "" || strings.TrimSpace(asString(replayedLocalErrBreadcrumb["timestamp"])) == "" {
		t.Fatalf("unexpected replayed local-command stderr breadcrumb payload: %#v", replayedLocalErrBreadcrumb)
	}
	if replayedLocalErrBreadcrumb["parent_tool_use_id"] != nil {
		t.Fatalf("expected replayed local-command stderr breadcrumb parent_tool_use_id=nil, got %#v", replayedLocalErrBreadcrumb)
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
	if replayedQueuedCommand["type"] != "user" || replayedQueuedCommand["isReplay"] != true || replayedQueuedCommand["isSynthetic"] != true || strings.TrimSpace(asString(replayedQueuedCommand["session_id"])) != created["session_id"] || strings.TrimSpace(asString(replayedQueuedCommand["uuid"])) == "" || strings.TrimSpace(asString(replayedQueuedCommand["timestamp"])) == "" {
		t.Fatalf("unexpected replayed queued_command payload: %#v", replayedQueuedCommand)
	}
	if replayedQueuedCommand["parent_tool_use_id"] != nil {
		t.Fatalf("expected replayed queued_command parent_tool_use_id=nil, got %#v", replayedQueuedCommand)
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

func TestDiagnosticsAttachmentFromProducerSupportsLSPDiagnostics(t *testing.T) {
	attachment, err := diagnosticsAttachmentFromProducer("lsp_diagnostics")
	if err != nil {
		t.Fatalf("diagnosticsAttachmentFromProducer returned error: %v", err)
	}
	assertDiagnosticsAttachmentPayload(t, attachment, "lsp_diagnostics payload")
}

func TestTaskStatusAttachmentFromProducerSupportsUnifiedTasks(t *testing.T) {
	attachment, err := taskStatusAttachmentFromProducer("unified_tasks", "task-unified", "direct-connect echo task", "echo:unified", "/tmp/task.log")
	if err != nil {
		t.Fatalf("taskStatusAttachmentFromProducer returned error: %v", err)
	}
	assertTaskStatusAttachmentPayload(t, attachment, "task-unified", "direct-connect echo task", "echo:unified", "unified_tasks payload")
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

func assertDiagnosticsAttachment(t *testing.T, ws *websocket.Conn, sessionID, label string) {
	t.Helper()

	var diagnosticsAttachment map[string]any
	if err := ws.ReadJSON(&diagnosticsAttachment); err != nil {
		t.Fatalf("read %s attachment failed: %v", label, err)
	}
	if diagnosticsAttachment["type"] != "attachment" || strings.TrimSpace(asString(diagnosticsAttachment["session_id"])) != sessionID {
		t.Fatalf("unexpected %s attachment envelope: %#v", label, diagnosticsAttachment)
	}
	payload, _ := diagnosticsAttachment["attachment"].(map[string]any)
	assertDiagnosticsAttachmentPayload(t, payload, label)
}

func assertDiagnosticsAttachmentPayload(t *testing.T, payload map[string]any, label string) {
	t.Helper()

	if strings.TrimSpace(asString(payload["type"])) != "diagnostics" || payload["isNew"] != true {
		t.Fatalf("unexpected %s attachment payload: %#v", label, payload)
	}
	diagnosticFiles, _ := payload["files"].([]any)
	if len(diagnosticFiles) != 1 {
		t.Fatalf("unexpected %s file count: %#v", label, payload)
	}
	diagnosticFile, _ := diagnosticFiles[0].(map[string]any)
	if strings.TrimSpace(asString(diagnosticFile["uri"])) != "file:///workspace/claude-code-go/internal/server/server.go" {
		t.Fatalf("unexpected %s uri: %#v", label, payload)
	}
	diagnosticsList, _ := diagnosticFile["diagnostics"].([]any)
	if len(diagnosticsList) != 1 {
		t.Fatalf("unexpected %s diagnostics list: %#v", label, payload)
	}
	diagnosticEntry, _ := diagnosticsList[0].(map[string]any)
	if strings.TrimSpace(asString(diagnosticEntry["message"])) != "unused variable `staleBudget`" ||
		strings.TrimSpace(asString(diagnosticEntry["severity"])) != "Warning" ||
		strings.TrimSpace(asString(diagnosticEntry["source"])) != "gopls" ||
		strings.TrimSpace(asString(diagnosticEntry["code"])) != "unusedvar" {
		t.Fatalf("unexpected %s diagnostics entry: %#v", label, payload)
	}
}

func assertTaskStatusAttachment(t *testing.T, ws *websocket.Conn, sessionID, taskID, taskDescription, deltaSummary, label string) {
	t.Helper()

	var taskStatusAttachment map[string]any
	if err := ws.ReadJSON(&taskStatusAttachment); err != nil {
		t.Fatalf("read %s task_status attachment failed: %v", label, err)
	}
	if taskStatusAttachment["type"] != "attachment" || strings.TrimSpace(asString(taskStatusAttachment["session_id"])) != sessionID {
		t.Fatalf("unexpected %s task_status attachment envelope: %#v", label, taskStatusAttachment)
	}
	payload, _ := taskStatusAttachment["attachment"].(map[string]any)
	assertTaskStatusAttachmentPayload(t, payload, taskID, taskDescription, deltaSummary, label)
}

func assertTaskStatusAttachmentPayload(t *testing.T, payload map[string]any, taskID, taskDescription, deltaSummary, label string) {
	t.Helper()

	if strings.TrimSpace(asString(payload["type"])) != "task_status" ||
		strings.TrimSpace(asString(payload["taskId"])) != taskID ||
		strings.TrimSpace(asString(payload["taskType"])) != "local_bash" ||
		strings.TrimSpace(asString(payload["status"])) != "completed" ||
		strings.TrimSpace(asString(payload["description"])) != taskDescription ||
		strings.TrimSpace(asString(payload["deltaSummary"])) != deltaSummary ||
		strings.TrimSpace(asString(payload["outputFilePath"])) == "" {
		t.Fatalf("unexpected %s task_status attachment payload: %#v", label, payload)
	}
}

func assertZeroUsageShape(t *testing.T, payload map[string]any, label string) {
	t.Helper()
	usage, _ := payload["usage"].(map[string]any)
	serverToolUse, _ := usage["server_tool_use"].(map[string]any)
	cacheCreation, _ := usage["cache_creation"].(map[string]any)
	iterations, _ := usage["iterations"].([]any)
	if intFromAny(usage["input_tokens"]) != 0 || intFromAny(usage["cache_creation_input_tokens"]) != 0 || intFromAny(usage["cache_read_input_tokens"]) != 0 || intFromAny(usage["output_tokens"]) != 0 || intFromAny(serverToolUse["web_search_requests"]) != 0 || intFromAny(serverToolUse["web_fetch_requests"]) != 0 || strings.TrimSpace(asString(usage["service_tier"])) != "standard" || intFromAny(cacheCreation["ephemeral_1h_input_tokens"]) != 0 || intFromAny(cacheCreation["ephemeral_5m_input_tokens"]) != 0 || strings.TrimSpace(asString(usage["inference_geo"])) != "" || len(iterations) != 0 || strings.TrimSpace(asString(usage["speed"])) != "standard" {
		t.Fatalf("unexpected %s usage payload: %#v", label, payload)
	}
}

func assertEmptyPermissionDenials(t *testing.T, payload map[string]any, label string) {
	t.Helper()
	permissionDenials, _ := payload["permission_denials"].([]any)
	if len(permissionDenials) != 0 {
		t.Fatalf("unexpected %s permission_denials payload: %#v", label, payload)
	}
}

func assertZeroModelUsageShape(t *testing.T, payload map[string]any, label string) {
	t.Helper()
	modelUsage, _ := payload["modelUsage"].(map[string]any)
	modelUsageEntry, _ := modelUsage["claude-sonnet-4-5"].(map[string]any)
	if len(modelUsageEntry) == 0 || intFromAny(modelUsageEntry["inputTokens"]) != 0 || intFromAny(modelUsageEntry["outputTokens"]) != 0 || intFromAny(modelUsageEntry["cacheReadInputTokens"]) != 0 || intFromAny(modelUsageEntry["cacheCreationInputTokens"]) != 0 || intFromAny(modelUsageEntry["webSearchRequests"]) != 0 || intFromAny(modelUsageEntry["contextWindow"]) != 0 || float64FromAny(modelUsageEntry["costUSD"]) != 0 {
		t.Fatalf("unexpected %s modelUsage payload: %#v", label, payload)
	}
}

func intFromAny(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int32:
		return int(n)
	case int64:
		return int(n)
	case float64:
		return int(n)
	default:
		return 0
	}
}

func float64FromAny(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int32:
		return float64(n)
	case int64:
		return float64(n)
	default:
		return 0
	}
}
