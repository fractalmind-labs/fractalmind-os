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
		"thinking_delta_validated=false",
		"thinking_signature_validated=false",
		"tool_use_delta_validated=false",
		"tool_use_block_start_validated=false",
		"tool_use_block_stop_validated=false",
		"assistant_message_start_validated=false",
		"assistant_message_delta_validated=false",
		"assistant_message_stop_validated=false",
		"assistant_thinking_validated=false",
		"assistant_tool_use_validated=false",
		"assistant_stop_reason_validated=false",
		"assistant_usage_validated=false",
		"structured_output_attachment_validated=false",
		"max_turns_reached_attachment_validated=false",
		"task_status_attachment_validated=false",
		"queued_command_validated=false",
		"task_reminder_attachment_validated=false",
		"todo_reminder_attachment_validated=false",
		"critical_system_reminder_validated=false",
		"output_style_validated=false",
		"selected_lines_in_ide_validated=false",
		"opened_file_in_ide_validated=false",
		"diagnostics_validated=false",
		"mcp_resource_validated=false",
		"budget_usd_validated=false",
		"compaction_reminder_validated=false",
		"context_efficiency_validated=false",
		"auto_mode_validated=false",
		"auto_mode_exit_validated=false",
		"plan_mode_validated=false",
		"plan_mode_exit_validated=false",
		"plan_mode_reentry_validated=false",
		"plan_file_reference_validated=false",
		"date_change_validated=false",
		"ultrathink_effort_validated=false",
		"deferred_tools_delta_validated=false",
		"agent_listing_delta_validated=false",
		"mcp_instructions_delta_validated=false",
		"companion_intro_validated=false",
		"async_hook_response_validated=false",
		"token_usage_validated=false",
		"output_token_usage_validated=false",
		"verify_plan_reminder_validated=false",
		"current_session_memory_validated=false",
		"relevant_memories_validated=false",
		"nested_memory_validated=false",
		"teammate_shutdown_batch_validated=false",
		"bagel_console_validated=false",
		"teammate_mailbox_validated=false",
		"team_context_validated=false",
		"skill_discovery_validated=false",
		"dynamic_skill_validated=false",
		"skill_listing_validated=false",
		"streamlined_text_validated=false",
		"tool_use_summary_shape_validated=false",
		"streamlined_tool_use_summary_validated=false",
		"prompt_suggestion_validated=false",
		"tool_progress_validated=false",
		"status_validated=false",
		"status_compacting_lifecycle_validated=false",
		"compact_summary_validated=false",
		"compact_summary_synthetic_validated=false",
		"compact_summary_timestamp_validated=false",
		"compact_summary_parent_tool_use_id_validated=false",
		"acked_initial_user_replay_validated=false",
		"replayed_user_message_validated=false",
		"replayed_user_synthetic_validated=false",
		"replayed_user_timestamp_validated=false",
		"replayed_user_parent_tool_use_id_validated=false",
		"replayed_queued_command_validated=false",
		"replayed_queued_command_synthetic_validated=false",
		"replayed_queued_command_timestamp_validated=false",
		"replayed_queued_command_parent_tool_use_id_validated=false",
		"replayed_tool_result_validated=false",
		"replayed_tool_result_synthetic_validated=false",
		"replayed_tool_result_timestamp_validated=false",
		"replayed_tool_result_parent_tool_use_id_validated=false",
		"replayed_assistant_message_validated=false",
		"replayed_compact_boundary_validated=false",
		"replayed_compact_boundary_preserved_segment_validated=false",
		"replayed_local_command_breadcrumb_validated=false",
		"replayed_local_command_breadcrumb_synthetic_validated=false",
		"replayed_local_command_breadcrumb_timestamp_validated=false",
		"replayed_local_command_breadcrumb_parent_tool_use_id_validated=false",
		"replayed_local_command_stderr_breadcrumb_validated=false",
		"replayed_local_command_stderr_breadcrumb_synthetic_validated=false",
		"replayed_local_command_stderr_breadcrumb_timestamp_validated=false",
		"replayed_local_command_stderr_breadcrumb_parent_tool_use_id_validated=false",
		"auth_validated=false",
		"keep_alive_validated=false",
		"update_environment_variables_validated=false",
		"task_started_validated=false",
		"task_progress_validated=false",
		"task_notification_validated=false",
		"files_persisted_validated=false",
		"api_retry_validated=false",
		"local_command_output_validated=false",
		"local_command_output_assistant_validated=false",
		"elicitation_validated=false",
		"hook_callback_validated=false",
		"channel_enable_validated=false",
		"elicitation_complete_validated=false",
		"post_turn_summary_validated=false",
		"compact_boundary_validated=false",
		"compact_boundary_preserved_segment_validated=false",
		"session_state_changed_validated=false",
		"session_state_requires_action_validated=false",
		"hook_started_validated=false",
		"hook_progress_validated=false",
		"hook_response_validated=false",
		"control_cancel_validated=false",
		"system_validated=false",
		"status_transition_validated=false",
		"result_validated=false",
		"result_structured_output_validated=false",
		"result_usage_validated=false",
		"result_model_usage_validated=false",
		"result_permission_denials_validated=false",
		"result_fast_mode_state_validated=false",
		"result_error_usage_validated=false",
		"result_error_permission_denials_validated=false",
		"result_error_model_usage_validated=false",
		"result_error_fast_mode_state_validated=false",
		"result_error_max_turns_validated=false",
		"result_error_max_turns_fast_mode_state_validated=false",
		"result_error_max_budget_usd_validated=false",
		"result_error_max_budget_usd_fast_mode_state_validated=false",
		"result_error_max_structured_output_retries_validated=false",
		"result_error_max_structured_output_retries_fast_mode_state_validated=false",
		"interrupt_validated=false",
		"set_model_validated=false",
		"set_permission_mode_validated=false",
		"set_max_thinking_tokens_validated=false",
		"mcp_status_validated=false",
		"get_context_usage_validated=false",
		"mcp_message_validated=false",
		"mcp_set_servers_validated=false",
		"reload_plugins_validated=false",
		"mcp_authenticate_validated=false",
		"mcp_oauth_callback_url_validated=false",
		"mcp_reconnect_validated=false",
		"mcp_toggle_validated=false",
		"seed_read_state_validated=false",
		"rewind_files_validated=false",
		"rewind_files_can_rewind=false",
		"rewind_files_files_changed=0",
		"cancel_async_message_validated=false",
		"stop_task_validated=false",
		"apply_flag_settings_validated=false",
		"get_settings_validated=false",
		"generate_session_title_validated=false",
		"side_question_validated=false",
		"initialize_validated=false",
		"set_proactive_validated=false",
		"bridge_state_validated=false",
		"remote_control_validated=false",
		"end_session_validated=false",
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
	if !result.StreamContentValidated || result.StreamContentEvent != "stream_event:content_block_delta" || !result.ThinkingDeltaValidated || result.ThinkingDeltaEvent != "stream_event:thinking_delta" || !result.ThinkingSignatureValidated || result.ThinkingSignatureEvent != "stream_event:signature_delta" || !result.ToolUseBlockStartValidated || result.ToolUseBlockStartEvent != "stream_event:content_block_start:tool_use" || !result.ToolUseDeltaValidated || result.ToolUseDeltaEvent != "stream_event:input_json_delta" || !result.ToolUseBlockStopValidated || result.ToolUseBlockStopEvent != "stream_event:content_block_stop:tool_use" || !result.AssistantMessageStartValidated || result.AssistantMessageStartEvent != "stream_event:message_start" || !result.AssistantMessageDeltaValidated || result.AssistantMessageDeltaEvent != "stream_event:message_delta" || !result.AssistantMessageStopValidated || result.AssistantMessageStopEvent != "stream_event:message_stop" || !result.AssistantThinkingValidated || result.AssistantThinkingEvent != "assistant:thinking" || !result.AssistantToolUseValidated || result.AssistantToolUseEvent != "assistant:tool_use" || !result.AssistantStopReasonValidated || result.AssistantStopReasonEvent != "assistant:stop_reason" || !result.AssistantUsageValidated || result.AssistantUsageEvent != "assistant:usage" || !result.StructuredOutputAttachmentValidated || result.StructuredOutputAttachmentEvent != "attachment:structured_output" || !result.MaxTurnsReachedAttachmentValidated || result.MaxTurnsReachedAttachmentEvent != "attachment:max_turns_reached" || !result.TaskStatusAttachmentValidated || result.TaskStatusAttachmentEvent != "attachment:task_status" || !result.QueuedCommandValidated || result.QueuedCommandEvent != "attachment:queued_command" || !result.TaskReminderAttachmentValidated || result.TaskReminderAttachmentEvent != "attachment:task_reminder" || !result.TodoReminderAttachmentValidated || result.TodoReminderAttachmentEvent != "attachment:todo_reminder" || !result.CriticalSystemReminderValidated || result.CriticalSystemReminderEvent != "attachment:critical_system_reminder" || !result.OutputStyleValidated || result.OutputStyleEvent != "attachment:output_style" || !result.SelectedLinesInIDEValidated || result.SelectedLinesInIDEEvent != "attachment:selected_lines_in_ide" || !result.OpenedFileInIDEValidated || result.OpenedFileInIDEEvent != "attachment:opened_file_in_ide" || !result.DiagnosticsValidated || result.DiagnosticsEvent != "attachment:diagnostics" || !result.MCPResourceValidated || result.MCPResourceEvent != "attachment:mcp_resource" || !result.BudgetUSDValidated || result.BudgetUSDEvent != "attachment:budget_usd" || !result.CompactionReminderValidated || result.CompactionReminderEvent != "attachment:compaction_reminder" || !result.ContextEfficiencyValidated || result.ContextEfficiencyEvent != "attachment:context_efficiency" || !result.AutoModeValidated || result.AutoModeEvent != "attachment:auto_mode" || !result.AutoModeExitValidated || result.AutoModeExitEvent != "attachment:auto_mode_exit" || !result.PlanModeValidated || result.PlanModeEvent != "attachment:plan_mode" || !result.PlanModeExitValidated || result.PlanModeExitEvent != "attachment:plan_mode_exit" || !result.PlanModeReentryValidated || result.PlanModeReentryEvent != "attachment:plan_mode_reentry" || !result.PlanFileReferenceValidated || result.PlanFileReferenceEvent != "attachment:plan_file_reference" || !result.DateChangeValidated || result.DateChangeEvent != "attachment:date_change" || !result.UltrathinkEffortValidated || result.UltrathinkEffortEvent != "attachment:ultrathink_effort" || !result.DeferredToolsDeltaValidated || result.DeferredToolsDeltaEvent != "attachment:deferred_tools_delta" || !result.AgentListingDeltaValidated || result.AgentListingDeltaEvent != "attachment:agent_listing_delta" || !result.MCPInstructionsDeltaValidated || result.MCPInstructionsDeltaEvent != "attachment:mcp_instructions_delta" || !result.CompanionIntroValidated || result.CompanionIntroEvent != "attachment:companion_intro" || !result.AsyncHookResponseValidated || result.AsyncHookResponseEvent != "attachment:async_hook_response" || !result.TokenUsageValidated || result.TokenUsageEvent != "attachment:token_usage" || !result.OutputTokenUsageValidated || result.OutputTokenUsageEvent != "attachment:output_token_usage" || !result.VerifyPlanReminderValidated || result.VerifyPlanReminderEvent != "attachment:verify_plan_reminder" || !result.CurrentSessionMemoryValidated || result.CurrentSessionMemoryEvent != "attachment:current_session_memory" || !result.RelevantMemoriesValidated || result.RelevantMemoriesEvent != "attachment:relevant_memories" || !result.NestedMemoryValidated || result.NestedMemoryEvent != "attachment:nested_memory" || !result.TeammateShutdownBatchValidated || result.TeammateShutdownBatchEvent != "attachment:teammate_shutdown_batch" || !result.BagelConsoleValidated || result.BagelConsoleEvent != "attachment:bagel_console" || !result.TeammateMailboxValidated || result.TeammateMailboxEvent != "attachment:teammate_mailbox" || !result.TeamContextValidated || result.TeamContextEvent != "attachment:team_context" || !result.SkillDiscoveryValidated || result.SkillDiscoveryEvent != "attachment:skill_discovery" || !result.DynamicSkillValidated || result.DynamicSkillEvent != "attachment:dynamic_skill" || !result.StreamlinedTextValidated || result.StreamlinedTextEvent != "streamlined_text" || !result.SystemValidated || result.SystemEvent != "system:init" || !result.StatusValidated || result.StatusEvent != "system:status" || !result.StatusTransitionValidated || result.StatusTransitionEvent != "system:status" || !result.StatusCompactingLifecycleValidated || result.StatusCompactingLifecycleEvent != "system:status:compacting->null" || !result.CompactSummaryValidated || result.CompactSummaryEvent != "user:compact_summary" || !result.CompactSummarySyntheticValidated || result.CompactSummarySyntheticEvent != "user:compact_summary:isSynthetic" || !result.CompactSummaryTimestampValidated || result.CompactSummaryTimestampEvent != "user:compact_summary:timestamp" || !result.CompactSummaryParentToolUseIDValidated || result.CompactSummaryParentToolUseIDEvent != "user:compact_summary:parent_tool_use_id" || !result.AckedInitialUserReplayValidated || result.AckedInitialUserReplayEvent != "user:initial_ack:isReplay" || !result.AuthValidated || result.AuthEvent != "auth_status" || !result.KeepAliveValidated || result.KeepAliveEvent != "keep_alive" || !result.UpdateEnvironmentVariablesValidated || result.UpdateEnvironmentVariablesEvent != "update_environment_variables" || !result.ControlCancelValidated || result.ControlCancelEvent != "control_cancel_request" || !result.MessageValidated || result.MessageEvent != "assistant" || result.ValidatedTurns != 2 || !result.MultiTurnValidated || !result.ResultValidated || result.ResultEvent != "result:success" || !result.ResultStructuredOutputValidated || result.ResultStructuredOutputEvent != "result:success:structured_output" || !result.ResultUsageValidated || result.ResultUsageEvent != "result:success:usage" || !result.ResultModelUsageValidated || result.ResultModelUsageEvent != "result:success:modelUsage" || !result.ResultPermissionDenialsValidated || result.ResultPermissionDenialsEvent != "result:success:permission_denials" || !result.ResultFastModeStateValidated || result.ResultFastModeStateEvent != "result:success:fast_mode_state" || !result.ResultErrorValidated || result.ResultErrorEvent != "result:error_during_execution" || !result.ResultErrorUsageValidated || result.ResultErrorUsageEvent != "result:error:usage" || !result.ResultErrorPermissionDenialsValidated || result.ResultErrorPermissionDenialsEvent != "result:error:permission_denials" || !result.ResultErrorModelUsageValidated || result.ResultErrorModelUsageEvent != "result:error:modelUsage" || !result.ResultErrorFastModeStateValidated || result.ResultErrorFastModeStateEvent != "result:error_during_execution:fast_mode_state" || !result.ResultErrorMaxTurnsValidated || result.ResultErrorMaxTurnsEvent != "result:error_max_turns" || !result.ResultErrorMaxTurnsFastModeStateValidated || result.ResultErrorMaxTurnsFastModeStateEvent != "result:error_max_turns:fast_mode_state" || !result.ResultErrorMaxBudgetUSDValidated || result.ResultErrorMaxBudgetUSDEvent != "result:error_max_budget_usd" || !result.ResultErrorMaxBudgetUSDFastModeStateValidated || result.ResultErrorMaxBudgetUSDFastModeStateEvent != "result:error_max_budget_usd:fast_mode_state" || !result.ResultErrorMaxStructuredOutputRetriesValidated || result.ResultErrorMaxStructuredOutputRetriesEvent != "result:error_max_structured_output_retries" || !result.ResultErrorMaxStructuredOutputRetriesFastModeStateValidated || result.ResultErrorMaxStructuredOutputRetriesFastModeStateEvent != "result:error_max_structured_output_retries:fast_mode_state" || !result.ControlValidated || !result.PermissionValidated || !result.PermissionDeniedValidated || result.PermissionDeniedEvent != "permission_denial:echo" || !result.TaskStartedValidated || result.TaskStartedEvent != "system:task_started" || !result.TaskProgressValidated || result.TaskProgressEvent != "system:task_progress" || !result.TaskNotificationValidated || result.TaskNotificationEvent != "system:task_notification" || !result.FilesPersistedValidated || result.FilesPersistedEvent != "system:files_persisted" || !result.APIRetryValidated || result.APIRetryEvent != "system:api_retry" || !result.LocalCommandOutputValidated || result.LocalCommandOutputEvent != "system:local_command_output" || !result.LocalCommandOutputAssistantValidated || result.LocalCommandOutputAssistantEvent != "assistant:local_command_output" || !result.ElicitationValidated || result.ElicitationEvent != "control_request:elicitation" || !result.HookCallbackValidated || result.HookCallbackEvent != "control_request:hook_callback" || !result.ChannelEnableValidated || result.ChannelEnableEvent != "control_request:channel_enable" || !result.ElicitationCompleteValidated || result.ElicitationCompleteEvent != "system:elicitation_complete" || !result.ToolProgressValidated || result.ToolProgressEvent != "tool_progress" || !result.RateLimitValidated || result.RateLimitEvent != "rate_limit_event:default" || !result.ToolUseSummaryValidated || result.ToolUseSummaryEvent != "tool_use_summary" || !result.ToolUseSummaryShapeValidated || result.ToolUseSummaryShapeEvent != "tool_use_summary:shape" || !result.PostTurnSummaryValidated || result.PostTurnSummaryEvent != "system:post_turn_summary" || !result.CompactBoundaryValidated || result.CompactBoundaryEvent != "system:compact_boundary" || !result.CompactBoundaryPreservedSegmentValidated || result.CompactBoundaryPreservedSegmentEvent != "system:compact_boundary:preserved_segment" || !result.SessionStateChangedValidated || result.SessionStateChangedEvent != "system:session_state_changed:idle" || !result.SessionStateRequiresActionValidated || result.SessionStateRequiresActionEvent != "system:session_state_changed:requires_action" || !result.HookStartedValidated || result.HookStartedEvent != "system:hook_started" || !result.HookProgressValidated || result.HookProgressEvent != "system:hook_progress" || !result.HookResponseValidated || result.HookResponseEvent != "system:hook_response" || !result.ToolExecutionValidated || !result.InterruptValidated || !result.SetModelValidated || result.SetModelEvent != "control_request:set_model" || !result.SetPermissionModeValidated || result.SetPermissionModeEvent != "control_request:set_permission_mode" || !result.SetMaxThinkingTokensValidated || result.SetMaxThinkingTokensEvent != "control_request:set_max_thinking_tokens" || !result.MCPStatusValidated || result.MCPStatusEvent != "control_request:mcp_status" || !result.GetContextUsageValidated || result.GetContextUsageEvent != "control_request:get_context_usage" || !result.MCPMessageValidated || result.MCPMessageEvent != "control_request:mcp_message" || !result.MCPSetServersValidated || result.MCPSetServersEvent != "control_request:mcp_set_servers" || !result.ReloadPluginsValidated || result.ReloadPluginsEvent != "control_request:reload_plugins" || !result.MCPAuthenticateValidated || result.MCPAuthenticateEvent != "control_request:mcp_authenticate" || !result.MCPOAuthCallbackURLValidated || result.MCPOAuthCallbackURLEvent != "control_request:mcp_oauth_callback_url" || !result.MCPReconnectValidated || result.MCPReconnectEvent != "control_request:mcp_reconnect" || !result.MCPToggleValidated || result.MCPToggleEvent != "control_request:mcp_toggle" || !result.SeedReadStateValidated || result.SeedReadStateEvent != "control_request:seed_read_state" || !result.RewindFilesValidated || result.RewindFilesEvent != "control_request:rewind_files" || !result.RewindFilesCanRewind || result.RewindFilesFilesChanged != 1 || result.RewindFilesInsertions != 1 || result.RewindFilesDeletions != 0 || !result.CancelAsyncMessageValidated || result.CancelAsyncMessageEvent != "control_request:cancel_async_message" || !result.StopTaskValidated || result.StopTaskEvent != "control_request:stop_task" || !result.ApplyFlagSettingsValidated || result.ApplyFlagSettingsEvent != "control_request:apply_flag_settings" || !result.GetSettingsValidated || result.GetSettingsEvent != "control_request:get_settings" || !result.GenerateSessionTitleValidated || result.GenerateSessionTitleEvent != "control_request:generate_session_title" || !result.SideQuestionValidated || result.SideQuestionEvent != "control_request:side_question" || !result.InitializeValidated || result.InitializeEvent != "control_request:initialize" || !result.SetProactiveValidated || result.SetProactiveEvent != "control_request:set_proactive" || !result.BridgeStateValidated || result.BridgeStateEvent != "system:bridge_state:connected" || !result.RemoteControlValidated || result.RemoteControlEvent != "control_request:remote_control" || !result.EndSessionValidated || result.EndSessionEvent != "control_request:end_session" || !result.BackendValidated {
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

func TestRunOpenSupportsResumePrintReplayValidation(t *testing.T) {
	srv := newHTTPDirectConnectTestServer(t, "sess-resume-print", "/tmp/resume-print-work", nil)
	defer srv.Close()

	connectURL := "cc://" + strings.TrimPrefix(srv.URL, "http://") + "?authToken=demo-token"
	initial, err := Run([]string{connectURL, "--print", "resume replay seed"})
	if err != nil {
		t.Fatalf("initial Run returned error: %v", err)
	}
	resumed, err := Run([]string{
		connectURL,
		"--resume-session", initial.SessionID,
		"--print", "resume replay verify",
	})
	if err != nil {
		t.Fatalf("resumed Run returned error: %v", err)
	}
	if !resumed.ReplayedUserMessageValidated || resumed.ReplayedUserMessageEvent != "user:isReplay" ||
		!resumed.ReplayedUserSyntheticValidated || resumed.ReplayedUserSyntheticEvent != "user:isReplay:isSynthetic=false" ||
		!resumed.ReplayedUserTimestampValidated || resumed.ReplayedUserTimestampEvent != "user:isReplay:timestamp" ||
		!resumed.ReplayedUserParentToolUseIDValidated || resumed.ReplayedUserParentToolUseIDEvent != "user:isReplay:parent_tool_use_id" ||
		!resumed.ReplayedQueuedCommandValidated || resumed.ReplayedQueuedCommandEvent != "user:queued_command:isReplay" ||
		!resumed.ReplayedQueuedCommandSyntheticValidated || resumed.ReplayedQueuedCommandSyntheticEvent != "user:queued_command:isReplay:isSynthetic" ||
		!resumed.ReplayedQueuedCommandTimestampValidated || resumed.ReplayedQueuedCommandTimestampEvent != "user:queued_command:isReplay:timestamp" ||
		!resumed.ReplayedQueuedCommandParentToolUseIDValidated || resumed.ReplayedQueuedCommandParentToolUseIDEvent != "user:queued_command:isReplay:parent_tool_use_id" ||
		!resumed.ReplayedToolResultValidated || resumed.ReplayedToolResultEvent != "user:tool_result:isReplay" ||
		!resumed.ReplayedToolResultSyntheticValidated || resumed.ReplayedToolResultSyntheticEvent != "user:tool_result:isReplay:isSynthetic" ||
		!resumed.ReplayedToolResultTimestampValidated || resumed.ReplayedToolResultTimestampEvent != "user:tool_result:isReplay:timestamp" ||
		!resumed.ReplayedToolResultParentToolUseIDValidated || resumed.ReplayedToolResultParentToolUseIDEvent != "user:tool_result:isReplay:parent_tool_use_id" ||
		!resumed.ReplayedAssistantMessageValidated || resumed.ReplayedAssistantMessageEvent != "assistant:replay" ||
		!resumed.ReplayedCompactBoundaryValidated || resumed.ReplayedCompactBoundaryEvent != "system:compact_boundary:replay" ||
		!resumed.ReplayedCompactBoundaryPreservedSegmentValidated || resumed.ReplayedCompactBoundaryPreservedSegmentEvent != "system:compact_boundary:replay:preserved_segment" ||
		!resumed.ReplayedLocalCommandBreadcrumbValidated || resumed.ReplayedLocalCommandBreadcrumbEvent != "user:local_command_stdout:isReplay" ||
		!resumed.ReplayedLocalCommandBreadcrumbSyntheticValidated || resumed.ReplayedLocalCommandBreadcrumbSyntheticEvent != "user:local_command_stdout:isReplay:isSynthetic" ||
		!resumed.ReplayedLocalCommandBreadcrumbTimestampValidated || resumed.ReplayedLocalCommandBreadcrumbTimestampEvent != "user:local_command_stdout:isReplay:timestamp" ||
		!resumed.ReplayedLocalCommandBreadcrumbParentToolUseIDValidated || resumed.ReplayedLocalCommandBreadcrumbParentToolUseIDEvent != "user:local_command_stdout:isReplay:parent_tool_use_id" ||
		!resumed.ReplayedLocalCommandStderrBreadcrumbValidated || resumed.ReplayedLocalCommandStderrBreadcrumbEvent != "user:local_command_stderr:isReplay" {
		t.Fatalf("expected replay validation, got %#v", resumed)
	}
	if !resumed.ReplayedLocalCommandStderrBreadcrumbSyntheticValidated || resumed.ReplayedLocalCommandStderrBreadcrumbSyntheticEvent != "user:local_command_stderr:isReplay:isSynthetic" || !resumed.ReplayedLocalCommandStderrBreadcrumbTimestampValidated || resumed.ReplayedLocalCommandStderrBreadcrumbTimestampEvent != "user:local_command_stderr:isReplay:timestamp" || !resumed.ReplayedLocalCommandStderrBreadcrumbParentToolUseIDValidated || resumed.ReplayedLocalCommandStderrBreadcrumbParentToolUseIDEvent != "user:local_command_stderr:isReplay:parent_tool_use_id" {
		t.Fatalf("expected replay stderr synthetic validation, got %#v", resumed)
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
	replayedPrompt := ""
	replayedQueuedCommand := ""
	replayedToolUseID := ""
	replayedToolResult := ""
	replayedAssistant := ""
	replayedCompactBoundary := false
	replayedLocalCommandBreadcrumb := ""
	replayedLocalCommandErrBreadcrumb := ""
	emitReplayOnAttach := false

	mux.HandleFunc("/sessions", func(w http.ResponseWriter, r *http.Request) {
		if onSession != nil {
			onSession(r)
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			emitReplayOnAttach = strings.TrimSpace(r.URL.Query().Get("resume")) != "" && replayedPrompt != "" && replayedQueuedCommand != "" && replayedToolUseID != "" && replayedToolResult != "" && replayedAssistant != "" && replayedCompactBoundary && replayedLocalCommandBreadcrumb != "" && replayedLocalCommandErrBreadcrumb != ""
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
		serveDirectConnectWS(t, conn, sessionID, workDir, "http", emitReplayOnAttach, replayedPrompt, replayedQueuedCommand, replayedToolUseID, replayedToolResult, replayedAssistant, replayedCompactBoundary, replayedLocalCommandBreadcrumb, replayedLocalCommandErrBreadcrumb, func(prompt, queuedCommand, toolUseID, toolResult, assistant string, compactBoundary bool, localBreadcrumb string, localErrBreadcrumb string) {
			replayedPrompt = prompt
			replayedQueuedCommand = queuedCommand
			replayedToolUseID = toolUseID
			replayedToolResult = toolResult
			replayedAssistant = assistant
			replayedCompactBoundary = compactBoundary
			replayedLocalCommandBreadcrumb = localBreadcrumb
			replayedLocalCommandErrBreadcrumb = localErrBreadcrumb
		})
		emitReplayOnAttach = false
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
	replayedPrompt := ""
	replayedQueuedCommand := ""
	replayedToolUseID := ""
	replayedToolResult := ""
	replayedAssistant := ""
	replayedCompactBoundary := false
	replayedLocalCommandBreadcrumb := ""
	replayedLocalCommandErrBreadcrumb := ""
	emitReplayOnAttach := false

	mux.HandleFunc("/sessions", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			emitReplayOnAttach = strings.TrimSpace(r.URL.Query().Get("resume")) != "" && replayedPrompt != "" && replayedQueuedCommand != "" && replayedToolUseID != "" && replayedToolResult != "" && replayedAssistant != "" && replayedCompactBoundary && replayedLocalCommandBreadcrumb != "" && replayedLocalCommandErrBreadcrumb != ""
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
		serveDirectConnectWS(t, conn, sessionID, workDir, "unix", emitReplayOnAttach, replayedPrompt, replayedQueuedCommand, replayedToolUseID, replayedToolResult, replayedAssistant, replayedCompactBoundary, replayedLocalCommandBreadcrumb, replayedLocalCommandErrBreadcrumb, func(prompt, queuedCommand, toolUseID, toolResult, assistant string, compactBoundary bool, localBreadcrumb string, localErrBreadcrumb string) {
			replayedPrompt = prompt
			replayedQueuedCommand = queuedCommand
			replayedToolUseID = toolUseID
			replayedToolResult = toolResult
			replayedAssistant = assistant
			replayedCompactBoundary = compactBoundary
			replayedLocalCommandBreadcrumb = localBreadcrumb
			replayedLocalCommandErrBreadcrumb = localErrBreadcrumb
		})
		emitReplayOnAttach = false
	})

	srv := httptest.NewUnstartedServer(mux)
	srv.Listener = listener
	srv.Config.BaseContext = func(net.Listener) context.Context { return context.Background() }
	srv.Start()
	return srv, nil
}

func serveDirectConnectWS(t *testing.T, conn *websocket.Conn, sessionID, workDir, transport string, emitReplay bool, replayedPrompt, replayedQueuedCommand, replayedToolUseID, replayedToolResult, replayedAssistant string, replayedCompactBoundary bool, replayedLocalCommandBreadcrumb, replayedLocalCommandErrBreadcrumb string, rememberReplay func(string, string, string, string, string, bool, string, string)) {
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
	if emitReplay && strings.TrimSpace(replayedPrompt) != "" {
		_ = conn.WriteJSON(map[string]any{
			"type":               "user",
			"isReplay":           true,
			"isSynthetic":        false,
			"uuid":               "replayed-user-1",
			"session_id":         sessionID,
			"parent_tool_use_id": nil,
			"timestamp":          time.Now().UTC().Format(time.RFC3339Nano),
			"message": map[string]any{
				"role": "user",
				"content": []map[string]any{
					{
						"type": "text",
						"text": replayedPrompt,
					},
				},
			},
		})
	}
	if emitReplay && strings.TrimSpace(replayedToolUseID) != "" && strings.TrimSpace(replayedToolResult) != "" {
		_ = conn.WriteJSON(map[string]any{
			"type":               "user",
			"isReplay":           true,
			"isSynthetic":        true,
			"uuid":               "replayed-tool-result-1",
			"session_id":         sessionID,
			"parent_tool_use_id": nil,
			"timestamp":          time.Now().UTC().Format(time.RFC3339Nano),
			"tool_use_result": map[string]any{
				"tool_use_id": replayedToolUseID,
				"content":     replayedToolResult,
				"is_error":    false,
			},
			"message": map[string]any{
				"role": "user",
				"content": []map[string]any{
					{
						"type":        "tool_result",
						"tool_use_id": replayedToolUseID,
						"content":     replayedToolResult,
						"is_error":    false,
					},
				},
			},
		})
	}
	if emitReplay && strings.TrimSpace(replayedAssistant) != "" {
		_ = conn.WriteJSON(map[string]any{
			"type":               "assistant",
			"uuid":               "replayed-assistant-1",
			"session_id":         sessionID,
			"parent_tool_use_id": nil,
			"message": map[string]any{
				"role": "assistant",
				"content": []map[string]any{
					{
						"type": "text",
						"text": replayedAssistant,
					},
				},
			},
		})
	}
	if emitReplay && replayedCompactBoundary {
		_ = conn.WriteJSON(map[string]any{
			"type":    "system",
			"subtype": "compact_boundary",
			"compact_metadata": map[string]any{
				"trigger":    "auto",
				"pre_tokens": 128,
				"preserved_segment": map[string]any{
					"head_uuid":   "seg-head-stub",
					"anchor_uuid": "seg-anchor-stub",
					"tail_uuid":   "seg-tail-stub",
				},
			},
			"uuid":       "replayed-compact-boundary-1",
			"session_id": sessionID,
		})
	}
	if emitReplay && strings.TrimSpace(replayedLocalCommandBreadcrumb) != "" {
		_ = conn.WriteJSON(map[string]any{
			"type":               "user",
			"isReplay":           true,
			"isSynthetic":        true,
			"uuid":               "replayed-local-command-breadcrumb-1",
			"session_id":         sessionID,
			"parent_tool_use_id": nil,
			"timestamp":          time.Now().UTC().Format(time.RFC3339Nano),
			"message": map[string]any{
				"role":    "user",
				"content": replayedLocalCommandBreadcrumb,
			},
		})
	}
	if emitReplay && strings.TrimSpace(replayedLocalCommandErrBreadcrumb) != "" {
		_ = conn.WriteJSON(map[string]any{
			"type":               "user",
			"isReplay":           true,
			"isSynthetic":        true,
			"uuid":               "replayed-local-command-stderr-breadcrumb-1",
			"session_id":         sessionID,
			"parent_tool_use_id": nil,
			"timestamp":          time.Now().UTC().Format(time.RFC3339Nano),
			"message": map[string]any{
				"role":    "user",
				"content": replayedLocalCommandErrBreadcrumb,
			},
		})
	}
	if emitReplay && strings.TrimSpace(replayedQueuedCommand) != "" {
		_ = conn.WriteJSON(map[string]any{
			"type":               "user",
			"isReplay":           true,
			"isSynthetic":        true,
			"uuid":               "replayed-queued-command-1",
			"session_id":         sessionID,
			"parent_tool_use_id": nil,
			"timestamp":          time.Now().UTC().Format(time.RFC3339Nano),
			"message": map[string]any{
				"role":    "user",
				"content": replayedQueuedCommand,
				"attachment": map[string]any{
					"type":   "queued_command",
					"prompt": replayedQueuedCommand,
				},
			},
		})
	}

	requestCounter := 0
	completedTurns := 0
	pendingRequestID := ""
	pendingPrompt := ""
	remoteControlOn := false
	activeOAuthFlows := map[string]bool{}
	for {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return
		}
		switch strings.TrimSpace(asString(incoming["type"])) {
		case "update_environment_variables":
			variables, ok := incoming["variables"].(map[string]any)
			if !ok || strings.TrimSpace(asString(variables["DIRECT_CONNECT_DEMO"])) == "" {
				t.Fatalf("unexpected update_environment_variables payload: %#v", incoming)
			}
			continue
		case "user":
			prompt := "hello"
			if !emitReplay && requestCounter == 0 {
				_ = conn.WriteJSON(map[string]any{
					"type":               "user",
					"isReplay":           true,
					"uuid":               "acked-initial-user-1",
					"session_id":         sessionID,
					"parent_tool_use_id": nil,
					"timestamp":          time.Now().UTC().Format(time.RFC3339Nano),
					"message":            incoming["message"],
				})
			}
			_ = conn.WriteJSON(map[string]any{
				"type":       "system",
				"subtype":    "session_state_changed",
				"state":      "running",
				"uuid":       fmt.Sprintf("session-state-running-%d", requestCounter+1),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":       "system",
				"subtype":    "session_state_changed",
				"state":      "requires_action",
				"uuid":       fmt.Sprintf("session-state-requires-action-%d", requestCounter+1),
				"session_id": sessionID,
			})
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
					"usage":           minimalUsageFixture(),
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
					"errors":          []string{"permission denied for tool echo"},
					"fast_mode_state": "off",
					"uuid":            fmt.Sprintf("result-denied-%d", requestCounter),
					"session_id":      sessionID,
				})
				pendingRequestID = ""
				pendingPrompt = ""
				continue
			} else if strings.TrimSpace(asString(responsePayload["behavior"])) == "max_turns" {
				_ = conn.WriteJSON(map[string]any{
					"type": "attachment",
					"attachment": map[string]any{
						"type":      "max_turns_reached",
						"turnCount": completedTurns,
						"maxTurns":  completedTurns,
					},
					"uuid":       fmt.Sprintf("max-turns-attachment-%d", requestCounter),
					"session_id": sessionID,
				})
				_ = conn.WriteJSON(map[string]any{
					"type":               "result",
					"subtype":            "error_max_turns",
					"duration_ms":        1,
					"duration_api_ms":    0,
					"is_error":           true,
					"num_turns":          completedTurns,
					"stop_reason":        "max_turns",
					"total_cost_usd":     0,
					"usage":              minimalUsageFixture(),
					"modelUsage":         map[string]any{"claude-sonnet-4-5": minimalModelUsageFixture()},
					"permission_denials": []map[string]any{},
					"errors":             []string{"max turns reached in direct-connect stub"},
					"fast_mode_state":    "off",
					"uuid":               fmt.Sprintf("result-max-turns-%d", requestCounter),
					"session_id":         sessionID,
				})
				pendingRequestID = ""
				pendingPrompt = ""
				continue
			} else if strings.TrimSpace(asString(responsePayload["behavior"])) == "max_budget_usd" {
				_ = conn.WriteJSON(map[string]any{
					"type":               "result",
					"subtype":            "error_max_budget_usd",
					"duration_ms":        1,
					"duration_api_ms":    0,
					"is_error":           true,
					"num_turns":          completedTurns,
					"stop_reason":        "max_budget_usd",
					"total_cost_usd":     0,
					"usage":              minimalUsageFixture(),
					"modelUsage":         map[string]any{"claude-sonnet-4-5": minimalModelUsageFixture()},
					"permission_denials": []map[string]any{},
					"errors":             []string{"max budget usd reached in direct-connect stub"},
					"fast_mode_state":    "off",
					"uuid":               fmt.Sprintf("result-max-budget-%d", requestCounter),
					"session_id":         sessionID,
				})
				pendingRequestID = ""
				pendingPrompt = ""
				continue
			} else if strings.TrimSpace(asString(responsePayload["behavior"])) == "max_structured_output_retries" {
				_ = conn.WriteJSON(map[string]any{
					"type":               "result",
					"subtype":            "error_max_structured_output_retries",
					"duration_ms":        1,
					"duration_api_ms":    0,
					"is_error":           true,
					"num_turns":          completedTurns,
					"stop_reason":        "max_structured_output_retries",
					"total_cost_usd":     0,
					"usage":              minimalUsageFixture(),
					"modelUsage":         map[string]any{"claude-sonnet-4-5": minimalModelUsageFixture()},
					"permission_denials": []map[string]any{},
					"errors":             []string{"max structured output retries reached in direct-connect stub"},
					"fast_mode_state":    "off",
					"uuid":               fmt.Sprintf("result-max-structured-output-retries-%d", requestCounter),
					"session_id":         sessionID,
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
			if rememberReplay != nil {
				rememberReplay(pendingPrompt, pendingPrompt, fmt.Sprintf("toolu-%d", requestCounter), "echo:"+toolText, "echo:"+toolText, true, "<local-command-stdout>local command output: persisted direct-connect artifacts</local-command-stdout>", "<local-command-stderr>local command stderr: persisted direct-connect artifacts</local-command-stderr>")
			}
			_ = conn.WriteJSON(map[string]any{
				"type":       "control_cancel_request",
				"request_id": pendingRequestID,
			})
			taskID := fmt.Sprintf("task-toolu-%d", requestCounter)
			_ = conn.WriteJSON(map[string]any{
				"type":          "system",
				"subtype":       "task_started",
				"task_id":       taskID,
				"tool_use_id":   fmt.Sprintf("toolu-%d", requestCounter),
				"description":   "direct-connect echo task",
				"task_type":     "tool",
				"workflow_name": "direct-connect",
				"prompt":        toolText,
				"uuid":          fmt.Sprintf("task-started-%d", requestCounter),
				"session_id":    sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":           "system",
				"subtype":        "task_progress",
				"task_id":        taskID,
				"tool_use_id":    fmt.Sprintf("toolu-%d", requestCounter),
				"description":    "direct-connect echo task",
				"usage":          map[string]any{"total_tokens": 0, "tool_uses": 1, "duration_ms": 1},
				"last_tool_name": "echo",
				"summary":        "direct-connect echo task approved",
				"uuid":           fmt.Sprintf("task-progress-%d", requestCounter),
				"session_id":     sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":           "system",
				"subtype":        "api_retry",
				"attempt":        1,
				"max_retries":    3,
				"retry_delay_ms": 500,
				"error_status":   529,
				"error":          "rate_limit",
				"uuid":           fmt.Sprintf("api-retry-%d", requestCounter),
				"session_id":     sessionID,
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
					"type": "message_start",
					"message": map[string]any{
						"id":            fmt.Sprintf("message-start-id-%d", requestCounter),
						"type":          "message",
						"role":          "assistant",
						"content":       []any{},
						"model":         "claude-sonnet-4-5",
						"stop_reason":   nil,
						"stop_sequence": nil,
						"usage":         minimalUsageFixture(),
					},
				},
				"parent_tool_use_id": nil,
				"uuid":               fmt.Sprintf("message-start-%d", requestCounter),
				"session_id":         sessionID,
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
				"type": "stream_event",
				"event": map[string]any{
					"type":  "content_block_delta",
					"index": 0,
					"delta": map[string]any{
						"type":     "thinking_delta",
						"thinking": "direct-connect stub thinking",
					},
				},
				"parent_tool_use_id": nil,
				"uuid":               fmt.Sprintf("thinking-stream-event-%d", requestCounter),
				"session_id":         sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "stream_event",
				"event": map[string]any{
					"type":  "content_block_delta",
					"index": 0,
					"delta": map[string]any{
						"type":      "signature_delta",
						"signature": "sig-direct-connect-stub",
					},
				},
				"parent_tool_use_id": nil,
				"uuid":               fmt.Sprintf("signature-stream-event-%d", requestCounter),
				"session_id":         sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "stream_event",
				"event": map[string]any{
					"type":  "content_block_start",
					"index": 1,
					"content_block": map[string]any{
						"type":  "tool_use",
						"id":    fmt.Sprintf("toolu-%d", requestCounter),
						"name":  "echo",
						"input": "",
					},
				},
				"parent_tool_use_id": nil,
				"uuid":               fmt.Sprintf("tool-use-start-event-%d", requestCounter),
				"session_id":         sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "stream_event",
				"event": map[string]any{
					"type":  "content_block_delta",
					"index": 1,
					"delta": map[string]any{
						"type":         "input_json_delta",
						"partial_json": "{\"text\":\"" + toolText + "\"}",
					},
				},
				"parent_tool_use_id": nil,
				"uuid":               fmt.Sprintf("tool-use-stream-event-%d", requestCounter),
				"session_id":         sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "stream_event",
				"event": map[string]any{
					"type":  "content_block_stop",
					"index": 1,
				},
				"parent_tool_use_id": nil,
				"uuid":               fmt.Sprintf("tool-use-stop-event-%d", requestCounter),
				"session_id":         sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "stream_event",
				"event": map[string]any{
					"type":  "message_delta",
					"delta": map[string]any{"stop_reason": "end_turn"},
					"usage": minimalUsageFixture(),
				},
				"parent_tool_use_id": nil,
				"uuid":               fmt.Sprintf("message-delta-%d", requestCounter),
				"session_id":         sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "stream_event",
				"event": map[string]any{
					"type": "message_stop",
				},
				"parent_tool_use_id": nil,
				"uuid":               fmt.Sprintf("message-stop-%d", requestCounter),
				"session_id":         sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":       "streamlined_text",
				"text":       "echo:" + toolText,
				"uuid":       fmt.Sprintf("streamlined-text-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":        "assistant",
				"stop_reason": "end_turn",
				"usage":       minimalUsageFixture(),
				"message": map[string]any{
					"role": "assistant",
					"content": []map[string]any{
						{
							"type":      "thinking",
							"thinking":  "direct-connect stub thinking",
							"signature": "sig-direct-connect-stub",
						},
						{
							"type":  "tool_use",
							"id":    fmt.Sprintf("toolu-%d", requestCounter),
							"name":  "echo",
							"input": map[string]any{"text": toolText},
						},
						{
							"type": "text",
							"text": "echo:" + toolText,
						},
					},
				},
			})
			_ = conn.WriteJSON(map[string]any{
				"type":                   "tool_use_summary",
				"tool_name":              "echo",
				"tool_use_id":            fmt.Sprintf("toolu-%d", requestCounter),
				"duration_ms":            1,
				"input_preview":          toolText,
				"output_preview":         "echo:" + toolText,
				"summary":                "Used echo 1 time",
				"preceding_tool_use_ids": []any{fmt.Sprintf("toolu-%d", requestCounter)},
				"uuid":                   fmt.Sprintf("tool-summary-%d", requestCounter),
				"session_id":             sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":         "streamlined_tool_use_summary",
				"tool_summary": "Used echo 1 time",
				"uuid":         fmt.Sprintf("streamlined-tool-summary-%d", requestCounter),
				"session_id":   sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type": "structured_output",
					"data": map[string]any{"text": "echo:" + toolText},
				},
				"uuid":       fmt.Sprintf("structured-output-attachment-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":               "result",
				"subtype":            "success",
				"duration_ms":        1,
				"duration_api_ms":    0,
				"is_error":           false,
				"num_turns":          requestCounter,
				"result":             "echo:" + toolText,
				"structured_output":  map[string]any{"text": "echo:" + toolText},
				"stop_reason":        nil,
				"total_cost_usd":     0,
				"usage":              minimalUsageFixture(),
				"modelUsage":         map[string]any{"claude-sonnet-4-5": minimalModelUsageFixture()},
				"permission_denials": []map[string]any{},
				"fast_mode_state":    "off",
				"uuid":               fmt.Sprintf("result-%d", requestCounter),
				"session_id":         sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":       "prompt_suggestion",
				"suggestion": "Try asking for another echo example",
				"uuid":       fmt.Sprintf("prompt-suggestion-%d", requestCounter),
				"session_id": sessionID,
			})
			completedTurns++
			_ = conn.WriteJSON(map[string]any{
				"type":        "system",
				"subtype":     "task_notification",
				"task_id":     taskID,
				"tool_use_id": fmt.Sprintf("toolu-%d", requestCounter),
				"status":      "completed",
				"output_file": filepath.Join(workDir, ".claude-code-go", "tasks", taskID+".log"),
				"summary":     "echo:" + toolText,
				"usage":       map[string]any{"total_tokens": 0, "tool_uses": 1, "duration_ms": 1},
				"uuid":        fmt.Sprintf("task-notification-%d", requestCounter),
				"session_id":  sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":        "queued_command",
					"prompt":      fmt.Sprintf("<task-notification>\n<task-id>%s</task-id>\n<tool-use-id>%s</tool-use-id>\n<task-type>local_bash</task-type>\n<output-file>%s</output-file>\n<status>completed</status>\n<summary>Task %q completed</summary>\n</task-notification>", taskID, fmt.Sprintf("toolu-%d", requestCounter), filepath.Join(workDir, ".claude-code-go", "tasks", taskID+".log"), "direct-connect echo task"),
					"commandMode": "task-notification",
				},
				"uuid":       fmt.Sprintf("queued-command-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":           "task_status",
					"taskId":         taskID,
					"taskType":       "local_bash",
					"status":         "completed",
					"description":    "direct-connect echo task",
					"deltaSummary":   "echo:" + toolText,
					"outputFilePath": filepath.Join(workDir, ".claude-code-go", "tasks", taskID+".log"),
				},
				"uuid":       fmt.Sprintf("task-status-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type": "task_reminder",
					"content": []map[string]any{
						{
							"id":      taskID,
							"status":  "completed",
							"subject": "direct-connect echo task",
						},
					},
					"itemCount": 1,
				},
				"uuid":       fmt.Sprintf("task-reminder-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type": "todo_reminder",
					"content": []map[string]any{
						{
							"content":    "direct-connect echo task",
							"status":     "completed",
							"activeForm": "Completing direct-connect echo task",
						},
					},
					"itemCount": 1,
				},
				"uuid":       fmt.Sprintf("todo-reminder-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":    "system",
				"subtype": "files_persisted",
				"files": []map[string]any{
					{
						"filename": filepath.Join(workDir, ".claude-code-go", "tasks", taskID+".log"),
						"file_id":  taskID + "-output",
					},
				},
				"failed":       []map[string]any{},
				"processed_at": time.Date(2026, time.April, 7, 0, 0, requestCounter, 0, time.UTC).Format(time.RFC3339),
				"uuid":         fmt.Sprintf("files-persisted-%d", requestCounter),
				"session_id":   sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":       "system",
				"subtype":    "local_command_output",
				"content":    "local command output: persisted direct-connect artifacts",
				"uuid":       fmt.Sprintf("local-command-output-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":               "assistant",
				"uuid":               fmt.Sprintf("local-command-output-assistant-%d", requestCounter),
				"session_id":         sessionID,
				"parent_tool_use_id": nil,
				"message": map[string]any{
					"role": "assistant",
					"content": []map[string]any{
						{
							"type": "text",
							"text": "local command output: persisted direct-connect artifacts",
						},
					},
				},
			})
			_ = conn.WriteJSON(map[string]any{
				"type":               "user",
				"isReplay":           false,
				"isSynthetic":        true,
				"uuid":               fmt.Sprintf("compact-summary-%d", requestCounter),
				"session_id":         sessionID,
				"parent_tool_use_id": nil,
				"timestamp":          time.Now().UTC().Format(time.RFC3339Nano),
				"message": map[string]any{
					"role":    "user",
					"content": "Compact summary: persisted local command output for direct-connect stub",
				},
			})
			_ = conn.WriteJSON(map[string]any{
				"type":            "system",
				"subtype":         "elicitation_complete",
				"mcp_server_name": "demo-mcp-server",
				"elicitation_id":  "elicitation-direct-connect-echo",
				"uuid":            fmt.Sprintf("elicitation-complete-%d", requestCounter),
				"session_id":      sessionID,
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
				"type": "attachment",
				"attachment": map[string]any{
					"type":    "critical_system_reminder",
					"content": "Critical system reminder: stay inside the local workspace and avoid destructive actions without explicit confirmation.",
				},
				"uuid":       fmt.Sprintf("critical-system-reminder-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":  "output_style",
					"style": "explanatory",
				},
				"uuid":       fmt.Sprintf("output-style-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":        "selected_lines_in_ide",
					"ideName":     "VS Code",
					"lineStart":   12,
					"lineEnd":     14,
					"filename":    "internal/server/server.go",
					"content":     "func streamReply() {\n\twriteAttachment(\"selected_lines_in_ide\")\n}\n",
					"displayPath": "internal/server/server.go",
				},
				"uuid":       fmt.Sprintf("selected-lines-in-ide-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":     "opened_file_in_ide",
					"filename": "internal/server/server.go",
				},
				"uuid":       fmt.Sprintf("opened-file-in-ide-%d", requestCounter),
				"session_id": sessionID,
			})
			for _, diagnosticsProducer := range []string{"diagnostics", "lsp_diagnostics"} {
				_ = conn.WriteJSON(map[string]any{
					"type":       "attachment",
					"attachment": testDiagnosticsAttachmentPayload(),
					"uuid":       fmt.Sprintf("%s-%d", strings.ReplaceAll(diagnosticsProducer, "_", "-"), requestCounter),
					"session_id": sessionID,
				})
			}
			_ = conn.WriteJSON(map[string]any{
				"type":       "attachment",
				"attachment": testTaskStatusAttachmentPayload(taskID, "direct-connect echo task", "echo:"+toolText, filepath.Join(workDir, ".claude-code-go", "tasks", taskID+".log")),
				"uuid":       fmt.Sprintf("unified-task-status-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":        "mcp_resource",
					"server":      "demo-mcp",
					"uri":         "resource://demo/readme",
					"name":        "Demo README",
					"description": "demo resource",
					"content": map[string]any{
						"contents": []any{
							map[string]any{
								"uri":      "resource://demo/readme",
								"mimeType": "text/plain",
								"text":     "Demo MCP resource contents.",
							},
						},
					},
				},
				"uuid":       fmt.Sprintf("mcp-resource-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":      "budget_usd",
					"used":      12,
					"total":     20,
					"remaining": 8,
				},
				"uuid":       fmt.Sprintf("budget-usd-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type": "compaction_reminder",
				},
				"uuid":       fmt.Sprintf("compaction-reminder-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type": "context_efficiency",
				},
				"uuid":       fmt.Sprintf("context-efficiency-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":         "auto_mode",
					"reminderType": "full",
				},
				"uuid":       fmt.Sprintf("auto-mode-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type": "auto_mode_exit",
				},
				"uuid":       fmt.Sprintf("auto-mode-exit-%d", requestCounter),
				"session_id": sessionID,
			})
			planFilePath := filepath.Join(workDir, ".claude", "plan.md")
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":         "plan_mode",
					"reminderType": "full",
					"planFilePath": planFilePath,
					"planExists":   false,
					"isSubAgent":   false,
				},
				"uuid":       fmt.Sprintf("plan-mode-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":         "plan_mode_exit",
					"planFilePath": planFilePath,
					"planExists":   false,
				},
				"uuid":       fmt.Sprintf("plan-mode-exit-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":         "plan_mode_reentry",
					"planFilePath": planFilePath,
				},
				"uuid":       fmt.Sprintf("plan-mode-reentry-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":         "plan_file_reference",
					"planFilePath": planFilePath,
					"planContent":  stubPlanFileReferenceContent,
				},
				"uuid":       fmt.Sprintf("plan-file-reference-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":    "date_change",
					"newDate": "2026-04-09",
				},
				"uuid":       fmt.Sprintf("date-change-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":  "ultrathink_effort",
					"level": "high",
				},
				"uuid":       fmt.Sprintf("ultrathink-effort-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":         "deferred_tools_delta",
					"addedNames":   []string{"ToolSearch"},
					"addedLines":   []string{"- ToolSearch: Search deferred tools on demand"},
					"removedNames": []string{},
				},
				"uuid":       fmt.Sprintf("deferred-tools-delta-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":                "agent_listing_delta",
					"addedTypes":          []string{"explorer"},
					"addedLines":          []string{"- explorer: Fast codebase explorer for scoped questions"},
					"removedTypes":        []string{},
					"isInitial":           true,
					"showConcurrencyNote": true,
				},
				"uuid":       fmt.Sprintf("agent-listing-delta-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":         "mcp_instructions_delta",
					"addedNames":   []string{"chrome"},
					"addedBlocks":  []string{"## chrome\nUse ToolSearch before browser actions."},
					"removedNames": []string{},
				},
				"uuid":       fmt.Sprintf("mcp-instructions-delta-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":    "companion_intro",
					"name":    "Mochi",
					"species": "otter",
				},
				"uuid":       fmt.Sprintf("companion-intro-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":      "async_hook_response",
					"hookName":  "PostToolUse",
					"sessionId": sessionID,
					"toolUseID": "toolu_demo_async_hook",
					"content":   "Async hook completed: captured post-tool summary.",
				},
				"uuid":       fmt.Sprintf("async-hook-response-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":      "token_usage",
					"used":      1024,
					"total":     200000,
					"remaining": 198976,
				},
				"uuid":       fmt.Sprintf("token-usage-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":    "output_token_usage",
					"turn":    256,
					"session": 512,
					"budget":  1024,
				},
				"uuid":       fmt.Sprintf("output-token-usage-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type": "verify_plan_reminder",
				},
				"uuid":       fmt.Sprintf("verify-plan-reminder-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":       "current_session_memory",
					"content":    "Remember: keep this session focused.",
					"path":       "MEMORY.md",
					"tokenCount": 7,
				},
				"uuid":       fmt.Sprintf("current-session-memory-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type": "relevant_memories",
					"memories": []any{
						map[string]any{
							"path":    "memory/project.md",
							"content": "Project memory: keep nested context stable.",
							"mtimeMs": 1712700000000,
							"header":  "## memory/project.md",
							"limit":   1,
						},
					},
				},
				"uuid":       fmt.Sprintf("relevant-memories-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":        "nested_memory",
					"path":        "memory/project.md",
					"displayPath": "memory/project.md",
					"content": map[string]any{
						"path":    "memory/project.md",
						"type":    "memory_file",
						"content": "Project memory: keep nested context stable.",
					},
				},
				"uuid":       fmt.Sprintf("nested-memory-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":  "teammate_shutdown_batch",
					"count": 2,
				},
				"uuid":       fmt.Sprintf("teammate-shutdown-batch-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":         "bagel_console",
					"errorCount":   1,
					"warningCount": 2,
					"sample":       "bagel: sample warning",
				},
				"uuid":       fmt.Sprintf("bagel-console-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type": "teammate_mailbox",
					"messages": []map[string]any{
						{
							"from":      "team-lead",
							"text":      "Please pick up the next task.",
							"timestamp": "2026-04-09T12:00:00Z",
							"color":     "blue",
							"summary":   "next task",
						},
					},
				},
				"uuid":       fmt.Sprintf("teammate-mailbox-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":           "team_context",
					"agentId":        "agent-dev",
					"agentName":      "dev",
					"teamName":       "alpha",
					"teamConfigPath": ".claude/team.yaml",
					"taskListPath":   ".claude/tasks.json",
				},
				"uuid":       fmt.Sprintf("team-context-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type": "skill_discovery",
					"skills": []map[string]any{
						{
							"name":        "agent-manager",
							"description": "Coordinate and track teammate work.",
							"shortId":     "am",
						},
					},
					"signal": "user_input",
					"source": "native",
				},
				"uuid":       fmt.Sprintf("skill-discovery-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":        "dynamic_skill",
					"skillDir":    ".codex/skills/agent-manager",
					"skillNames":  []string{"agent-manager", "use-fractalbot"},
					"displayPath": ".codex/skills",
				},
				"uuid":       fmt.Sprintf("dynamic-skill-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type": "attachment",
				"attachment": map[string]any{
					"type":       "skill_listing",
					"content":    "agent-manager: Coordinate and track teammate work.",
					"skillCount": 1,
					"isInitial":  true,
				},
				"uuid":       fmt.Sprintf("skill-listing-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":           "system",
				"subtype":        "status",
				"status":         "compacting",
				"permissionMode": "default",
				"uuid":           fmt.Sprintf("status-compacting-%d", requestCounter),
				"session_id":     sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":    "system",
				"subtype": "compact_boundary",
				"compact_metadata": map[string]any{
					"trigger":    "auto",
					"pre_tokens": 128,
					"preserved_segment": map[string]any{
						"head_uuid":   "seg-head-stub",
						"anchor_uuid": "seg-anchor-stub",
						"tail_uuid":   "seg-tail-stub",
					},
				},
				"uuid":       fmt.Sprintf("compact-boundary-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":           "system",
				"subtype":        "status",
				"status":         nil,
				"permissionMode": "default",
				"uuid":           fmt.Sprintf("status-cleared-%d", requestCounter),
				"session_id":     sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":       "system",
				"subtype":    "session_state_changed",
				"state":      "idle",
				"uuid":       fmt.Sprintf("session-state-idle-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":       "system",
				"subtype":    "hook_started",
				"hook_id":    "hook-direct-connect-echo",
				"hook_name":  "DirectConnectEchoHook",
				"hook_event": "Stop",
				"uuid":       fmt.Sprintf("hook-started-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":       "system",
				"subtype":    "hook_progress",
				"hook_id":    "hook-direct-connect-echo",
				"hook_name":  "DirectConnectEchoHook",
				"hook_event": "Stop",
				"output":     "echo hook running",
				"stdout":     "echo:" + toolText,
				"stderr":     "",
				"uuid":       fmt.Sprintf("hook-progress-%d", requestCounter),
				"session_id": sessionID,
			})
			_ = conn.WriteJSON(map[string]any{
				"type":       "system",
				"subtype":    "hook_response",
				"hook_id":    "hook-direct-connect-echo",
				"hook_name":  "DirectConnectEchoHook",
				"hook_event": "Stop",
				"output":     "echo hook completed",
				"stdout":     "echo:" + toolText,
				"stderr":     "",
				"exit_code":  0,
				"outcome":    "success",
				"uuid":       fmt.Sprintf("hook-response-%d", requestCounter),
				"session_id": sessionID,
			})
			pendingRequestID = ""
			pendingPrompt = ""
		case "control_request":
			requestID := strings.TrimSpace(asString(incoming["request_id"]))
			request, _ := incoming["request"].(map[string]any)
			subtype := strings.TrimSpace(asString(request["subtype"]))
			responsePayload := map[string]any{}
			switch subtype {
			case "interrupt":
				responsePayload["interrupted"] = true
			case "set_model":
			case "set_permission_mode":
			case "set_max_thinking_tokens":
			case "mcp_status":
				responsePayload["mcpServers"] = []any{}
			case "get_context_usage":
				responsePayload["categories"] = []any{}
				responsePayload["totalTokens"] = 0
				responsePayload["maxTokens"] = 0
				responsePayload["rawMaxTokens"] = 0
				responsePayload["percentage"] = 0
				responsePayload["gridRows"] = []any{}
				responsePayload["model"] = "claude-sonnet-4-5"
				responsePayload["memoryFiles"] = []any{}
				responsePayload["mcpTools"] = []any{}
				responsePayload["agents"] = []any{}
				responsePayload["isAutoCompactEnabled"] = false
				responsePayload["apiUsage"] = nil
			case "mcp_message":
				_ = responsePayload
			case "mcp_set_servers":
				responsePayload["added"] = []any{}
				responsePayload["removed"] = []any{}
				responsePayload["errors"] = map[string]any{}
			case "reload_plugins":
				responsePayload["commands"] = []any{}
				responsePayload["agents"] = []any{}
				responsePayload["plugins"] = []any{}
				responsePayload["mcpServers"] = []any{}
				responsePayload["error_count"] = 0
			case "mcp_authenticate":
				serverName := strings.TrimSpace(asString(request["serverName"]))
				responseEnvelope := map[string]any{
					"request_id": requestID,
				}
				switch serverName {
				case "demo-http-mcp", "demo-sse-mcp":
					activeOAuthFlows[serverName] = true
					responseEnvelope["subtype"] = "success"
					responseEnvelope["response"] = map[string]any{
						"requiresUserAction": true,
						"authUrl":            "https://example.test/oauth/" + serverName,
					}
				case "demo-stdio-mcp":
					responseEnvelope["subtype"] = "error"
					responseEnvelope["error"] = `Server type "stdio" does not support OAuth authentication`
				default:
					responseEnvelope["subtype"] = "error"
					responseEnvelope["error"] = "Server not found: " + serverName
				}
				_ = conn.WriteJSON(map[string]any{
					"type":     "control_response",
					"response": responseEnvelope,
				})
				continue
			case "mcp_oauth_callback_url":
				serverName := strings.TrimSpace(asString(request["serverName"]))
				callbackURL := strings.TrimSpace(asString(request["callbackUrl"]))
				responseEnvelope := map[string]any{
					"request_id": requestID,
				}
				if !activeOAuthFlows[serverName] {
					responseEnvelope["subtype"] = "error"
					responseEnvelope["error"] = "No active OAuth flow for server: " + serverName
				} else {
					parsed, err := url.Parse(callbackURL)
					if err != nil || (!parsed.Query().Has("code") && !parsed.Query().Has("error")) {
						responseEnvelope["subtype"] = "error"
						responseEnvelope["error"] = "Invalid callback URL: missing authorization code. Please paste the full redirect URL including the code parameter."
					} else {
						delete(activeOAuthFlows, serverName)
						responseEnvelope["subtype"] = "success"
						responseEnvelope["response"] = map[string]any{}
					}
				}
				_ = conn.WriteJSON(map[string]any{
					"type":     "control_response",
					"response": responseEnvelope,
				})
				continue
			case "mcp_reconnect":
				_ = responsePayload
			case "mcp_toggle":
				_ = responsePayload
			case "seed_read_state":
				_ = responsePayload
			case "rewind_files":
				responsePayload["canRewind"] = true
				responsePayload["filesChanged"] = []any{"README.md"}
				responsePayload["insertions"] = 1
				responsePayload["deletions"] = 0
			case "cancel_async_message":
				responsePayload["cancelled"] = false
			case "stop_task":
			case "apply_flag_settings":
			case "get_settings":
				responsePayload["effective"] = map[string]any{}
				responsePayload["sources"] = []any{}
				responsePayload["applied"] = map[string]any{
					"model":  "claude-sonnet-4-5",
					"effort": nil,
				}
			case "generate_session_title":
				responsePayload["title"] = "Direct Connect Session"
			case "side_question":
				responsePayload["response"] = "Direct Connect Side Answer"
			case "initialize":
				responsePayload["commands"] = []any{}
				responsePayload["agents"] = []any{}
				responsePayload["output_style"] = "text"
				responsePayload["available_output_styles"] = []any{"text"}
				responsePayload["models"] = []any{}
				responsePayload["account"] = map[string]any{
					"apiProvider":  "anthropic",
					"tokenSource":  "oauth",
					"apiKeySource": "oauth",
				}
				responsePayload["pid"] = 12345
			case "elicitation":
				responsePayload["action"] = "cancel"
			case "hook_callback":
			case "channel_enable":
				responsePayload["serverName"] = strings.TrimSpace(asString(request["serverName"]))
			case "set_proactive":
			case "remote_control":
				if enabled, ok := request["enabled"].(bool); ok && enabled {
					if !remoteControlOn {
						remoteControlOn = true
					}
					responsePayload["session_url"] = "https://example.test/sessions/remote-control"
					responsePayload["connect_url"] = "cc://remote-control?token=demo-token"
					responsePayload["environment_id"] = "env-demo"
					_ = conn.WriteJSON(map[string]any{
						"type":       "system",
						"subtype":    "bridge_state",
						"state":      "connected",
						"detail":     "stub remote control enabled",
						"uuid":       "bridge-state-connected",
						"session_id": sessionID,
					})
				} else if remoteControlOn {
					remoteControlOn = false
					_ = conn.WriteJSON(map[string]any{
						"type":       "system",
						"subtype":    "bridge_state",
						"state":      "disconnected",
						"detail":     "stub remote control disabled",
						"uuid":       "bridge-state-disconnected",
						"session_id": sessionID,
					})
				}
			case "end_session":
			default:
				continue
			}
			_ = conn.WriteJSON(map[string]any{
				"type": "control_response",
				"response": map[string]any{
					"subtype":    "success",
					"request_id": requestID,
					"response":   responsePayload,
				},
			})
			if subtype == "set_permission_mode" {
				_ = conn.WriteJSON(map[string]any{
					"type":           "system",
					"subtype":        "status",
					"status":         "running",
					"permissionMode": strings.TrimSpace(asString(request["mode"])),
					"uuid":           fmt.Sprintf("status-transition-%d", requestCounter),
					"session_id":     sessionID,
				})
			}
			if subtype == "end_session" {
				return
			}
		}
	}
}

func testDiagnosticsAttachmentPayload() map[string]any {
	return map[string]any{
		"type":  "diagnostics",
		"isNew": true,
		"files": []any{
			map[string]any{
				"uri": "file:///workspace/claude-code-go/internal/server/server.go",
				"diagnostics": []any{
					map[string]any{
						"message":  "unused variable `staleBudget`",
						"severity": "Warning",
						"range": map[string]any{
							"start": map[string]any{
								"line":      12.0,
								"character": 4.0,
							},
							"end": map[string]any{
								"line":      12.0,
								"character": 15.0,
							},
						},
						"source": "gopls",
						"code":   "unusedvar",
					},
				},
			},
		},
	}
}

func testTaskStatusAttachmentPayload(taskID, taskDescription, deltaSummary, outputFilePath string) map[string]any {
	return map[string]any{
		"type":           "task_status",
		"taskId":         taskID,
		"taskType":       "local_bash",
		"status":         "completed",
		"description":    taskDescription,
		"deltaSummary":   deltaSummary,
		"outputFilePath": outputFilePath,
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

func minimalUsageFixture() map[string]any {
	return map[string]any{
		"input_tokens":                0,
		"cache_creation_input_tokens": 0,
		"cache_read_input_tokens":     0,
		"output_tokens":               0,
		"server_tool_use": map[string]any{
			"web_search_requests": 0,
			"web_fetch_requests":  0,
		},
		"service_tier": "standard",
		"cache_creation": map[string]any{
			"ephemeral_1h_input_tokens": 0,
			"ephemeral_5m_input_tokens": 0,
		},
		"inference_geo": "",
		"iterations":    []any{},
		"speed":         "standard",
	}
}
