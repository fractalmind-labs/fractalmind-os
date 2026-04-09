package open

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type Options struct {
	ConnectURL      string
	PrintMode       bool
	PrintPrompt     string
	OutputFormat    string
	ResumeSessionID string
	StopSessionID   string
}

type Result struct {
	Status                                                       string
	Action                                                       string
	ConnectURL                                                   string
	Transport                                                    string
	ServerURL                                                    string
	AuthToken                                                    string
	PrintMode                                                    bool
	PrintPrompt                                                  string
	OutputFormat                                                 string
	RequestCWD                                                   string
	SessionID                                                    string
	WSURL                                                        string
	WorkDir                                                      string
	StreamValidated                                              bool
	StreamEvent                                                  string
	StreamContentValidated                                       bool
	StreamContentEvent                                           string
	ThinkingDeltaValidated                                       bool
	ThinkingDeltaEvent                                           string
	ThinkingSignatureValidated                                   bool
	ThinkingSignatureEvent                                       string
	ToolUseDeltaValidated                                        bool
	ToolUseDeltaEvent                                            string
	ToolUseBlockStartValidated                                   bool
	ToolUseBlockStartEvent                                       string
	ToolUseBlockStopValidated                                    bool
	ToolUseBlockStopEvent                                        string
	AssistantMessageStartValidated                               bool
	AssistantMessageStartEvent                                   string
	AssistantMessageDeltaValidated                               bool
	AssistantMessageDeltaEvent                                   string
	AssistantMessageStopValidated                                bool
	AssistantMessageStopEvent                                    string
	AssistantThinkingValidated                                   bool
	AssistantThinkingEvent                                       string
	AssistantToolUseValidated                                    bool
	AssistantToolUseEvent                                        string
	AssistantStopReasonValidated                                 bool
	AssistantStopReasonEvent                                     string
	AssistantUsageValidated                                      bool
	AssistantUsageEvent                                          string
	StructuredOutputAttachmentValidated                          bool
	StructuredOutputAttachmentEvent                              string
	MaxTurnsReachedAttachmentValidated                           bool
	MaxTurnsReachedAttachmentEvent                               string
	TaskStatusAttachmentValidated                                bool
	TaskStatusAttachmentEvent                                    string
	QueuedCommandValidated                                       bool
	QueuedCommandEvent                                           string
	TaskReminderAttachmentValidated                              bool
	TaskReminderAttachmentEvent                                  string
	TodoReminderAttachmentValidated                              bool
	TodoReminderAttachmentEvent                                  string
	CompactionReminderValidated                                  bool
	CompactionReminderEvent                                      string
	ContextEfficiencyValidated                                   bool
	ContextEfficiencyEvent                                       string
	AutoModeExitValidated                                        bool
	AutoModeExitEvent                                            string
	PlanModeValidated                                            bool
	PlanModeEvent                                                string
	PlanModeExitValidated                                        bool
	PlanModeExitEvent                                            string
	PlanModeReentryValidated                                     bool
	PlanModeReentryEvent                                         string
	DateChangeValidated                                          bool
	DateChangeEvent                                              string
	UltrathinkEffortValidated                                    bool
	UltrathinkEffortEvent                                        string
	DeferredToolsDeltaValidated                                  bool
	DeferredToolsDeltaEvent                                      string
	AgentListingDeltaValidated                                   bool
	AgentListingDeltaEvent                                       string
	MCPInstructionsDeltaValidated                                bool
	MCPInstructionsDeltaEvent                                    string
	CompanionIntroValidated                                      bool
	CompanionIntroEvent                                          string
	TokenUsageValidated                                          bool
	TokenUsageEvent                                              string
	OutputTokenUsageValidated                                    bool
	OutputTokenUsageEvent                                        string
	VerifyPlanReminderValidated                                  bool
	VerifyPlanReminderEvent                                      string
	StreamlinedTextValidated                                     bool
	StreamlinedTextEvent                                         string
	SystemValidated                                              bool
	SystemEvent                                                  string
	StatusValidated                                              bool
	StatusEvent                                                  string
	StatusTransitionValidated                                    bool
	StatusTransitionEvent                                        string
	StatusCompactingLifecycleValidated                           bool
	StatusCompactingLifecycleEvent                               string
	CompactSummaryValidated                                      bool
	CompactSummaryEvent                                          string
	CompactSummarySyntheticValidated                             bool
	CompactSummarySyntheticEvent                                 string
	CompactSummaryTimestampValidated                             bool
	CompactSummaryTimestampEvent                                 string
	CompactSummaryParentToolUseIDValidated                       bool
	CompactSummaryParentToolUseIDEvent                           string
	AckedInitialUserReplayValidated                              bool
	AckedInitialUserReplayEvent                                  string
	ReplayedUserMessageValidated                                 bool
	ReplayedUserMessageEvent                                     string
	ReplayedUserSyntheticValidated                               bool
	ReplayedUserSyntheticEvent                                   string
	ReplayedUserTimestampValidated                               bool
	ReplayedUserTimestampEvent                                   string
	ReplayedUserParentToolUseIDValidated                         bool
	ReplayedUserParentToolUseIDEvent                             string
	ReplayedQueuedCommandValidated                               bool
	ReplayedQueuedCommandEvent                                   string
	ReplayedQueuedCommandSyntheticValidated                      bool
	ReplayedQueuedCommandSyntheticEvent                          string
	ReplayedQueuedCommandTimestampValidated                      bool
	ReplayedQueuedCommandTimestampEvent                          string
	ReplayedQueuedCommandParentToolUseIDValidated                bool
	ReplayedQueuedCommandParentToolUseIDEvent                    string
	ReplayedToolResultValidated                                  bool
	ReplayedToolResultEvent                                      string
	ReplayedToolResultSyntheticValidated                         bool
	ReplayedToolResultSyntheticEvent                             string
	ReplayedToolResultTimestampValidated                         bool
	ReplayedToolResultTimestampEvent                             string
	ReplayedToolResultParentToolUseIDValidated                   bool
	ReplayedToolResultParentToolUseIDEvent                       string
	ReplayedAssistantMessageValidated                            bool
	ReplayedAssistantMessageEvent                                string
	ReplayedCompactBoundaryValidated                             bool
	ReplayedCompactBoundaryEvent                                 string
	ReplayedCompactBoundaryPreservedSegmentValidated             bool
	ReplayedCompactBoundaryPreservedSegmentEvent                 string
	ReplayedLocalCommandBreadcrumbValidated                      bool
	ReplayedLocalCommandBreadcrumbEvent                          string
	ReplayedLocalCommandBreadcrumbSyntheticValidated             bool
	ReplayedLocalCommandBreadcrumbSyntheticEvent                 string
	ReplayedLocalCommandBreadcrumbTimestampValidated             bool
	ReplayedLocalCommandBreadcrumbTimestampEvent                 string
	ReplayedLocalCommandBreadcrumbParentToolUseIDValidated       bool
	ReplayedLocalCommandBreadcrumbParentToolUseIDEvent           string
	ReplayedLocalCommandStderrBreadcrumbValidated                bool
	ReplayedLocalCommandStderrBreadcrumbEvent                    string
	ReplayedLocalCommandStderrBreadcrumbSyntheticValidated       bool
	ReplayedLocalCommandStderrBreadcrumbSyntheticEvent           string
	ReplayedLocalCommandStderrBreadcrumbTimestampValidated       bool
	ReplayedLocalCommandStderrBreadcrumbTimestampEvent           string
	ReplayedLocalCommandStderrBreadcrumbParentToolUseIDValidated bool
	ReplayedLocalCommandStderrBreadcrumbParentToolUseIDEvent     string
	AuthValidated                                                bool
	AuthEvent                                                    string
	KeepAliveValidated                                           bool
	KeepAliveEvent                                               string
	UpdateEnvironmentVariablesValidated                          bool
	UpdateEnvironmentVariablesEvent                              string
	ControlCancelValidated                                       bool
	ControlCancelEvent                                           string
	MessageValidated                                             bool
	MessageEvent                                                 string
	ValidatedTurns                                               int
	MultiTurnValidated                                           bool
	ResultValidated                                              bool
	ResultEvent                                                  string
	ResultStructuredOutputValidated                              bool
	ResultStructuredOutputEvent                                  string
	ResultUsageValidated                                         bool
	ResultUsageEvent                                             string
	ResultModelUsageValidated                                    bool
	ResultModelUsageEvent                                        string
	ResultPermissionDenialsValidated                             bool
	ResultPermissionDenialsEvent                                 string
	ResultFastModeStateValidated                                 bool
	ResultFastModeStateEvent                                     string
	ResultErrorValidated                                         bool
	ResultErrorEvent                                             string
	ResultErrorUsageValidated                                    bool
	ResultErrorUsageEvent                                        string
	ResultErrorPermissionDenialsValidated                        bool
	ResultErrorPermissionDenialsEvent                            string
	ResultErrorModelUsageValidated                               bool
	ResultErrorModelUsageEvent                                   string
	ResultErrorFastModeStateValidated                            bool
	ResultErrorFastModeStateEvent                                string
	ResultErrorMaxTurnsValidated                                 bool
	ResultErrorMaxTurnsEvent                                     string
	ResultErrorMaxTurnsFastModeStateValidated                    bool
	ResultErrorMaxTurnsFastModeStateEvent                        string
	ResultErrorMaxBudgetUSDValidated                             bool
	ResultErrorMaxBudgetUSDEvent                                 string
	ResultErrorMaxBudgetUSDFastModeStateValidated                bool
	ResultErrorMaxBudgetUSDFastModeStateEvent                    string
	ResultErrorMaxStructuredOutputRetriesValidated               bool
	ResultErrorMaxStructuredOutputRetriesEvent                   string
	ResultErrorMaxStructuredOutputRetriesFastModeStateValidated  bool
	ResultErrorMaxStructuredOutputRetriesFastModeStateEvent      string
	ControlValidated                                             bool
	PermissionValidated                                          bool
	PermissionDeniedValidated                                    bool
	PermissionDeniedEvent                                        string
	TaskStartedValidated                                         bool
	TaskStartedEvent                                             string
	TaskProgressValidated                                        bool
	TaskProgressEvent                                            string
	TaskNotificationValidated                                    bool
	TaskNotificationEvent                                        string
	FilesPersistedValidated                                      bool
	FilesPersistedEvent                                          string
	APIRetryValidated                                            bool
	APIRetryEvent                                                string
	LocalCommandOutputValidated                                  bool
	LocalCommandOutputEvent                                      string
	LocalCommandOutputAssistantValidated                         bool
	LocalCommandOutputAssistantEvent                             string
	ElicitationValidated                                         bool
	ElicitationEvent                                             string
	HookCallbackValidated                                        bool
	HookCallbackEvent                                            string
	ChannelEnableValidated                                       bool
	ChannelEnableEvent                                           string
	ElicitationCompleteValidated                                 bool
	ElicitationCompleteEvent                                     string
	ToolProgressValidated                                        bool
	ToolProgressEvent                                            string
	RateLimitValidated                                           bool
	RateLimitEvent                                               string
	ToolUseSummaryValidated                                      bool
	ToolUseSummaryEvent                                          string
	ToolUseSummaryShapeValidated                                 bool
	ToolUseSummaryShapeEvent                                     string
	StreamlinedToolUseSummaryValidated                           bool
	StreamlinedToolUseSummaryEvent                               string
	PromptSuggestionValidated                                    bool
	PromptSuggestionEvent                                        string
	PostTurnSummaryValidated                                     bool
	PostTurnSummaryEvent                                         string
	CompactBoundaryValidated                                     bool
	CompactBoundaryEvent                                         string
	CompactBoundaryPreservedSegmentValidated                     bool
	CompactBoundaryPreservedSegmentEvent                         string
	SessionStateChangedValidated                                 bool
	SessionStateChangedEvent                                     string
	SessionStateRequiresActionValidated                          bool
	SessionStateRequiresActionEvent                              string
	HookStartedValidated                                         bool
	HookStartedEvent                                             string
	HookProgressValidated                                        bool
	HookProgressEvent                                            string
	HookResponseValidated                                        bool
	HookResponseEvent                                            string
	ToolExecutionValidated                                       bool
	InterruptValidated                                           bool
	SetModelValidated                                            bool
	SetModelEvent                                                string
	SetPermissionModeValidated                                   bool
	SetPermissionModeEvent                                       string
	SetMaxThinkingTokensValidated                                bool
	SetMaxThinkingTokensEvent                                    string
	MCPStatusValidated                                           bool
	MCPStatusEvent                                               string
	GetContextUsageValidated                                     bool
	GetContextUsageEvent                                         string
	MCPMessageValidated                                          bool
	MCPMessageEvent                                              string
	MCPSetServersValidated                                       bool
	MCPSetServersEvent                                           string
	ReloadPluginsValidated                                       bool
	ReloadPluginsEvent                                           string
	MCPAuthenticateValidated                                     bool
	MCPAuthenticateEvent                                         string
	MCPOAuthCallbackURLValidated                                 bool
	MCPOAuthCallbackURLEvent                                     string
	MCPReconnectValidated                                        bool
	MCPReconnectEvent                                            string
	MCPToggleValidated                                           bool
	MCPToggleEvent                                               string
	SeedReadStateValidated                                       bool
	SeedReadStateEvent                                           string
	RewindFilesValidated                                         bool
	RewindFilesEvent                                             string
	RewindFilesCanRewind                                         bool
	RewindFilesFilesChanged                                      int
	RewindFilesInsertions                                        int
	RewindFilesDeletions                                         int
	RewindFilesError                                             string
	CancelAsyncMessageValidated                                  bool
	CancelAsyncMessageEvent                                      string
	StopTaskValidated                                            bool
	StopTaskEvent                                                string
	ApplyFlagSettingsValidated                                   bool
	ApplyFlagSettingsEvent                                       string
	GetSettingsValidated                                         bool
	GetSettingsEvent                                             string
	GenerateSessionTitleValidated                                bool
	GenerateSessionTitleEvent                                    string
	SideQuestionValidated                                        bool
	SideQuestionEvent                                            string
	InitializeValidated                                          bool
	InitializeEvent                                              string
	SetProactiveValidated                                        bool
	SetProactiveEvent                                            string
	BridgeStateValidated                                         bool
	BridgeStateEvent                                             string
	RemoteControlValidated                                       bool
	RemoteControlEvent                                           string
	EndSessionValidated                                          bool
	EndSessionEvent                                              string
	BackendValidated                                             bool
	BackendStatus                                                string
	BackendPID                                                   int
	BackendStartedAt                                             int64
	BackendStoppedAt                                             int64
	BackendExitCode                                              int
}

func Run(args []string) (Result, error) {
	opts, err := parseArgs(args)
	if err != nil {
		return Result{}, err
	}

	serverURL, transport, authToken, err := parseConnectURL(opts.ConnectURL)
	if err != nil {
		return Result{}, err
	}
	if strings.TrimSpace(opts.StopSessionID) != "" {
		state, err := stopSession(serverURL, transport, authToken, opts.StopSessionID)
		if err != nil {
			return Result{}, err
		}
		return Result{
			Status:           firstNonEmpty(state.Status, "stopped"),
			Action:           actionForOptions(opts),
			ConnectURL:       opts.ConnectURL,
			Transport:        transport,
			ServerURL:        serverURL,
			AuthToken:        authToken,
			PrintMode:        opts.PrintMode,
			PrintPrompt:      opts.PrintPrompt,
			OutputFormat:     opts.OutputFormat,
			SessionID:        state.SessionID,
			WorkDir:          state.WorkDir,
			BackendStatus:    state.BackendStatus,
			BackendPID:       state.BackendPID,
			BackendStartedAt: state.BackendStartedAt,
			BackendStoppedAt: state.BackendStoppedAt,
			BackendExitCode:  state.BackendExitCode,
		}, nil
	}

	cwd, err := os.Getwd()
	if err != nil {
		return Result{}, fmt.Errorf("get cwd: %w", err)
	}

	session, err := createOrResumeSession(serverURL, transport, authToken, cwd, opts.ResumeSessionID)
	if err != nil {
		return Result{}, err
	}

	streamResult, err := validateStream(session.WSURL, authToken, opts)
	if err != nil {
		return Result{}, err
	}
	state, err := inspectSession(serverURL, transport, authToken, session.SessionID)
	if err != nil {
		return Result{}, err
	}

	return Result{
		Status:                                                       "connected",
		Action:                                                       actionForOptions(opts),
		ConnectURL:                                                   opts.ConnectURL,
		Transport:                                                    transport,
		ServerURL:                                                    serverURL,
		AuthToken:                                                    authToken,
		PrintMode:                                                    opts.PrintMode,
		PrintPrompt:                                                  opts.PrintPrompt,
		OutputFormat:                                                 opts.OutputFormat,
		RequestCWD:                                                   cwd,
		SessionID:                                                    session.SessionID,
		WSURL:                                                        session.WSURL,
		WorkDir:                                                      session.WorkDir,
		StreamValidated:                                              true,
		StreamEvent:                                                  streamResult.StreamEvent,
		StreamContentValidated:                                       streamResult.StreamContentValidated,
		StreamContentEvent:                                           streamResult.StreamContentEvent,
		ThinkingDeltaValidated:                                       streamResult.ThinkingDeltaValidated,
		ThinkingDeltaEvent:                                           streamResult.ThinkingDeltaEvent,
		ThinkingSignatureValidated:                                   streamResult.ThinkingSignatureValidated,
		ThinkingSignatureEvent:                                       streamResult.ThinkingSignatureEvent,
		ToolUseDeltaValidated:                                        streamResult.ToolUseDeltaValidated,
		ToolUseDeltaEvent:                                            streamResult.ToolUseDeltaEvent,
		ToolUseBlockStartValidated:                                   streamResult.ToolUseBlockStartValidated,
		ToolUseBlockStartEvent:                                       streamResult.ToolUseBlockStartEvent,
		ToolUseBlockStopValidated:                                    streamResult.ToolUseBlockStopValidated,
		ToolUseBlockStopEvent:                                        streamResult.ToolUseBlockStopEvent,
		AssistantMessageStartValidated:                               streamResult.AssistantMessageStartValidated,
		AssistantMessageStartEvent:                                   streamResult.AssistantMessageStartEvent,
		AssistantMessageDeltaValidated:                               streamResult.AssistantMessageDeltaValidated,
		AssistantMessageDeltaEvent:                                   streamResult.AssistantMessageDeltaEvent,
		AssistantMessageStopValidated:                                streamResult.AssistantMessageStopValidated,
		AssistantMessageStopEvent:                                    streamResult.AssistantMessageStopEvent,
		AssistantThinkingValidated:                                   streamResult.AssistantThinkingValidated,
		AssistantThinkingEvent:                                       streamResult.AssistantThinkingEvent,
		AssistantToolUseValidated:                                    streamResult.AssistantToolUseValidated,
		AssistantToolUseEvent:                                        streamResult.AssistantToolUseEvent,
		AssistantStopReasonValidated:                                 streamResult.AssistantStopReasonValidated,
		AssistantStopReasonEvent:                                     streamResult.AssistantStopReasonEvent,
		AssistantUsageValidated:                                      streamResult.AssistantUsageValidated,
		AssistantUsageEvent:                                          streamResult.AssistantUsageEvent,
		StructuredOutputAttachmentValidated:                          streamResult.StructuredOutputAttachmentValidated,
		StructuredOutputAttachmentEvent:                              streamResult.StructuredOutputAttachmentEvent,
		MaxTurnsReachedAttachmentValidated:                           streamResult.MaxTurnsReachedAttachmentValidated,
		MaxTurnsReachedAttachmentEvent:                               streamResult.MaxTurnsReachedAttachmentEvent,
		TaskStatusAttachmentValidated:                                streamResult.TaskStatusAttachmentValidated,
		TaskStatusAttachmentEvent:                                    streamResult.TaskStatusAttachmentEvent,
		QueuedCommandValidated:                                       streamResult.QueuedCommandValidated,
		QueuedCommandEvent:                                           streamResult.QueuedCommandEvent,
		TaskReminderAttachmentValidated:                              streamResult.TaskReminderAttachmentValidated,
		TaskReminderAttachmentEvent:                                  streamResult.TaskReminderAttachmentEvent,
		TodoReminderAttachmentValidated:                              streamResult.TodoReminderAttachmentValidated,
		TodoReminderAttachmentEvent:                                  streamResult.TodoReminderAttachmentEvent,
		CompactionReminderValidated:                                  streamResult.CompactionReminderValidated,
		CompactionReminderEvent:                                      streamResult.CompactionReminderEvent,
		ContextEfficiencyValidated:                                   streamResult.ContextEfficiencyValidated,
		ContextEfficiencyEvent:                                       streamResult.ContextEfficiencyEvent,
		AutoModeExitValidated:                                        streamResult.AutoModeExitValidated,
		AutoModeExitEvent:                                            streamResult.AutoModeExitEvent,
		PlanModeValidated:                                            streamResult.PlanModeValidated,
		PlanModeEvent:                                                streamResult.PlanModeEvent,
		PlanModeExitValidated:                                        streamResult.PlanModeExitValidated,
		PlanModeExitEvent:                                            streamResult.PlanModeExitEvent,
		PlanModeReentryValidated:                                     streamResult.PlanModeReentryValidated,
		PlanModeReentryEvent:                                         streamResult.PlanModeReentryEvent,
		DateChangeValidated:                                          streamResult.DateChangeValidated,
		DateChangeEvent:                                              streamResult.DateChangeEvent,
		UltrathinkEffortValidated:                                    streamResult.UltrathinkEffortValidated,
		UltrathinkEffortEvent:                                        streamResult.UltrathinkEffortEvent,
		DeferredToolsDeltaValidated:                                  streamResult.DeferredToolsDeltaValidated,
		DeferredToolsDeltaEvent:                                      streamResult.DeferredToolsDeltaEvent,
		AgentListingDeltaValidated:                                   streamResult.AgentListingDeltaValidated,
		AgentListingDeltaEvent:                                       streamResult.AgentListingDeltaEvent,
		MCPInstructionsDeltaValidated:                                streamResult.MCPInstructionsDeltaValidated,
		MCPInstructionsDeltaEvent:                                    streamResult.MCPInstructionsDeltaEvent,
		CompanionIntroValidated:                                      streamResult.CompanionIntroValidated,
		CompanionIntroEvent:                                          streamResult.CompanionIntroEvent,
		TokenUsageValidated:                                          streamResult.TokenUsageValidated,
		TokenUsageEvent:                                              streamResult.TokenUsageEvent,
		OutputTokenUsageValidated:                                    streamResult.OutputTokenUsageValidated,
		OutputTokenUsageEvent:                                        streamResult.OutputTokenUsageEvent,
		VerifyPlanReminderValidated:                                  streamResult.VerifyPlanReminderValidated,
		VerifyPlanReminderEvent:                                      streamResult.VerifyPlanReminderEvent,
		StreamlinedTextValidated:                                     streamResult.StreamlinedTextValidated,
		StreamlinedTextEvent:                                         streamResult.StreamlinedTextEvent,
		SystemValidated:                                              streamResult.SystemValidated,
		SystemEvent:                                                  streamResult.SystemEvent,
		StatusValidated:                                              streamResult.StatusValidated,
		StatusEvent:                                                  streamResult.StatusEvent,
		StatusTransitionValidated:                                    streamResult.StatusTransitionValidated,
		StatusTransitionEvent:                                        streamResult.StatusTransitionEvent,
		StatusCompactingLifecycleValidated:                           streamResult.StatusCompactingLifecycleValidated,
		StatusCompactingLifecycleEvent:                               streamResult.StatusCompactingLifecycleEvent,
		CompactSummaryValidated:                                      streamResult.CompactSummaryValidated,
		CompactSummaryEvent:                                          streamResult.CompactSummaryEvent,
		CompactSummarySyntheticValidated:                             streamResult.CompactSummarySyntheticValidated,
		CompactSummarySyntheticEvent:                                 streamResult.CompactSummarySyntheticEvent,
		CompactSummaryTimestampValidated:                             streamResult.CompactSummaryTimestampValidated,
		CompactSummaryTimestampEvent:                                 streamResult.CompactSummaryTimestampEvent,
		CompactSummaryParentToolUseIDValidated:                       streamResult.CompactSummaryParentToolUseIDValidated,
		CompactSummaryParentToolUseIDEvent:                           streamResult.CompactSummaryParentToolUseIDEvent,
		AckedInitialUserReplayValidated:                              streamResult.AckedInitialUserReplayValidated,
		AckedInitialUserReplayEvent:                                  streamResult.AckedInitialUserReplayEvent,
		ReplayedUserMessageValidated:                                 streamResult.ReplayedUserMessageValidated,
		ReplayedUserMessageEvent:                                     streamResult.ReplayedUserMessageEvent,
		ReplayedUserSyntheticValidated:                               streamResult.ReplayedUserSyntheticValidated,
		ReplayedUserSyntheticEvent:                                   streamResult.ReplayedUserSyntheticEvent,
		ReplayedUserTimestampValidated:                               streamResult.ReplayedUserTimestampValidated,
		ReplayedUserTimestampEvent:                                   streamResult.ReplayedUserTimestampEvent,
		ReplayedUserParentToolUseIDValidated:                         streamResult.ReplayedUserParentToolUseIDValidated,
		ReplayedUserParentToolUseIDEvent:                             streamResult.ReplayedUserParentToolUseIDEvent,
		ReplayedQueuedCommandValidated:                               streamResult.ReplayedQueuedCommandValidated,
		ReplayedQueuedCommandEvent:                                   streamResult.ReplayedQueuedCommandEvent,
		ReplayedQueuedCommandSyntheticValidated:                      streamResult.ReplayedQueuedCommandSyntheticValidated,
		ReplayedQueuedCommandSyntheticEvent:                          streamResult.ReplayedQueuedCommandSyntheticEvent,
		ReplayedQueuedCommandTimestampValidated:                      streamResult.ReplayedQueuedCommandTimestampValidated,
		ReplayedQueuedCommandTimestampEvent:                          streamResult.ReplayedQueuedCommandTimestampEvent,
		ReplayedQueuedCommandParentToolUseIDValidated:                streamResult.ReplayedQueuedCommandParentToolUseIDValidated,
		ReplayedQueuedCommandParentToolUseIDEvent:                    streamResult.ReplayedQueuedCommandParentToolUseIDEvent,
		ReplayedToolResultValidated:                                  streamResult.ReplayedToolResultValidated,
		ReplayedToolResultEvent:                                      streamResult.ReplayedToolResultEvent,
		ReplayedToolResultSyntheticValidated:                         streamResult.ReplayedToolResultSyntheticValidated,
		ReplayedToolResultSyntheticEvent:                             streamResult.ReplayedToolResultSyntheticEvent,
		ReplayedToolResultTimestampValidated:                         streamResult.ReplayedToolResultTimestampValidated,
		ReplayedToolResultTimestampEvent:                             streamResult.ReplayedToolResultTimestampEvent,
		ReplayedToolResultParentToolUseIDValidated:                   streamResult.ReplayedToolResultParentToolUseIDValidated,
		ReplayedToolResultParentToolUseIDEvent:                       streamResult.ReplayedToolResultParentToolUseIDEvent,
		ReplayedAssistantMessageValidated:                            streamResult.ReplayedAssistantMessageValidated,
		ReplayedAssistantMessageEvent:                                streamResult.ReplayedAssistantMessageEvent,
		ReplayedCompactBoundaryValidated:                             streamResult.ReplayedCompactBoundaryValidated,
		ReplayedCompactBoundaryEvent:                                 streamResult.ReplayedCompactBoundaryEvent,
		ReplayedCompactBoundaryPreservedSegmentValidated:             streamResult.ReplayedCompactBoundaryPreservedSegmentValidated,
		ReplayedCompactBoundaryPreservedSegmentEvent:                 streamResult.ReplayedCompactBoundaryPreservedSegmentEvent,
		ReplayedLocalCommandBreadcrumbValidated:                      streamResult.ReplayedLocalCommandBreadcrumbValidated,
		ReplayedLocalCommandBreadcrumbEvent:                          streamResult.ReplayedLocalCommandBreadcrumbEvent,
		ReplayedLocalCommandBreadcrumbSyntheticValidated:             streamResult.ReplayedLocalCommandBreadcrumbSyntheticValidated,
		ReplayedLocalCommandBreadcrumbSyntheticEvent:                 streamResult.ReplayedLocalCommandBreadcrumbSyntheticEvent,
		ReplayedLocalCommandBreadcrumbTimestampValidated:             streamResult.ReplayedLocalCommandBreadcrumbTimestampValidated,
		ReplayedLocalCommandBreadcrumbTimestampEvent:                 streamResult.ReplayedLocalCommandBreadcrumbTimestampEvent,
		ReplayedLocalCommandBreadcrumbParentToolUseIDValidated:       streamResult.ReplayedLocalCommandBreadcrumbParentToolUseIDValidated,
		ReplayedLocalCommandBreadcrumbParentToolUseIDEvent:           streamResult.ReplayedLocalCommandBreadcrumbParentToolUseIDEvent,
		ReplayedLocalCommandStderrBreadcrumbValidated:                streamResult.ReplayedLocalCommandStderrBreadcrumbValidated,
		ReplayedLocalCommandStderrBreadcrumbEvent:                    streamResult.ReplayedLocalCommandStderrBreadcrumbEvent,
		ReplayedLocalCommandStderrBreadcrumbSyntheticValidated:       streamResult.ReplayedLocalCommandStderrBreadcrumbSyntheticValidated,
		ReplayedLocalCommandStderrBreadcrumbSyntheticEvent:           streamResult.ReplayedLocalCommandStderrBreadcrumbSyntheticEvent,
		ReplayedLocalCommandStderrBreadcrumbTimestampValidated:       streamResult.ReplayedLocalCommandStderrBreadcrumbTimestampValidated,
		ReplayedLocalCommandStderrBreadcrumbTimestampEvent:           streamResult.ReplayedLocalCommandStderrBreadcrumbTimestampEvent,
		ReplayedLocalCommandStderrBreadcrumbParentToolUseIDValidated: streamResult.ReplayedLocalCommandStderrBreadcrumbParentToolUseIDValidated,
		ReplayedLocalCommandStderrBreadcrumbParentToolUseIDEvent:     streamResult.ReplayedLocalCommandStderrBreadcrumbParentToolUseIDEvent,
		AuthValidated:                                                streamResult.AuthValidated,
		AuthEvent:                                                    streamResult.AuthEvent,
		KeepAliveValidated:                                           streamResult.KeepAliveValidated,
		KeepAliveEvent:                                               streamResult.KeepAliveEvent,
		UpdateEnvironmentVariablesValidated:                          streamResult.UpdateEnvironmentVariablesValidated,
		UpdateEnvironmentVariablesEvent:                              streamResult.UpdateEnvironmentVariablesEvent,
		ControlCancelValidated:                                       streamResult.ControlCancelValidated,
		ControlCancelEvent:                                           streamResult.ControlCancelEvent,
		MessageValidated:                                             streamResult.MessageValidated,
		MessageEvent:                                                 streamResult.MessageEvent,
		ValidatedTurns:                                               streamResult.ValidatedTurns,
		MultiTurnValidated:                                           streamResult.MultiTurnValidated,
		ResultValidated:                                              streamResult.ResultValidated,
		ResultEvent:                                                  streamResult.ResultEvent,
		ResultStructuredOutputValidated:                              streamResult.ResultStructuredOutputValidated,
		ResultStructuredOutputEvent:                                  streamResult.ResultStructuredOutputEvent,
		ResultUsageValidated:                                         streamResult.ResultUsageValidated,
		ResultUsageEvent:                                             streamResult.ResultUsageEvent,
		ResultModelUsageValidated:                                    streamResult.ResultModelUsageValidated,
		ResultModelUsageEvent:                                        streamResult.ResultModelUsageEvent,
		ResultPermissionDenialsValidated:                             streamResult.ResultPermissionDenialsValidated,
		ResultPermissionDenialsEvent:                                 streamResult.ResultPermissionDenialsEvent,
		ResultFastModeStateValidated:                                 streamResult.ResultFastModeStateValidated,
		ResultFastModeStateEvent:                                     streamResult.ResultFastModeStateEvent,
		ResultErrorValidated:                                         streamResult.ResultErrorValidated,
		ResultErrorEvent:                                             streamResult.ResultErrorEvent,
		ResultErrorUsageValidated:                                    streamResult.ResultErrorUsageValidated,
		ResultErrorUsageEvent:                                        streamResult.ResultErrorUsageEvent,
		ResultErrorPermissionDenialsValidated:                        streamResult.ResultErrorPermissionDenialsValidated,
		ResultErrorPermissionDenialsEvent:                            streamResult.ResultErrorPermissionDenialsEvent,
		ResultErrorModelUsageValidated:                               streamResult.ResultErrorModelUsageValidated,
		ResultErrorModelUsageEvent:                                   streamResult.ResultErrorModelUsageEvent,
		ResultErrorFastModeStateValidated:                            streamResult.ResultErrorFastModeStateValidated,
		ResultErrorFastModeStateEvent:                                streamResult.ResultErrorFastModeStateEvent,
		ResultErrorMaxTurnsValidated:                                 streamResult.ResultErrorMaxTurnsValidated,
		ResultErrorMaxTurnsEvent:                                     streamResult.ResultErrorMaxTurnsEvent,
		ResultErrorMaxTurnsFastModeStateValidated:                    streamResult.ResultErrorMaxTurnsFastModeStateValidated,
		ResultErrorMaxTurnsFastModeStateEvent:                        streamResult.ResultErrorMaxTurnsFastModeStateEvent,
		ResultErrorMaxBudgetUSDValidated:                             streamResult.ResultErrorMaxBudgetUSDValidated,
		ResultErrorMaxBudgetUSDEvent:                                 streamResult.ResultErrorMaxBudgetUSDEvent,
		ResultErrorMaxBudgetUSDFastModeStateValidated:                streamResult.ResultErrorMaxBudgetUSDFastModeStateValidated,
		ResultErrorMaxBudgetUSDFastModeStateEvent:                    streamResult.ResultErrorMaxBudgetUSDFastModeStateEvent,
		ResultErrorMaxStructuredOutputRetriesValidated:               streamResult.ResultErrorMaxStructuredOutputRetriesValidated,
		ResultErrorMaxStructuredOutputRetriesEvent:                   streamResult.ResultErrorMaxStructuredOutputRetriesEvent,
		ResultErrorMaxStructuredOutputRetriesFastModeStateValidated:  streamResult.ResultErrorMaxStructuredOutputRetriesFastModeStateValidated,
		ResultErrorMaxStructuredOutputRetriesFastModeStateEvent:      streamResult.ResultErrorMaxStructuredOutputRetriesFastModeStateEvent,
		ControlValidated:                                             streamResult.ControlValidated,
		PermissionValidated:                                          streamResult.PermissionValidated,
		PermissionDeniedValidated:                                    streamResult.PermissionDeniedValidated,
		PermissionDeniedEvent:                                        streamResult.PermissionDeniedEvent,
		TaskStartedValidated:                                         streamResult.TaskStartedValidated,
		TaskStartedEvent:                                             streamResult.TaskStartedEvent,
		TaskProgressValidated:                                        streamResult.TaskProgressValidated,
		TaskProgressEvent:                                            streamResult.TaskProgressEvent,
		TaskNotificationValidated:                                    streamResult.TaskNotificationValidated,
		TaskNotificationEvent:                                        streamResult.TaskNotificationEvent,
		FilesPersistedValidated:                                      streamResult.FilesPersistedValidated,
		FilesPersistedEvent:                                          streamResult.FilesPersistedEvent,
		APIRetryValidated:                                            streamResult.APIRetryValidated,
		APIRetryEvent:                                                streamResult.APIRetryEvent,
		LocalCommandOutputValidated:                                  streamResult.LocalCommandOutputValidated,
		LocalCommandOutputEvent:                                      streamResult.LocalCommandOutputEvent,
		LocalCommandOutputAssistantValidated:                         streamResult.LocalCommandOutputAssistantValidated,
		LocalCommandOutputAssistantEvent:                             streamResult.LocalCommandOutputAssistantEvent,
		ElicitationValidated:                                         streamResult.ElicitationValidated,
		ElicitationEvent:                                             streamResult.ElicitationEvent,
		HookCallbackValidated:                                        streamResult.HookCallbackValidated,
		HookCallbackEvent:                                            streamResult.HookCallbackEvent,
		ChannelEnableValidated:                                       streamResult.ChannelEnableValidated,
		ChannelEnableEvent:                                           streamResult.ChannelEnableEvent,
		ElicitationCompleteValidated:                                 streamResult.ElicitationCompleteValidated,
		ElicitationCompleteEvent:                                     streamResult.ElicitationCompleteEvent,
		ToolProgressValidated:                                        streamResult.ToolProgressValidated,
		ToolProgressEvent:                                            streamResult.ToolProgressEvent,
		RateLimitValidated:                                           streamResult.RateLimitValidated,
		RateLimitEvent:                                               streamResult.RateLimitEvent,
		ToolUseSummaryValidated:                                      streamResult.ToolUseSummaryValidated,
		ToolUseSummaryEvent:                                          streamResult.ToolUseSummaryEvent,
		ToolUseSummaryShapeValidated:                                 streamResult.ToolUseSummaryShapeValidated,
		ToolUseSummaryShapeEvent:                                     streamResult.ToolUseSummaryShapeEvent,
		StreamlinedToolUseSummaryValidated:                           streamResult.StreamlinedToolUseSummaryValidated,
		StreamlinedToolUseSummaryEvent:                               streamResult.StreamlinedToolUseSummaryEvent,
		PromptSuggestionValidated:                                    streamResult.PromptSuggestionValidated,
		PromptSuggestionEvent:                                        streamResult.PromptSuggestionEvent,
		PostTurnSummaryValidated:                                     streamResult.PostTurnSummaryValidated,
		PostTurnSummaryEvent:                                         streamResult.PostTurnSummaryEvent,
		CompactBoundaryValidated:                                     streamResult.CompactBoundaryValidated,
		CompactBoundaryEvent:                                         streamResult.CompactBoundaryEvent,
		CompactBoundaryPreservedSegmentValidated:                     streamResult.CompactBoundaryPreservedSegmentValidated,
		CompactBoundaryPreservedSegmentEvent:                         streamResult.CompactBoundaryPreservedSegmentEvent,
		SessionStateChangedValidated:                                 streamResult.SessionStateChangedValidated,
		SessionStateChangedEvent:                                     streamResult.SessionStateChangedEvent,
		SessionStateRequiresActionValidated:                          streamResult.SessionStateRequiresActionValidated,
		SessionStateRequiresActionEvent:                              streamResult.SessionStateRequiresActionEvent,
		HookStartedValidated:                                         streamResult.HookStartedValidated,
		HookStartedEvent:                                             streamResult.HookStartedEvent,
		HookProgressValidated:                                        streamResult.HookProgressValidated,
		HookProgressEvent:                                            streamResult.HookProgressEvent,
		HookResponseValidated:                                        streamResult.HookResponseValidated,
		HookResponseEvent:                                            streamResult.HookResponseEvent,
		ToolExecutionValidated:                                       streamResult.ToolExecutionValidated,
		InterruptValidated:                                           streamResult.InterruptValidated,
		SetModelValidated:                                            streamResult.SetModelValidated,
		SetModelEvent:                                                streamResult.SetModelEvent,
		SetPermissionModeValidated:                                   streamResult.SetPermissionModeValidated,
		SetPermissionModeEvent:                                       streamResult.SetPermissionModeEvent,
		SetMaxThinkingTokensValidated:                                streamResult.SetMaxThinkingTokensValidated,
		SetMaxThinkingTokensEvent:                                    streamResult.SetMaxThinkingTokensEvent,
		MCPStatusValidated:                                           streamResult.MCPStatusValidated,
		MCPStatusEvent:                                               streamResult.MCPStatusEvent,
		GetContextUsageValidated:                                     streamResult.GetContextUsageValidated,
		GetContextUsageEvent:                                         streamResult.GetContextUsageEvent,
		MCPMessageValidated:                                          streamResult.MCPMessageValidated,
		MCPMessageEvent:                                              streamResult.MCPMessageEvent,
		MCPSetServersValidated:                                       streamResult.MCPSetServersValidated,
		MCPSetServersEvent:                                           streamResult.MCPSetServersEvent,
		ReloadPluginsValidated:                                       streamResult.ReloadPluginsValidated,
		ReloadPluginsEvent:                                           streamResult.ReloadPluginsEvent,
		MCPAuthenticateValidated:                                     streamResult.MCPAuthenticateValidated,
		MCPAuthenticateEvent:                                         streamResult.MCPAuthenticateEvent,
		MCPOAuthCallbackURLValidated:                                 streamResult.MCPOAuthCallbackURLValidated,
		MCPOAuthCallbackURLEvent:                                     streamResult.MCPOAuthCallbackURLEvent,
		MCPReconnectValidated:                                        streamResult.MCPReconnectValidated,
		MCPReconnectEvent:                                            streamResult.MCPReconnectEvent,
		MCPToggleValidated:                                           streamResult.MCPToggleValidated,
		MCPToggleEvent:                                               streamResult.MCPToggleEvent,
		SeedReadStateValidated:                                       streamResult.SeedReadStateValidated,
		SeedReadStateEvent:                                           streamResult.SeedReadStateEvent,
		RewindFilesValidated:                                         streamResult.RewindFilesValidated,
		RewindFilesEvent:                                             streamResult.RewindFilesEvent,
		RewindFilesCanRewind:                                         streamResult.RewindFilesCanRewind,
		RewindFilesFilesChanged:                                      streamResult.RewindFilesFilesChanged,
		RewindFilesInsertions:                                        streamResult.RewindFilesInsertions,
		RewindFilesDeletions:                                         streamResult.RewindFilesDeletions,
		RewindFilesError:                                             streamResult.RewindFilesError,
		CancelAsyncMessageValidated:                                  streamResult.CancelAsyncMessageValidated,
		CancelAsyncMessageEvent:                                      streamResult.CancelAsyncMessageEvent,
		StopTaskValidated:                                            streamResult.StopTaskValidated,
		StopTaskEvent:                                                streamResult.StopTaskEvent,
		ApplyFlagSettingsValidated:                                   streamResult.ApplyFlagSettingsValidated,
		ApplyFlagSettingsEvent:                                       streamResult.ApplyFlagSettingsEvent,
		GetSettingsValidated:                                         streamResult.GetSettingsValidated,
		GetSettingsEvent:                                             streamResult.GetSettingsEvent,
		GenerateSessionTitleValidated:                                streamResult.GenerateSessionTitleValidated,
		GenerateSessionTitleEvent:                                    streamResult.GenerateSessionTitleEvent,
		SideQuestionValidated:                                        streamResult.SideQuestionValidated,
		SideQuestionEvent:                                            streamResult.SideQuestionEvent,
		InitializeValidated:                                          streamResult.InitializeValidated,
		InitializeEvent:                                              streamResult.InitializeEvent,
		SetProactiveValidated:                                        streamResult.SetProactiveValidated,
		SetProactiveEvent:                                            streamResult.SetProactiveEvent,
		BridgeStateValidated:                                         streamResult.BridgeStateValidated,
		BridgeStateEvent:                                             streamResult.BridgeStateEvent,
		RemoteControlValidated:                                       streamResult.RemoteControlValidated,
		RemoteControlEvent:                                           streamResult.RemoteControlEvent,
		EndSessionValidated:                                          streamResult.EndSessionValidated,
		EndSessionEvent:                                              streamResult.EndSessionEvent,
		BackendValidated:                                             state.BackendPID > 0 && strings.TrimSpace(state.BackendStatus) == "running",
		BackendStatus:                                                state.BackendStatus,
		BackendPID:                                                   state.BackendPID,
		BackendStartedAt:                                             state.BackendStartedAt,
		BackendStoppedAt:                                             state.BackendStoppedAt,
		BackendExitCode:                                              state.BackendExitCode,
	}, nil
}

type sessionResponse struct {
	SessionID string `json:"session_id"`
	WSURL     string `json:"ws_url"`
	WorkDir   string `json:"work_dir"`
}

type sessionStateResponse struct {
	SessionID        string `json:"session_id"`
	WorkDir          string `json:"work_dir,omitempty"`
	Status           string `json:"status,omitempty"`
	BackendStatus    string `json:"backend_status,omitempty"`
	BackendPID       int    `json:"backend_pid,omitempty"`
	BackendStartedAt int64  `json:"backend_started_at,omitempty"`
	BackendStoppedAt int64  `json:"backend_stopped_at,omitempty"`
	BackendExitCode  int    `json:"backend_exit_code,omitempty"`
}

func parseArgs(args []string) (Options, error) {
	opts := Options{OutputFormat: "text"}

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "-p", "--print":
			opts.PrintMode = true
			if i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
				opts.PrintPrompt = args[i+1]
				i++
			}
		case "--output-format":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--output-format requires a value")
			}
			opts.OutputFormat = strings.TrimSpace(args[i+1])
			i++
		case "--resume-session":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--resume-session requires a value")
			}
			opts.ResumeSessionID = strings.TrimSpace(args[i+1])
			i++
		case "--stop-session":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("--stop-session requires a value")
			}
			opts.StopSessionID = strings.TrimSpace(args[i+1])
			i++
		default:
			if strings.HasPrefix(args[i], "--") {
				return opts, fmt.Errorf("unknown option: %s", args[i])
			}
			if opts.ConnectURL != "" {
				return opts, fmt.Errorf("usage: claude-code-go open <cc-url> [-p|--print [prompt]] [--output-format <format>] [--resume-session <sessionId>] [--stop-session <sessionId>]")
			}
			opts.ConnectURL = args[i]
		}
	}

	if strings.TrimSpace(opts.ConnectURL) == "" {
		return opts, fmt.Errorf("usage: claude-code-go open <cc-url> [-p|--print [prompt]] [--output-format <format>] [--resume-session <sessionId>] [--stop-session <sessionId>]")
	}
	if opts.OutputFormat == "" {
		return opts, fmt.Errorf("--output-format requires a value")
	}
	if opts.ResumeSessionID == "" && hasFlag(args, "--resume-session") {
		return opts, fmt.Errorf("--resume-session requires a value")
	}
	if opts.StopSessionID == "" && hasFlag(args, "--stop-session") {
		return opts, fmt.Errorf("--stop-session requires a value")
	}
	if opts.ResumeSessionID != "" && opts.StopSessionID != "" {
		return opts, fmt.Errorf("--resume-session and --stop-session cannot be used together")
	}
	if opts.StopSessionID != "" && opts.PrintMode {
		return opts, fmt.Errorf("--stop-session cannot be combined with --print")
	}

	return opts, nil
}

func parseConnectURL(raw string) (serverURL string, transport string, authToken string, err error) {
	if strings.HasPrefix(raw, "cc+unix://") {
		rest := strings.TrimPrefix(raw, "cc+unix://")
		socketPart, queryPart, _ := strings.Cut(rest, "?")
		socketPart = strings.TrimSpace(socketPart)
		socketPart, err = url.PathUnescape(socketPart)
		if err != nil {
			return "", "", "", fmt.Errorf("invalid cc-url: decode unix socket path: %w", err)
		}
		if socketPart == "" {
			return "", "", "", fmt.Errorf("invalid cc-url: missing unix socket path")
		}
		if !strings.HasPrefix(socketPart, "/") {
			socketPart = "/" + socketPart
		}
		values, err := url.ParseQuery(queryPart)
		if err != nil {
			return "", "", "", fmt.Errorf("invalid cc-url query: %w", err)
		}
		return "unix:" + socketPart, "unix", firstNonEmpty(
			values.Get("authToken"),
			values.Get("auth_token"),
			values.Get("token"),
		), nil
	}

	u, err := url.Parse(raw)
	if err != nil {
		return "", "", "", fmt.Errorf("invalid cc-url: %w", err)
	}

	switch u.Scheme {
	case "cc":
		host := strings.TrimSpace(u.Host)
		if host == "" {
			return "", "", "", fmt.Errorf("invalid cc-url: missing host")
		}
		serverURL = "http://" + host
		if path := strings.TrimSpace(u.EscapedPath()); path != "" && path != "/" {
			serverURL += path
		}
		transport = "http"
	default:
		return "", "", "", fmt.Errorf("invalid cc-url: unsupported scheme %q", u.Scheme)
	}

	query := u.Query()
	authToken = firstNonEmpty(
		query.Get("authToken"),
		query.Get("auth_token"),
		query.Get("token"),
	)
	return serverURL, transport, authToken, nil
}

func createOrResumeSession(serverURL, transport, authToken, cwd, resumeSessionID string) (sessionResponse, error) {
	if strings.TrimSpace(resumeSessionID) != "" {
		return resumeSession(serverURL, transport, authToken, resumeSessionID)
	}
	return createSession(serverURL, transport, authToken, cwd)
}

func createSession(serverURL, transport, authToken, cwd string) (sessionResponse, error) {
	payload, err := json.Marshal(map[string]string{"cwd": cwd})
	if err != nil {
		return sessionResponse{}, fmt.Errorf("marshal session request: %w", err)
	}

	client, endpoint, err := buildClient(serverURL, transport)
	if err != nil {
		return sessionResponse{}, err
	}

	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return sessionResponse{}, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(authToken) != "" {
		req.Header.Set("Authorization", "Bearer "+authToken)
	}

	resp, err := client.Do(req)
	if err != nil {
		return sessionResponse{}, fmt.Errorf("create direct-connect session: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return sessionResponse{}, responseError("create direct-connect session", resp)
	}

	var parsed sessionResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return sessionResponse{}, fmt.Errorf("decode session response: %w", err)
	}
	if strings.TrimSpace(parsed.SessionID) == "" || strings.TrimSpace(parsed.WSURL) == "" {
		return sessionResponse{}, fmt.Errorf("invalid session response: missing session_id or ws_url")
	}
	return parsed, nil
}

func resumeSession(serverURL, transport, authToken, sessionID string) (sessionResponse, error) {
	client, endpoint, err := buildClient(serverURL, transport)
	if err != nil {
		return sessionResponse{}, err
	}
	req, err := http.NewRequest(http.MethodGet, endpoint+"?resume="+url.QueryEscape(sessionID), nil)
	if err != nil {
		return sessionResponse{}, fmt.Errorf("build resume request: %w", err)
	}
	if strings.TrimSpace(authToken) != "" {
		req.Header.Set("Authorization", "Bearer "+authToken)
	}
	resp, err := client.Do(req)
	if err != nil {
		return sessionResponse{}, fmt.Errorf("resume direct-connect session: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return sessionResponse{}, responseError("resume direct-connect session", resp)
	}
	var parsed sessionResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return sessionResponse{}, fmt.Errorf("decode resume session response: %w", err)
	}
	if strings.TrimSpace(parsed.SessionID) == "" || strings.TrimSpace(parsed.WSURL) == "" {
		return sessionResponse{}, fmt.Errorf("invalid resume session response: missing session_id or ws_url")
	}
	return parsed, nil
}

func buildClient(serverURL, transport string) (*http.Client, string, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	switch transport {
	case "http":
		return client, strings.TrimRight(serverURL, "/") + "/sessions", nil
	case "unix":
		socketPath := strings.TrimPrefix(serverURL, "unix:")
		client.Transport = &http.Transport{
			DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
		}
		return client, "http://unix/sessions", nil
	default:
		return nil, "", fmt.Errorf("unsupported transport: %s", transport)
	}
}

func responseError(prefix string, resp *http.Response) error {
	if resp == nil {
		return fmt.Errorf("%s: unknown response", prefix)
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	message := strings.TrimSpace(string(body))
	if message == "" {
		return fmt.Errorf("%s: %s", prefix, resp.Status)
	}
	return fmt.Errorf("%s: %s: %s", prefix, resp.Status, message)
}

func inspectSession(serverURL, transport, authToken, sessionID string) (sessionStateResponse, error) {
	client, endpoint, err := buildClient(serverURL, transport)
	if err != nil {
		return sessionStateResponse{}, err
	}
	stateURL := strings.TrimRight(endpoint, "/") + "/" + url.PathEscape(sessionID)
	req, err := http.NewRequest(http.MethodGet, stateURL, nil)
	if err != nil {
		return sessionStateResponse{}, fmt.Errorf("build inspect request: %w", err)
	}
	if strings.TrimSpace(authToken) != "" {
		req.Header.Set("Authorization", "Bearer "+authToken)
	}
	resp, err := client.Do(req)
	if err != nil {
		return sessionStateResponse{}, fmt.Errorf("inspect direct-connect session: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return sessionStateResponse{}, responseError("inspect direct-connect session", resp)
	}
	var parsed sessionStateResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return sessionStateResponse{}, fmt.Errorf("decode inspect session response: %w", err)
	}
	return parsed, nil
}

func stopSession(serverURL, transport, authToken, sessionID string) (sessionStateResponse, error) {
	client, endpoint, err := buildClient(serverURL, transport)
	if err != nil {
		return sessionStateResponse{}, err
	}
	stopURL := strings.TrimRight(endpoint, "/") + "/" + url.PathEscape(sessionID)
	req, err := http.NewRequest(http.MethodDelete, stopURL, nil)
	if err != nil {
		return sessionStateResponse{}, fmt.Errorf("build stop request: %w", err)
	}
	if strings.TrimSpace(authToken) != "" {
		req.Header.Set("Authorization", "Bearer "+authToken)
	}
	resp, err := client.Do(req)
	if err != nil {
		return sessionStateResponse{}, fmt.Errorf("stop direct-connect session: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return sessionStateResponse{}, responseError("stop direct-connect session", resp)
	}
	var parsed sessionStateResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return sessionStateResponse{}, fmt.Errorf("decode stop session response: %w", err)
	}
	return parsed, nil
}

type streamValidation struct {
	StreamEvent                                                  string
	StreamContentValidated                                       bool
	StreamContentEvent                                           string
	ThinkingDeltaValidated                                       bool
	ThinkingDeltaEvent                                           string
	ThinkingSignatureValidated                                   bool
	ThinkingSignatureEvent                                       string
	ToolUseDeltaValidated                                        bool
	ToolUseDeltaEvent                                            string
	ToolUseBlockStartValidated                                   bool
	ToolUseBlockStartEvent                                       string
	ToolUseBlockStopValidated                                    bool
	ToolUseBlockStopEvent                                        string
	AssistantMessageStartValidated                               bool
	AssistantMessageStartEvent                                   string
	AssistantMessageDeltaValidated                               bool
	AssistantMessageDeltaEvent                                   string
	AssistantMessageStopValidated                                bool
	AssistantMessageStopEvent                                    string
	AssistantThinkingValidated                                   bool
	AssistantThinkingEvent                                       string
	AssistantToolUseValidated                                    bool
	AssistantToolUseEvent                                        string
	AssistantStopReasonValidated                                 bool
	AssistantStopReasonEvent                                     string
	AssistantUsageValidated                                      bool
	AssistantUsageEvent                                          string
	StructuredOutputAttachmentValidated                          bool
	StructuredOutputAttachmentEvent                              string
	MaxTurnsReachedAttachmentValidated                           bool
	MaxTurnsReachedAttachmentEvent                               string
	TaskStatusAttachmentValidated                                bool
	TaskStatusAttachmentEvent                                    string
	QueuedCommandValidated                                       bool
	QueuedCommandEvent                                           string
	TaskReminderAttachmentValidated                              bool
	TaskReminderAttachmentEvent                                  string
	TodoReminderAttachmentValidated                              bool
	TodoReminderAttachmentEvent                                  string
	CompactionReminderValidated                                  bool
	CompactionReminderEvent                                      string
	ContextEfficiencyValidated                                   bool
	ContextEfficiencyEvent                                       string
	AutoModeExitValidated                                        bool
	AutoModeExitEvent                                            string
	PlanModeValidated                                            bool
	PlanModeEvent                                                string
	PlanModeExitValidated                                        bool
	PlanModeExitEvent                                            string
	PlanModeReentryValidated                                     bool
	PlanModeReentryEvent                                         string
	DateChangeValidated                                          bool
	DateChangeEvent                                              string
	UltrathinkEffortValidated                                    bool
	UltrathinkEffortEvent                                        string
	DeferredToolsDeltaValidated                                  bool
	DeferredToolsDeltaEvent                                      string
	AgentListingDeltaValidated                                   bool
	AgentListingDeltaEvent                                       string
	MCPInstructionsDeltaValidated                                bool
	MCPInstructionsDeltaEvent                                    string
	CompanionIntroValidated                                      bool
	CompanionIntroEvent                                          string
	TokenUsageValidated                                          bool
	TokenUsageEvent                                              string
	OutputTokenUsageValidated                                    bool
	OutputTokenUsageEvent                                        string
	VerifyPlanReminderValidated                                  bool
	VerifyPlanReminderEvent                                      string
	StreamlinedTextValidated                                     bool
	StreamlinedTextEvent                                         string
	SystemValidated                                              bool
	SystemEvent                                                  string
	StatusValidated                                              bool
	StatusEvent                                                  string
	StatusTransitionValidated                                    bool
	StatusTransitionEvent                                        string
	StatusCompactingLifecycleValidated                           bool
	StatusCompactingLifecycleEvent                               string
	CompactSummaryValidated                                      bool
	CompactSummaryEvent                                          string
	CompactSummarySyntheticValidated                             bool
	CompactSummarySyntheticEvent                                 string
	CompactSummaryTimestampValidated                             bool
	CompactSummaryTimestampEvent                                 string
	CompactSummaryParentToolUseIDValidated                       bool
	CompactSummaryParentToolUseIDEvent                           string
	AckedInitialUserReplayValidated                              bool
	AckedInitialUserReplayEvent                                  string
	ReplayedUserMessageValidated                                 bool
	ReplayedUserMessageEvent                                     string
	ReplayedUserSyntheticValidated                               bool
	ReplayedUserSyntheticEvent                                   string
	ReplayedUserTimestampValidated                               bool
	ReplayedUserTimestampEvent                                   string
	ReplayedUserParentToolUseIDValidated                         bool
	ReplayedUserParentToolUseIDEvent                             string
	ReplayedQueuedCommandValidated                               bool
	ReplayedQueuedCommandEvent                                   string
	ReplayedQueuedCommandSyntheticValidated                      bool
	ReplayedQueuedCommandSyntheticEvent                          string
	ReplayedQueuedCommandTimestampValidated                      bool
	ReplayedQueuedCommandTimestampEvent                          string
	ReplayedQueuedCommandParentToolUseIDValidated                bool
	ReplayedQueuedCommandParentToolUseIDEvent                    string
	ReplayedToolResultValidated                                  bool
	ReplayedToolResultEvent                                      string
	ReplayedToolResultSyntheticValidated                         bool
	ReplayedToolResultSyntheticEvent                             string
	ReplayedToolResultTimestampValidated                         bool
	ReplayedToolResultTimestampEvent                             string
	ReplayedToolResultParentToolUseIDValidated                   bool
	ReplayedToolResultParentToolUseIDEvent                       string
	ReplayedAssistantMessageValidated                            bool
	ReplayedAssistantMessageEvent                                string
	ReplayedCompactBoundaryValidated                             bool
	ReplayedCompactBoundaryEvent                                 string
	ReplayedCompactBoundaryPreservedSegmentValidated             bool
	ReplayedCompactBoundaryPreservedSegmentEvent                 string
	ReplayedLocalCommandBreadcrumbValidated                      bool
	ReplayedLocalCommandBreadcrumbEvent                          string
	ReplayedLocalCommandBreadcrumbSyntheticValidated             bool
	ReplayedLocalCommandBreadcrumbSyntheticEvent                 string
	ReplayedLocalCommandBreadcrumbTimestampValidated             bool
	ReplayedLocalCommandBreadcrumbTimestampEvent                 string
	ReplayedLocalCommandBreadcrumbParentToolUseIDValidated       bool
	ReplayedLocalCommandBreadcrumbParentToolUseIDEvent           string
	ReplayedLocalCommandStderrBreadcrumbValidated                bool
	ReplayedLocalCommandStderrBreadcrumbEvent                    string
	ReplayedLocalCommandStderrBreadcrumbSyntheticValidated       bool
	ReplayedLocalCommandStderrBreadcrumbSyntheticEvent           string
	ReplayedLocalCommandStderrBreadcrumbTimestampValidated       bool
	ReplayedLocalCommandStderrBreadcrumbTimestampEvent           string
	ReplayedLocalCommandStderrBreadcrumbParentToolUseIDValidated bool
	ReplayedLocalCommandStderrBreadcrumbParentToolUseIDEvent     string
	AuthValidated                                                bool
	AuthEvent                                                    string
	KeepAliveValidated                                           bool
	KeepAliveEvent                                               string
	UpdateEnvironmentVariablesValidated                          bool
	UpdateEnvironmentVariablesEvent                              string
	ControlCancelValidated                                       bool
	ControlCancelEvent                                           string
	MessageValidated                                             bool
	MessageEvent                                                 string
	ValidatedTurns                                               int
	MultiTurnValidated                                           bool
	ResultValidated                                              bool
	ResultEvent                                                  string
	ResultStructuredOutputValidated                              bool
	ResultStructuredOutputEvent                                  string
	ResultUsageValidated                                         bool
	ResultUsageEvent                                             string
	ResultModelUsageValidated                                    bool
	ResultModelUsageEvent                                        string
	ResultPermissionDenialsValidated                             bool
	ResultPermissionDenialsEvent                                 string
	ResultFastModeStateValidated                                 bool
	ResultFastModeStateEvent                                     string
	ResultErrorValidated                                         bool
	ResultErrorEvent                                             string
	ResultErrorUsageValidated                                    bool
	ResultErrorUsageEvent                                        string
	ResultErrorPermissionDenialsValidated                        bool
	ResultErrorPermissionDenialsEvent                            string
	ResultErrorModelUsageValidated                               bool
	ResultErrorModelUsageEvent                                   string
	ResultErrorFastModeStateValidated                            bool
	ResultErrorFastModeStateEvent                                string
	ResultErrorMaxTurnsValidated                                 bool
	ResultErrorMaxTurnsEvent                                     string
	ResultErrorMaxTurnsFastModeStateValidated                    bool
	ResultErrorMaxTurnsFastModeStateEvent                        string
	ResultErrorMaxBudgetUSDValidated                             bool
	ResultErrorMaxBudgetUSDEvent                                 string
	ResultErrorMaxBudgetUSDFastModeStateValidated                bool
	ResultErrorMaxBudgetUSDFastModeStateEvent                    string
	ResultErrorMaxStructuredOutputRetriesValidated               bool
	ResultErrorMaxStructuredOutputRetriesEvent                   string
	ResultErrorMaxStructuredOutputRetriesFastModeStateValidated  bool
	ResultErrorMaxStructuredOutputRetriesFastModeStateEvent      string
	ControlValidated                                             bool
	PermissionValidated                                          bool
	PermissionDeniedValidated                                    bool
	PermissionDeniedEvent                                        string
	TaskStartedValidated                                         bool
	TaskStartedEvent                                             string
	TaskProgressValidated                                        bool
	TaskProgressEvent                                            string
	TaskNotificationValidated                                    bool
	TaskNotificationEvent                                        string
	FilesPersistedValidated                                      bool
	FilesPersistedEvent                                          string
	APIRetryValidated                                            bool
	APIRetryEvent                                                string
	LocalCommandOutputValidated                                  bool
	LocalCommandOutputEvent                                      string
	LocalCommandOutputAssistantValidated                         bool
	LocalCommandOutputAssistantEvent                             string
	ElicitationValidated                                         bool
	ElicitationEvent                                             string
	HookCallbackValidated                                        bool
	HookCallbackEvent                                            string
	ChannelEnableValidated                                       bool
	ChannelEnableEvent                                           string
	ElicitationCompleteValidated                                 bool
	ElicitationCompleteEvent                                     string
	ToolProgressValidated                                        bool
	ToolProgressEvent                                            string
	RateLimitValidated                                           bool
	RateLimitEvent                                               string
	ToolUseSummaryValidated                                      bool
	ToolUseSummaryEvent                                          string
	ToolUseSummaryShapeValidated                                 bool
	ToolUseSummaryShapeEvent                                     string
	StreamlinedToolUseSummaryValidated                           bool
	StreamlinedToolUseSummaryEvent                               string
	PromptSuggestionValidated                                    bool
	PromptSuggestionEvent                                        string
	PostTurnSummaryValidated                                     bool
	PostTurnSummaryEvent                                         string
	CompactBoundaryValidated                                     bool
	CompactBoundaryEvent                                         string
	CompactBoundaryPreservedSegmentValidated                     bool
	CompactBoundaryPreservedSegmentEvent                         string
	SessionStateChangedValidated                                 bool
	SessionStateChangedEvent                                     string
	SessionStateRequiresActionValidated                          bool
	SessionStateRequiresActionEvent                              string
	HookStartedValidated                                         bool
	HookStartedEvent                                             string
	HookProgressValidated                                        bool
	HookProgressEvent                                            string
	HookResponseValidated                                        bool
	HookResponseEvent                                            string
	ToolExecutionValidated                                       bool
	InterruptValidated                                           bool
	SetModelValidated                                            bool
	SetModelEvent                                                string
	SetPermissionModeValidated                                   bool
	SetPermissionModeEvent                                       string
	SetMaxThinkingTokensValidated                                bool
	SetMaxThinkingTokensEvent                                    string
	MCPStatusValidated                                           bool
	MCPStatusEvent                                               string
	GetContextUsageValidated                                     bool
	GetContextUsageEvent                                         string
	MCPMessageValidated                                          bool
	MCPMessageEvent                                              string
	MCPSetServersValidated                                       bool
	MCPSetServersEvent                                           string
	ReloadPluginsValidated                                       bool
	ReloadPluginsEvent                                           string
	MCPAuthenticateValidated                                     bool
	MCPAuthenticateEvent                                         string
	MCPOAuthCallbackURLValidated                                 bool
	MCPOAuthCallbackURLEvent                                     string
	MCPReconnectValidated                                        bool
	MCPReconnectEvent                                            string
	MCPToggleValidated                                           bool
	MCPToggleEvent                                               string
	SeedReadStateValidated                                       bool
	SeedReadStateEvent                                           string
	RewindFilesValidated                                         bool
	RewindFilesEvent                                             string
	RewindFilesCanRewind                                         bool
	RewindFilesFilesChanged                                      int
	RewindFilesInsertions                                        int
	RewindFilesDeletions                                         int
	RewindFilesError                                             string
	CancelAsyncMessageValidated                                  bool
	CancelAsyncMessageEvent                                      string
	StopTaskValidated                                            bool
	StopTaskEvent                                                string
	ApplyFlagSettingsValidated                                   bool
	ApplyFlagSettingsEvent                                       string
	GetSettingsValidated                                         bool
	GetSettingsEvent                                             string
	GenerateSessionTitleValidated                                bool
	GenerateSessionTitleEvent                                    string
	SideQuestionValidated                                        bool
	SideQuestionEvent                                            string
	InitializeValidated                                          bool
	InitializeEvent                                              string
	SetProactiveValidated                                        bool
	SetProactiveEvent                                            string
	BridgeStateValidated                                         bool
	BridgeStateEvent                                             string
	RemoteControlValidated                                       bool
	RemoteControlEvent                                           string
	EndSessionValidated                                          bool
	EndSessionEvent                                              string
}

func validateStream(rawWSURL, authToken string, opts Options) (streamValidation, error) {
	dialURL, header, dialer, err := buildWebsocketDial(rawWSURL, authToken)
	if err != nil {
		return streamValidation{}, err
	}
	conn, _, err := dialer.Dial(dialURL, header)
	if err != nil {
		return streamValidation{}, fmt.Errorf("validate direct-connect stream: %w", err)
	}
	defer conn.Close()

	var event map[string]any
	if err := conn.ReadJSON(&event); err != nil {
		return streamValidation{}, fmt.Errorf("read direct-connect stream: %w", err)
	}
	typeName, _ := event["type"].(string)
	if strings.TrimSpace(typeName) == "" {
		return streamValidation{}, fmt.Errorf("invalid direct-connect stream event: missing type")
	}

	result := streamValidation{StreamEvent: typeName}
	if !opts.PrintMode {
		return result, nil
	}

	prompt := strings.TrimSpace(opts.PrintPrompt)
	if prompt == "" {
		prompt = "hello from claude-code-go"
	}
	if err := conn.WriteJSON(map[string]any{
		"type": "update_environment_variables",
		"variables": map[string]any{
			"DIRECT_CONNECT_DEMO": "1",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect update_environment_variables message: %w", err)
	}
	result.UpdateEnvironmentVariablesValidated = true
	result.UpdateEnvironmentVariablesEvent = "update_environment_variables"
	type validationTurn struct {
		prompt           string
		behavior         string
		approvedPrompt   string
		expectedResponse string
	}
	turns := []validationTurn{
		{
			prompt:           prompt,
			behavior:         "allow",
			approvedPrompt:   prompt + " [approved]",
			expectedResponse: "echo:" + prompt + " [approved]",
		},
		{
			prompt:           prompt + " [turn-2]",
			behavior:         "allow",
			approvedPrompt:   prompt + " [turn-2] [approved]",
			expectedResponse: "echo:" + prompt + " [turn-2] [approved]",
		},
		{
			prompt:   prompt + " [deny]",
			behavior: "deny",
		},
		{
			prompt:   prompt + " [max-turns]",
			behavior: "max_turns",
		},
		{
			prompt:   prompt + " [max-budget-usd]",
			behavior: "max_budget_usd",
		},
		{
			prompt:   prompt + " [max-structured-output-retries]",
			behavior: "max_structured_output_retries",
		},
	}
	for _, turn := range turns {
		currentToolUseID := ""
		currentRequestID := ""
		currentTaskID := ""
		currentTaskDescription := ""
		currentTaskOutputFile := ""
		if err := conn.WriteJSON(map[string]any{
			"type": "user",
			"message": map[string]any{
				"role": "user",
				"content": []map[string]any{
					{
						"type": "text",
						"text": turn.prompt,
					},
				},
			},
			"parent_tool_use_id": nil,
			"session_id":         "",
		}); err != nil {
			return streamValidation{}, fmt.Errorf("write direct-connect user message: %w", err)
		}

		assistantValidated := false
		resultValidated := false
		taskStartedValidated := false
		taskProgressValidated := false
		taskNotificationValidated := false
		queuedCommandValidated := false
		filesPersistedValidated := false
		apiRetryValidated := false
		localCommandOutputValidated := false
		elicitationCompleteValidated := false
		postTurnSummaryValidated := false
		compactBoundaryValidated := false
		statusCompactingValidated := false
		statusClearedValidated := false
		sessionStateRunningValidated := false
		sessionStateRequiresActionValidated := false
		sessionStateIdleValidated := false
		hookStartedValidated := false
		hookProgressValidated := false
		hookResponseValidated := false
		thinkingDeltaValidated := false
		thinkingSignatureValidated := false
		toolUseDeltaValidated := false
		toolUseBlockStartValidated := false
		toolUseBlockStopValidated := false
		assistantMessageStartValidated := false
		assistantMessageDeltaValidated := false
		assistantMessageStopValidated := false
		assistantThinkingValidated := false
		assistantToolUseValidated := false
		assistantStopReasonValidated := false
		assistantUsageValidated := false
		structuredOutputAttachmentValidated := false
		maxTurnsReachedAttachmentValidated := false
		taskReminderAttachmentValidated := false
		compactionReminderValidated := false
		contextEfficiencyValidated := false
		autoModeExitValidated := false
		planModeValidated := false
		planModeExitValidated := false
		planModeReentryValidated := false
		dateChangeValidated := false
		ultrathinkEffortValidated := false
		deferredToolsDeltaValidated := false
		agentListingDeltaValidated := false
		mcpInstructionsDeltaValidated := false
		companionIntroValidated := false
		tokenUsageValidated := false
		outputTokenUsageValidated := false
		verifyPlanReminderValidated := false
		streamlinedTextValidated := false
		streamlinedToolUseSummaryValidated := false
		promptSuggestionValidated := false
		for {
			var incoming map[string]any
			if err := conn.ReadJSON(&incoming); err != nil {
				return streamValidation{}, fmt.Errorf("read direct-connect message flow: %w", err)
			}

			switch strings.TrimSpace(asString(incoming["type"])) {
			case "user":
				if strings.TrimSpace(asString(incoming["uuid"])) == "" {
					return streamValidation{}, fmt.Errorf("invalid user event: missing uuid")
				}
				if strings.TrimSpace(asString(incoming["session_id"])) == "" {
					return streamValidation{}, fmt.Errorf("invalid user event: missing session_id")
				}
				message, _ := incoming["message"].(map[string]any)
				if strings.TrimSpace(asString(message["role"])) != "user" {
					return streamValidation{}, fmt.Errorf("invalid user event: missing role=user")
				}
				replayed, ok := incoming["isReplay"].(bool)
				if !ok {
					return streamValidation{}, fmt.Errorf("invalid user event: missing isReplay")
				}
				if !replayed {
					synthetic, ok := incoming["isSynthetic"].(bool)
					if !ok {
						return streamValidation{}, fmt.Errorf("invalid user event: missing isSynthetic")
					}
					contentText, ok := message["content"].(string)
					if !ok || strings.TrimSpace(contentText) == "" {
						return streamValidation{}, fmt.Errorf("invalid compact summary user message: missing content")
					}
					if strings.TrimSpace(asString(incoming["timestamp"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid compact summary user message: missing timestamp")
					}
					if !synthetic {
						return streamValidation{}, fmt.Errorf("invalid compact summary user message: expected isSynthetic=true")
					}
					if err := validateParentToolUseIDNull(incoming, "invalid compact summary user message"); err != nil {
						return streamValidation{}, err
					}
					result.CompactSummaryValidated = true
					result.CompactSummaryEvent = "user:compact_summary"
					result.CompactSummarySyntheticValidated = true
					result.CompactSummarySyntheticEvent = "user:compact_summary:isSynthetic"
					result.CompactSummaryTimestampValidated = true
					result.CompactSummaryTimestampEvent = "user:compact_summary:timestamp"
					result.CompactSummaryParentToolUseIDValidated = true
					result.CompactSummaryParentToolUseIDEvent = "user:compact_summary:parent_tool_use_id"
					continue
				}
				replayedPrompt := extractPromptText(map[string]any{"message": message})
				if strings.TrimSpace(opts.ResumeSessionID) == "" && !result.AckedInitialUserReplayValidated && replayedPrompt == turn.prompt {
					if strings.TrimSpace(asString(incoming["timestamp"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid initial user ack replay: missing timestamp")
					}
					if isSynthetic, ok := incoming["isSynthetic"].(bool); ok && isSynthetic {
						return streamValidation{}, fmt.Errorf("invalid initial user ack replay: expected isSynthetic to be absent or false")
					}
					if err := validateParentToolUseIDNull(incoming, "invalid initial user ack replay"); err != nil {
						return streamValidation{}, err
					}
					result.AckedInitialUserReplayValidated = true
					result.AckedInitialUserReplayEvent = "user:initial_ack:isReplay"
					continue
				}
				synthetic, ok := incoming["isSynthetic"].(bool)
				if !ok {
					return streamValidation{}, fmt.Errorf("invalid user replay event: missing isSynthetic")
				}
				attachment, _ := message["attachment"].(map[string]any)
				if strings.TrimSpace(asString(attachment["type"])) == "queued_command" {
					attachmentPrompt := extractPromptText(map[string]any{
						"message": map[string]any{
							"content": attachment["prompt"],
						},
					})
					replayedAttachmentPrompt := firstNonEmpty(attachmentPrompt, replayedPrompt)
					if replayedAttachmentPrompt == "" {
						return streamValidation{}, fmt.Errorf("invalid replayed queued_command: missing prompt")
					}
					if strings.TrimSpace(asString(incoming["timestamp"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid replayed queued_command: missing timestamp")
					}
					if !synthetic {
						return streamValidation{}, fmt.Errorf("invalid replayed queued_command: expected isSynthetic=true")
					}
					if err := validateParentToolUseIDNull(incoming, "invalid replayed queued_command"); err != nil {
						return streamValidation{}, err
					}
					result.ReplayedQueuedCommandValidated = true
					result.ReplayedQueuedCommandEvent = "user:queued_command:isReplay"
					result.ReplayedQueuedCommandSyntheticValidated = true
					result.ReplayedQueuedCommandSyntheticEvent = "user:queued_command:isReplay:isSynthetic"
					result.ReplayedQueuedCommandTimestampValidated = true
					result.ReplayedQueuedCommandTimestampEvent = "user:queued_command:isReplay:timestamp"
					result.ReplayedQueuedCommandParentToolUseIDValidated = true
					result.ReplayedQueuedCommandParentToolUseIDEvent = "user:queued_command:isReplay:parent_tool_use_id"
					continue
				}
				if strings.TrimSpace(opts.ResumeSessionID) != "" {
					if contentText, ok := message["content"].(string); ok {
						if !result.ReplayedLocalCommandBreadcrumbValidated && strings.Contains(contentText, "<local-command-stdout>") {
							if strings.TrimSpace(asString(incoming["timestamp"])) == "" {
								return streamValidation{}, fmt.Errorf("invalid replayed local-command breadcrumb: missing timestamp")
							}
							if !synthetic {
								return streamValidation{}, fmt.Errorf("invalid replayed local-command breadcrumb: expected isSynthetic=true")
							}
							if err := validateParentToolUseIDNull(incoming, "invalid replayed local-command breadcrumb"); err != nil {
								return streamValidation{}, err
							}
							result.ReplayedLocalCommandBreadcrumbValidated = true
							result.ReplayedLocalCommandBreadcrumbEvent = "user:local_command_stdout:isReplay"
							result.ReplayedLocalCommandBreadcrumbSyntheticValidated = true
							result.ReplayedLocalCommandBreadcrumbSyntheticEvent = "user:local_command_stdout:isReplay:isSynthetic"
							result.ReplayedLocalCommandBreadcrumbTimestampValidated = true
							result.ReplayedLocalCommandBreadcrumbTimestampEvent = "user:local_command_stdout:isReplay:timestamp"
							result.ReplayedLocalCommandBreadcrumbParentToolUseIDValidated = true
							result.ReplayedLocalCommandBreadcrumbParentToolUseIDEvent = "user:local_command_stdout:isReplay:parent_tool_use_id"
							continue
						}
						if !result.ReplayedLocalCommandStderrBreadcrumbValidated && strings.Contains(contentText, "<local-command-stderr>") {
							if strings.TrimSpace(asString(incoming["timestamp"])) == "" {
								return streamValidation{}, fmt.Errorf("invalid replayed local-command stderr breadcrumb: missing timestamp")
							}
							if !synthetic {
								return streamValidation{}, fmt.Errorf("invalid replayed local-command stderr breadcrumb: expected isSynthetic=true")
							}
							if err := validateParentToolUseIDNull(incoming, "invalid replayed local-command stderr breadcrumb"); err != nil {
								return streamValidation{}, err
							}
							result.ReplayedLocalCommandStderrBreadcrumbValidated = true
							result.ReplayedLocalCommandStderrBreadcrumbEvent = "user:local_command_stderr:isReplay"
							result.ReplayedLocalCommandStderrBreadcrumbSyntheticValidated = true
							result.ReplayedLocalCommandStderrBreadcrumbSyntheticEvent = "user:local_command_stderr:isReplay:isSynthetic"
							result.ReplayedLocalCommandStderrBreadcrumbTimestampValidated = true
							result.ReplayedLocalCommandStderrBreadcrumbTimestampEvent = "user:local_command_stderr:isReplay:timestamp"
							result.ReplayedLocalCommandStderrBreadcrumbParentToolUseIDValidated = true
							result.ReplayedLocalCommandStderrBreadcrumbParentToolUseIDEvent = "user:local_command_stderr:isReplay:parent_tool_use_id"
							continue
						}
					}
				}
				content, _ := message["content"].([]any)
				isToolResult := false
				for _, item := range content {
					block, _ := item.(map[string]any)
					if strings.TrimSpace(asString(block["type"])) == "tool_result" {
						isToolResult = true
						if strings.TrimSpace(asString(block["tool_use_id"])) == "" {
							return streamValidation{}, fmt.Errorf("invalid replayed tool_result: missing tool_use_id")
						}
						if _, ok := block["content"]; !ok {
							return streamValidation{}, fmt.Errorf("invalid replayed tool_result: missing content")
						}
					}
				}
				if isToolResult {
					toolUseResult, _ := incoming["tool_use_result"].(map[string]any)
					if strings.TrimSpace(asString(toolUseResult["tool_use_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid replayed tool_result: missing tool_use_result.tool_use_id")
					}
					if _, ok := toolUseResult["content"]; !ok {
						return streamValidation{}, fmt.Errorf("invalid replayed tool_result: missing tool_use_result.content")
					}
					if strings.TrimSpace(asString(incoming["timestamp"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid replayed tool_result: missing timestamp")
					}
					if !synthetic {
						return streamValidation{}, fmt.Errorf("invalid replayed tool_result: expected isSynthetic=true")
					}
					if err := validateParentToolUseIDNull(incoming, "invalid replayed tool_result"); err != nil {
						return streamValidation{}, err
					}
					result.ReplayedToolResultValidated = true
					result.ReplayedToolResultEvent = "user:tool_result:isReplay"
					result.ReplayedToolResultSyntheticValidated = true
					result.ReplayedToolResultSyntheticEvent = "user:tool_result:isReplay:isSynthetic"
					result.ReplayedToolResultTimestampValidated = true
					result.ReplayedToolResultTimestampEvent = "user:tool_result:isReplay:timestamp"
					result.ReplayedToolResultParentToolUseIDValidated = true
					result.ReplayedToolResultParentToolUseIDEvent = "user:tool_result:isReplay:parent_tool_use_id"
					continue
				}
				if replayedPrompt == "" {
					return streamValidation{}, fmt.Errorf("invalid user replay event: missing replayed text content")
				}
				if strings.TrimSpace(asString(incoming["timestamp"])) == "" {
					return streamValidation{}, fmt.Errorf("invalid user replay event: missing timestamp")
				}
				if synthetic {
					return streamValidation{}, fmt.Errorf("invalid user replay event: expected isSynthetic=false")
				}
				if err := validateParentToolUseIDNull(incoming, "invalid user replay event"); err != nil {
					return streamValidation{}, err
				}
				result.ReplayedUserMessageValidated = true
				result.ReplayedUserMessageEvent = "user:isReplay"
				result.ReplayedUserSyntheticValidated = true
				result.ReplayedUserSyntheticEvent = "user:isReplay:isSynthetic=false"
				result.ReplayedUserTimestampValidated = true
				result.ReplayedUserTimestampEvent = "user:isReplay:timestamp"
				result.ReplayedUserParentToolUseIDValidated = true
				result.ReplayedUserParentToolUseIDEvent = "user:isReplay:parent_tool_use_id"
				continue
			case "system":
				switch strings.TrimSpace(asString(incoming["subtype"])) {
				case "init":
					if strings.TrimSpace(asString(incoming["session_id"])) == "" || strings.TrimSpace(asString(incoming["model"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid system event: missing session_id or model")
					}
					result.SystemValidated = true
					result.SystemEvent = "system:init"
				case "status":
					if strings.TrimSpace(asString(incoming["session_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid status event: missing session_id")
					}
					if strings.TrimSpace(asString(incoming["permissionMode"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid status event: missing permissionMode")
					}
					if _, ok := incoming["status"]; !ok {
						return streamValidation{}, fmt.Errorf("invalid status event: missing status")
					}
					result.StatusValidated = true
					result.StatusEvent = "system:status"
					if turn.behavior == "allow" {
						statusValue, _ := incoming["status"]
						statusText := strings.TrimSpace(asString(statusValue))
						if !compactBoundaryValidated && statusText == "compacting" {
							statusCompactingValidated = true
							result.StatusCompactingLifecycleValidated = true
							result.StatusCompactingLifecycleEvent = "system:status:compacting->null"
						}
						if compactBoundaryValidated {
							if !statusCompactingValidated {
								return streamValidation{}, fmt.Errorf("invalid status lifecycle: expected compacting before status clear")
							}
							if statusValue != nil {
								return streamValidation{}, fmt.Errorf("invalid status lifecycle: expected status=null after compact_boundary, got %q", statusText)
							}
							statusClearedValidated = true
							result.StatusCompactingLifecycleValidated = true
							result.StatusCompactingLifecycleEvent = "system:status:compacting->null"
						}
					}
				case "post_turn_summary":
					if turn.behavior == "deny" {
						return streamValidation{}, fmt.Errorf("unexpected post_turn_summary during deny turn")
					}
					if strings.TrimSpace(asString(incoming["session_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid post_turn_summary: missing session_id")
					}
					if strings.TrimSpace(asString(incoming["summarizes_uuid"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid post_turn_summary: missing summarizes_uuid")
					}
					if strings.TrimSpace(asString(incoming["status_category"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid post_turn_summary: missing status_category")
					}
					if strings.TrimSpace(asString(incoming["title"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid post_turn_summary: missing title")
					}
					if strings.TrimSpace(asString(incoming["recent_action"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid post_turn_summary: missing recent_action")
					}
					result.PostTurnSummaryValidated = true
					result.PostTurnSummaryEvent = "system:post_turn_summary"
					postTurnSummaryValidated = true
				case "task_started":
					if turn.behavior == "deny" {
						return streamValidation{}, fmt.Errorf("unexpected task_started during deny turn")
					}
					if strings.TrimSpace(asString(incoming["session_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid task_started: missing session_id")
					}
					if strings.TrimSpace(asString(incoming["task_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid task_started: missing task_id")
					}
					if strings.TrimSpace(asString(incoming["tool_use_id"])) != currentToolUseID {
						return streamValidation{}, fmt.Errorf("invalid task_started: expected tool_use_id=%q, got %q", currentToolUseID, strings.TrimSpace(asString(incoming["tool_use_id"])))
					}
					if strings.TrimSpace(asString(incoming["description"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid task_started: missing description")
					}
					if strings.TrimSpace(asString(incoming["prompt"])) != turn.approvedPrompt {
						return streamValidation{}, fmt.Errorf("invalid task_started: expected prompt=%q, got %q", turn.approvedPrompt, strings.TrimSpace(asString(incoming["prompt"])))
					}
					currentTaskID = strings.TrimSpace(asString(incoming["task_id"]))
					currentTaskDescription = strings.TrimSpace(asString(incoming["description"]))
					result.TaskStartedValidated = true
					result.TaskStartedEvent = "system:task_started"
					taskStartedValidated = true
				case "task_progress":
					if turn.behavior == "deny" {
						return streamValidation{}, fmt.Errorf("unexpected task_progress during deny turn")
					}
					if strings.TrimSpace(asString(incoming["session_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid task_progress: missing session_id")
					}
					if strings.TrimSpace(asString(incoming["task_id"])) != currentTaskID {
						return streamValidation{}, fmt.Errorf("invalid task_progress: expected task_id=%q, got %q", currentTaskID, strings.TrimSpace(asString(incoming["task_id"])))
					}
					if strings.TrimSpace(asString(incoming["tool_use_id"])) != currentToolUseID {
						return streamValidation{}, fmt.Errorf("invalid task_progress: expected tool_use_id=%q, got %q", currentToolUseID, strings.TrimSpace(asString(incoming["tool_use_id"])))
					}
					if strings.TrimSpace(asString(incoming["description"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid task_progress: missing description")
					}
					usage, _ := incoming["usage"].(map[string]any)
					if intFromAny(usage["tool_uses"]) != 1 {
						return streamValidation{}, fmt.Errorf("invalid task_progress: expected usage.tool_uses=1, got %d", intFromAny(usage["tool_uses"]))
					}
					if _, ok := usage["total_tokens"]; !ok {
						return streamValidation{}, fmt.Errorf("invalid task_progress: missing usage.total_tokens")
					}
					if _, ok := usage["duration_ms"]; !ok {
						return streamValidation{}, fmt.Errorf("invalid task_progress: missing usage.duration_ms")
					}
					if strings.TrimSpace(asString(incoming["last_tool_name"])) != "echo" {
						return streamValidation{}, fmt.Errorf("invalid task_progress: unexpected last_tool_name=%q", strings.TrimSpace(asString(incoming["last_tool_name"])))
					}
					result.TaskProgressValidated = true
					result.TaskProgressEvent = "system:task_progress"
					taskProgressValidated = true
				case "task_notification":
					if turn.behavior == "deny" {
						return streamValidation{}, fmt.Errorf("unexpected task_notification during deny turn")
					}
					if strings.TrimSpace(asString(incoming["session_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid task_notification: missing session_id")
					}
					if strings.TrimSpace(asString(incoming["task_id"])) != currentTaskID {
						return streamValidation{}, fmt.Errorf("invalid task_notification: expected task_id=%q, got %q", currentTaskID, strings.TrimSpace(asString(incoming["task_id"])))
					}
					if strings.TrimSpace(asString(incoming["tool_use_id"])) != currentToolUseID {
						return streamValidation{}, fmt.Errorf("invalid task_notification: expected tool_use_id=%q, got %q", currentToolUseID, strings.TrimSpace(asString(incoming["tool_use_id"])))
					}
					if strings.TrimSpace(asString(incoming["status"])) != "completed" {
						return streamValidation{}, fmt.Errorf("invalid task_notification: unexpected status=%q", strings.TrimSpace(asString(incoming["status"])))
					}
					if strings.TrimSpace(asString(incoming["output_file"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid task_notification: missing output_file")
					}
					currentTaskOutputFile = strings.TrimSpace(asString(incoming["output_file"]))
					if strings.TrimSpace(asString(incoming["summary"])) != turn.expectedResponse {
						return streamValidation{}, fmt.Errorf("invalid task_notification: expected summary=%q, got %q", turn.expectedResponse, strings.TrimSpace(asString(incoming["summary"])))
					}
					usage, _ := incoming["usage"].(map[string]any)
					if intFromAny(usage["tool_uses"]) != 1 {
						return streamValidation{}, fmt.Errorf("invalid task_notification: expected usage.tool_uses=1, got %d", intFromAny(usage["tool_uses"]))
					}
					if _, ok := usage["total_tokens"]; !ok {
						return streamValidation{}, fmt.Errorf("invalid task_notification: missing usage.total_tokens")
					}
					if _, ok := usage["duration_ms"]; !ok {
						return streamValidation{}, fmt.Errorf("invalid task_notification: missing usage.duration_ms")
					}
					result.TaskNotificationValidated = true
					result.TaskNotificationEvent = "system:task_notification"
					taskNotificationValidated = true
				case "files_persisted":
					if turn.behavior == "deny" {
						return streamValidation{}, fmt.Errorf("unexpected files_persisted during deny turn")
					}
					if strings.TrimSpace(asString(incoming["session_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid files_persisted: missing session_id")
					}
					files, _ := incoming["files"].([]any)
					if len(files) == 0 {
						return streamValidation{}, fmt.Errorf("invalid files_persisted: missing files")
					}
					file0, _ := files[0].(map[string]any)
					if strings.TrimSpace(asString(file0["filename"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid files_persisted: missing files[0].filename")
					}
					if strings.TrimSpace(asString(file0["file_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid files_persisted: missing files[0].file_id")
					}
					failed, _ := incoming["failed"].([]any)
					if len(failed) != 0 {
						return streamValidation{}, fmt.Errorf("invalid files_persisted: expected failed=[], got %d items", len(failed))
					}
					if strings.TrimSpace(asString(incoming["processed_at"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid files_persisted: missing processed_at")
					}
					result.FilesPersistedValidated = true
					result.FilesPersistedEvent = "system:files_persisted"
					filesPersistedValidated = true
				case "api_retry":
					if turn.behavior == "deny" {
						return streamValidation{}, fmt.Errorf("unexpected api_retry during deny turn")
					}
					if strings.TrimSpace(asString(incoming["session_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid api_retry: missing session_id")
					}
					if intFromAny(incoming["attempt"]) != 1 {
						return streamValidation{}, fmt.Errorf("invalid api_retry: expected attempt=1, got %d", intFromAny(incoming["attempt"]))
					}
					if intFromAny(incoming["max_retries"]) != 3 {
						return streamValidation{}, fmt.Errorf("invalid api_retry: expected max_retries=3, got %d", intFromAny(incoming["max_retries"]))
					}
					if intFromAny(incoming["retry_delay_ms"]) != 500 {
						return streamValidation{}, fmt.Errorf("invalid api_retry: expected retry_delay_ms=500, got %d", intFromAny(incoming["retry_delay_ms"]))
					}
					if intFromAny(incoming["error_status"]) != 529 {
						return streamValidation{}, fmt.Errorf("invalid api_retry: expected error_status=529, got %d", intFromAny(incoming["error_status"]))
					}
					if strings.TrimSpace(asString(incoming["error"])) != "rate_limit" {
						return streamValidation{}, fmt.Errorf("invalid api_retry: unexpected error=%q", strings.TrimSpace(asString(incoming["error"])))
					}
					result.APIRetryValidated = true
					result.APIRetryEvent = "system:api_retry"
					apiRetryValidated = true
				case "local_command_output":
					if turn.behavior == "deny" {
						return streamValidation{}, fmt.Errorf("unexpected local_command_output during deny turn")
					}
					if strings.TrimSpace(asString(incoming["session_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid local_command_output: missing session_id")
					}
					if strings.TrimSpace(asString(incoming["content"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid local_command_output: missing content")
					}
					result.LocalCommandOutputValidated = true
					result.LocalCommandOutputEvent = "system:local_command_output"
					localCommandOutputValidated = true
				case "elicitation_complete":
					if turn.behavior == "deny" {
						return streamValidation{}, fmt.Errorf("unexpected elicitation_complete during deny turn")
					}
					if strings.TrimSpace(asString(incoming["session_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid elicitation_complete: missing session_id")
					}
					if strings.TrimSpace(asString(incoming["mcp_server_name"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid elicitation_complete: missing mcp_server_name")
					}
					if strings.TrimSpace(asString(incoming["elicitation_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid elicitation_complete: missing elicitation_id")
					}
					result.ElicitationCompleteValidated = true
					result.ElicitationCompleteEvent = "system:elicitation_complete"
					elicitationCompleteValidated = true
				case "compact_boundary":
					if strings.TrimSpace(opts.ResumeSessionID) != "" && currentToolUseID == "" && !result.ReplayedCompactBoundaryValidated {
						if strings.TrimSpace(asString(incoming["session_id"])) == "" {
							return streamValidation{}, fmt.Errorf("invalid replayed compact_boundary: missing session_id")
						}
						if strings.TrimSpace(asString(incoming["uuid"])) == "" {
							return streamValidation{}, fmt.Errorf("invalid replayed compact_boundary: missing uuid")
						}
						compactMetadata, _ := incoming["compact_metadata"].(map[string]any)
						if strings.TrimSpace(asString(compactMetadata["trigger"])) == "" {
							return streamValidation{}, fmt.Errorf("invalid replayed compact_boundary: missing compact_metadata.trigger")
						}
						if _, ok := compactMetadata["pre_tokens"]; !ok {
							return streamValidation{}, fmt.Errorf("invalid replayed compact_boundary: missing compact_metadata.pre_tokens")
						}
						if err := validatePreservedSegment(compactMetadata, "invalid replayed compact_boundary"); err != nil {
							return streamValidation{}, err
						}
						result.ReplayedCompactBoundaryValidated = true
						result.ReplayedCompactBoundaryEvent = "system:compact_boundary:replay"
						result.ReplayedCompactBoundaryPreservedSegmentValidated = true
						result.ReplayedCompactBoundaryPreservedSegmentEvent = "system:compact_boundary:replay:preserved_segment"
						continue
					}
					if turn.behavior == "deny" {
						return streamValidation{}, fmt.Errorf("unexpected compact_boundary during deny turn")
					}
					if strings.TrimSpace(asString(incoming["session_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid compact_boundary: missing session_id")
					}
					compactMetadata, _ := incoming["compact_metadata"].(map[string]any)
					if strings.TrimSpace(asString(compactMetadata["trigger"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid compact_boundary: missing compact_metadata.trigger")
					}
					if _, ok := compactMetadata["pre_tokens"]; !ok {
						return streamValidation{}, fmt.Errorf("invalid compact_boundary: missing compact_metadata.pre_tokens")
					}
					if err := validatePreservedSegment(compactMetadata, "invalid compact_boundary"); err != nil {
						return streamValidation{}, err
					}
					if !statusCompactingValidated {
						return streamValidation{}, fmt.Errorf("invalid compact_boundary: expected status=compacting before compact_boundary")
					}
					result.CompactBoundaryValidated = true
					result.CompactBoundaryEvent = "system:compact_boundary"
					result.CompactBoundaryPreservedSegmentValidated = true
					result.CompactBoundaryPreservedSegmentEvent = "system:compact_boundary:preserved_segment"
					compactBoundaryValidated = true
				case "session_state_changed":
					if strings.TrimSpace(asString(incoming["session_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid session_state_changed: missing session_id")
					}
					state := strings.TrimSpace(asString(incoming["state"]))
					switch state {
					case "running":
						sessionStateRunningValidated = true
					case "idle":
						if !sessionStateRunningValidated || !sessionStateRequiresActionValidated {
							return streamValidation{}, fmt.Errorf("invalid session_state_changed: idle seen before running/requires_action")
						}
						if !statusClearedValidated {
							return streamValidation{}, fmt.Errorf("invalid session_state_changed: expected status=null before idle")
						}
						sessionStateIdleValidated = true
						result.SessionStateChangedValidated = true
						result.SessionStateChangedEvent = "system:session_state_changed:idle"
					case "requires_action":
						if !sessionStateRunningValidated {
							return streamValidation{}, fmt.Errorf("invalid session_state_changed: requires_action seen before running")
						}
						if currentRequestID != "" {
							return streamValidation{}, fmt.Errorf("invalid session_state_changed: requires_action seen after control_request")
						}
						sessionStateRequiresActionValidated = true
						result.SessionStateRequiresActionValidated = true
						result.SessionStateRequiresActionEvent = "system:session_state_changed:requires_action"
					default:
						return streamValidation{}, fmt.Errorf("invalid session_state_changed: missing/unknown state")
					}
				case "hook_started":
					if turn.behavior == "deny" {
						return streamValidation{}, fmt.Errorf("unexpected hook_started during deny turn")
					}
					if strings.TrimSpace(asString(incoming["session_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid hook_started: missing session_id")
					}
					if strings.TrimSpace(asString(incoming["hook_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid hook_started: missing hook_id")
					}
					if strings.TrimSpace(asString(incoming["hook_name"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid hook_started: missing hook_name")
					}
					if strings.TrimSpace(asString(incoming["hook_event"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid hook_started: missing hook_event")
					}
					result.HookStartedValidated = true
					result.HookStartedEvent = "system:hook_started"
					hookStartedValidated = true
				case "hook_progress":
					if turn.behavior == "deny" {
						return streamValidation{}, fmt.Errorf("unexpected hook_progress during deny turn")
					}
					if strings.TrimSpace(asString(incoming["session_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid hook_progress: missing session_id")
					}
					if strings.TrimSpace(asString(incoming["hook_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid hook_progress: missing hook_id")
					}
					if strings.TrimSpace(asString(incoming["hook_name"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid hook_progress: missing hook_name")
					}
					if strings.TrimSpace(asString(incoming["hook_event"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid hook_progress: missing hook_event")
					}
					if _, ok := incoming["stdout"]; !ok {
						return streamValidation{}, fmt.Errorf("invalid hook_progress: missing stdout")
					}
					if _, ok := incoming["stderr"]; !ok {
						return streamValidation{}, fmt.Errorf("invalid hook_progress: missing stderr")
					}
					if _, ok := incoming["output"]; !ok {
						return streamValidation{}, fmt.Errorf("invalid hook_progress: missing output")
					}
					result.HookProgressValidated = true
					result.HookProgressEvent = "system:hook_progress"
					hookProgressValidated = true
				case "hook_response":
					if turn.behavior == "deny" {
						return streamValidation{}, fmt.Errorf("unexpected hook_response during deny turn")
					}
					if strings.TrimSpace(asString(incoming["session_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid hook_response: missing session_id")
					}
					if strings.TrimSpace(asString(incoming["hook_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid hook_response: missing hook_id")
					}
					if strings.TrimSpace(asString(incoming["hook_name"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid hook_response: missing hook_name")
					}
					if strings.TrimSpace(asString(incoming["hook_event"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid hook_response: missing hook_event")
					}
					if strings.TrimSpace(asString(incoming["outcome"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid hook_response: missing outcome")
					}
					result.HookResponseValidated = true
					result.HookResponseEvent = "system:hook_response"
					hookResponseValidated = true
				default:
					return streamValidation{}, fmt.Errorf("invalid system event subtype: %s", asString(incoming["subtype"]))
				}
			case "auth_status":
				if strings.TrimSpace(asString(incoming["session_id"])) == "" {
					return streamValidation{}, fmt.Errorf("invalid auth_status event: missing session_id")
				}
				output, _ := incoming["output"].([]any)
				if len(output) == 0 {
					return streamValidation{}, fmt.Errorf("invalid auth_status event: missing output")
				}
				if _, ok := incoming["isAuthenticating"].(bool); !ok {
					return streamValidation{}, fmt.Errorf("invalid auth_status event: missing isAuthenticating")
				}
				result.AuthValidated = true
				result.AuthEvent = "auth_status"
			case "keep_alive":
				result.KeepAliveValidated = true
				result.KeepAliveEvent = "keep_alive"
			case "control_request":
				requestID := strings.TrimSpace(asString(incoming["request_id"]))
				if requestID == "" {
					return streamValidation{}, fmt.Errorf("invalid control request: missing request_id")
				}
				if !sessionStateRunningValidated || !sessionStateRequiresActionValidated {
					return streamValidation{}, fmt.Errorf("invalid control request: expected running -> requires_action before can_use_tool")
				}
				request, _ := incoming["request"].(map[string]any)
				if strings.TrimSpace(asString(request["subtype"])) != "can_use_tool" {
					return streamValidation{}, fmt.Errorf("invalid control request subtype: %s", asString(request["subtype"]))
				}
				if strings.TrimSpace(asString(request["tool_name"])) == "" || strings.TrimSpace(asString(request["tool_use_id"])) == "" {
					return streamValidation{}, fmt.Errorf("invalid control request: missing tool_name or tool_use_id")
				}
				currentRequestID = requestID
				currentToolUseID = strings.TrimSpace(asString(request["tool_use_id"]))
				input, _ := request["input"].(map[string]any)
				if strings.TrimSpace(asString(input["text"])) != turn.prompt {
					return streamValidation{}, fmt.Errorf("invalid control request: expected input.text=%q, got %q", turn.prompt, strings.TrimSpace(asString(input["text"])))
				}
				responsePayload := map[string]any{
					"behavior": turn.behavior,
				}
				if turn.behavior == "allow" {
					responsePayload["updatedInput"] = map[string]any{
						"text": turn.approvedPrompt,
					}
				}
				if err := conn.WriteJSON(map[string]any{
					"type": "control_response",
					"response": map[string]any{
						"subtype":    "success",
						"request_id": requestID,
						"response":   responsePayload,
					},
				}); err != nil {
					return streamValidation{}, fmt.Errorf("write direct-connect control response: %w", err)
				}
				result.ControlValidated = true
				result.PermissionValidated = true
				if turn.behavior == "deny" {
					result.PermissionDeniedValidated = true
					result.PermissionDeniedEvent = "permission_denial:echo"
				}
			case "control_cancel_request":
				if turn.behavior == "deny" {
					return streamValidation{}, fmt.Errorf("unexpected control_cancel_request during deny turn")
				}
				requestID := strings.TrimSpace(asString(incoming["request_id"]))
				if requestID == "" {
					return streamValidation{}, fmt.Errorf("invalid control_cancel_request: missing request_id")
				}
				if requestID != currentRequestID {
					return streamValidation{}, fmt.Errorf("invalid control_cancel_request: expected request_id=%q, got %q", currentRequestID, requestID)
				}
				result.ControlCancelValidated = true
				result.ControlCancelEvent = "control_cancel_request"
			case "tool_progress":
				if turn.behavior == "deny" {
					return streamValidation{}, fmt.Errorf("unexpected tool_progress during deny turn")
				}
				if strings.TrimSpace(asString(incoming["tool_name"])) == "" || strings.TrimSpace(asString(incoming["tool_use_id"])) == "" {
					return streamValidation{}, fmt.Errorf("invalid tool_progress event: missing tool_name or tool_use_id")
				}
				if strings.TrimSpace(asString(incoming["tool_name"])) != "echo" {
					return streamValidation{}, fmt.Errorf("invalid tool_progress event: unexpected tool_name=%q", strings.TrimSpace(asString(incoming["tool_name"])))
				}
				if strings.TrimSpace(asString(incoming["tool_use_id"])) != currentToolUseID {
					return streamValidation{}, fmt.Errorf("invalid tool_progress event: expected tool_use_id=%q, got %q", currentToolUseID, strings.TrimSpace(asString(incoming["tool_use_id"])))
				}
				if strings.TrimSpace(asString(incoming["session_id"])) == "" {
					return streamValidation{}, fmt.Errorf("invalid tool_progress event: missing session_id")
				}
				result.ToolProgressValidated = true
				result.ToolProgressEvent = "tool_progress"
			case "rate_limit_event":
				if turn.behavior == "deny" {
					return streamValidation{}, fmt.Errorf("unexpected rate_limit_event during deny turn")
				}
				if strings.TrimSpace(asString(incoming["session_id"])) == "" {
					return streamValidation{}, fmt.Errorf("invalid rate_limit_event: missing session_id")
				}
				bucket := strings.TrimSpace(asString(incoming["bucket"]))
				if bucket == "" {
					return streamValidation{}, fmt.Errorf("invalid rate_limit_event: missing bucket")
				}
				if _, ok := incoming["limit"]; !ok {
					return streamValidation{}, fmt.Errorf("invalid rate_limit_event: missing limit")
				}
				if _, ok := incoming["remaining"]; !ok {
					return streamValidation{}, fmt.Errorf("invalid rate_limit_event: missing remaining")
				}
				result.RateLimitValidated = true
				result.RateLimitEvent = "rate_limit_event:" + bucket
			case "tool_use_summary":
				if turn.behavior == "deny" {
					return streamValidation{}, fmt.Errorf("unexpected tool_use_summary during deny turn")
				}
				if strings.TrimSpace(asString(incoming["session_id"])) == "" {
					return streamValidation{}, fmt.Errorf("invalid tool_use_summary: missing session_id")
				}
				if strings.TrimSpace(asString(incoming["tool_name"])) != "echo" {
					return streamValidation{}, fmt.Errorf("invalid tool_use_summary tool_name: %q", strings.TrimSpace(asString(incoming["tool_name"])))
				}
				if strings.TrimSpace(asString(incoming["tool_use_id"])) != currentToolUseID {
					return streamValidation{}, fmt.Errorf("invalid tool_use_summary tool_use_id: expected %q, got %q", currentToolUseID, strings.TrimSpace(asString(incoming["tool_use_id"])))
				}
				if strings.TrimSpace(asString(incoming["output_preview"])) != turn.expectedResponse {
					return streamValidation{}, fmt.Errorf("invalid tool_use_summary output_preview: expected %q, got %q", turn.expectedResponse, strings.TrimSpace(asString(incoming["output_preview"])))
				}
				if strings.TrimSpace(asString(incoming["summary"])) == "" {
					return streamValidation{}, fmt.Errorf("invalid tool_use_summary: missing summary")
				}
				precedingToolUseIDs, ok := incoming["preceding_tool_use_ids"].([]any)
				if !ok || len(precedingToolUseIDs) == 0 {
					return streamValidation{}, fmt.Errorf("invalid tool_use_summary: missing preceding_tool_use_ids")
				}
				if strings.TrimSpace(asString(precedingToolUseIDs[0])) != currentToolUseID {
					return streamValidation{}, fmt.Errorf("invalid tool_use_summary preceding_tool_use_ids: expected first=%q, got %q", currentToolUseID, strings.TrimSpace(asString(precedingToolUseIDs[0])))
				}
				result.ToolUseSummaryValidated = true
				result.ToolUseSummaryEvent = "tool_use_summary"
				result.ToolUseSummaryShapeValidated = true
				result.ToolUseSummaryShapeEvent = "tool_use_summary:shape"
			case "streamlined_tool_use_summary":
				if turn.behavior == "deny" {
					return streamValidation{}, fmt.Errorf("unexpected streamlined_tool_use_summary during deny turn")
				}
				if strings.TrimSpace(asString(incoming["session_id"])) == "" {
					return streamValidation{}, fmt.Errorf("invalid streamlined_tool_use_summary: missing session_id")
				}
				if strings.TrimSpace(asString(incoming["tool_summary"])) != "Used echo 1 time" {
					return streamValidation{}, fmt.Errorf("invalid streamlined_tool_use_summary tool_summary: got %q", strings.TrimSpace(asString(incoming["tool_summary"])))
				}
				result.StreamlinedToolUseSummaryValidated = true
				result.StreamlinedToolUseSummaryEvent = "streamlined_tool_use_summary"
				streamlinedToolUseSummaryValidated = true
			case "prompt_suggestion":
				if turn.behavior == "deny" {
					return streamValidation{}, fmt.Errorf("unexpected prompt_suggestion during deny turn")
				}
				if strings.TrimSpace(asString(incoming["session_id"])) == "" {
					return streamValidation{}, fmt.Errorf("invalid prompt_suggestion: missing session_id")
				}
				if strings.TrimSpace(asString(incoming["suggestion"])) != "Try asking for another echo example" {
					return streamValidation{}, fmt.Errorf("invalid prompt_suggestion suggestion: got %q", strings.TrimSpace(asString(incoming["suggestion"])))
				}
				result.PromptSuggestionValidated = true
				result.PromptSuggestionEvent = "prompt_suggestion"
				promptSuggestionValidated = true
			case "attachment":
				if turn.behavior == "deny" {
					return streamValidation{}, fmt.Errorf("unexpected attachment during deny turn")
				}
				if strings.TrimSpace(asString(incoming["session_id"])) == "" {
					return streamValidation{}, fmt.Errorf("invalid attachment: missing session_id")
				}
				attachment, _ := incoming["attachment"].(map[string]any)
				switch strings.TrimSpace(asString(attachment["type"])) {
				case "structured_output":
					attachmentData, _ := attachment["data"].(map[string]any)
					if len(attachmentData) == 0 {
						return streamValidation{}, fmt.Errorf("invalid structured_output attachment: missing data object")
					}
					if strings.TrimSpace(asString(attachmentData["text"])) != turn.expectedResponse {
						return streamValidation{}, fmt.Errorf("invalid structured_output attachment.text: expected %q, got %q", turn.expectedResponse, strings.TrimSpace(asString(attachmentData["text"])))
					}
					result.StructuredOutputAttachmentValidated = true
					result.StructuredOutputAttachmentEvent = "attachment:structured_output"
					structuredOutputAttachmentValidated = true
				case "max_turns_reached":
					if turn.behavior != "max_turns" {
						return streamValidation{}, fmt.Errorf("unexpected max_turns_reached attachment during %s turn", turn.behavior)
					}
					if intFromAny(attachment["turnCount"]) != result.ValidatedTurns {
						return streamValidation{}, fmt.Errorf("invalid max_turns_reached attachment.turnCount: expected %d, got %d", result.ValidatedTurns, intFromAny(attachment["turnCount"]))
					}
					if intFromAny(attachment["maxTurns"]) != result.ValidatedTurns {
						return streamValidation{}, fmt.Errorf("invalid max_turns_reached attachment.maxTurns: expected %d, got %d", result.ValidatedTurns, intFromAny(attachment["maxTurns"]))
					}
					result.MaxTurnsReachedAttachmentValidated = true
					result.MaxTurnsReachedAttachmentEvent = "attachment:max_turns_reached"
					maxTurnsReachedAttachmentValidated = true
				case "task_status":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected task_status attachment during %s turn", turn.behavior)
					}
					if strings.TrimSpace(asString(attachment["taskId"])) != currentTaskID {
						return streamValidation{}, fmt.Errorf("invalid task_status attachment.taskId: expected %q, got %q", currentTaskID, strings.TrimSpace(asString(attachment["taskId"])))
					}
					if strings.TrimSpace(asString(attachment["taskType"])) != "local_bash" {
						return streamValidation{}, fmt.Errorf("invalid task_status attachment.taskType: expected %q, got %q", "local_bash", strings.TrimSpace(asString(attachment["taskType"])))
					}
					if strings.TrimSpace(asString(attachment["status"])) != "completed" {
						return streamValidation{}, fmt.Errorf("invalid task_status attachment.status: expected %q, got %q", "completed", strings.TrimSpace(asString(attachment["status"])))
					}
					if strings.TrimSpace(asString(attachment["description"])) != currentTaskDescription {
						return streamValidation{}, fmt.Errorf("invalid task_status attachment.description: expected %q, got %q", currentTaskDescription, strings.TrimSpace(asString(attachment["description"])))
					}
					deltaSummary, ok := attachment["deltaSummary"]
					if !ok {
						return streamValidation{}, fmt.Errorf("invalid task_status attachment: missing deltaSummary")
					}
					if strings.TrimSpace(asString(deltaSummary)) != turn.expectedResponse {
						return streamValidation{}, fmt.Errorf("invalid task_status attachment.deltaSummary: expected %q, got %q", turn.expectedResponse, strings.TrimSpace(asString(deltaSummary)))
					}
					if strings.TrimSpace(asString(attachment["outputFilePath"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid task_status attachment: missing outputFilePath")
					}
					result.TaskStatusAttachmentValidated = true
					result.TaskStatusAttachmentEvent = "attachment:task_status"
				case "queued_command":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected queued_command attachment during %s turn", turn.behavior)
					}
					if strings.TrimSpace(asString(attachment["commandMode"])) != "task-notification" {
						return streamValidation{}, fmt.Errorf("invalid queued_command attachment.commandMode: expected %q, got %q", "task-notification", strings.TrimSpace(asString(attachment["commandMode"])))
					}
					prompt := strings.TrimSpace(asString(attachment["prompt"]))
					expectedPrompt := fmt.Sprintf(
						"<task-notification>\n<task-id>%s</task-id>\n<tool-use-id>%s</tool-use-id>\n<task-type>local_bash</task-type>\n<output-file>%s</output-file>\n<status>completed</status>\n<summary>Task %q completed</summary>\n</task-notification>",
						currentTaskID,
						currentToolUseID,
						currentTaskOutputFile,
						currentTaskDescription,
					)
					if prompt != expectedPrompt {
						return streamValidation{}, fmt.Errorf("invalid queued_command attachment.prompt: expected %q, got %q", expectedPrompt, prompt)
					}
					result.QueuedCommandValidated = true
					result.QueuedCommandEvent = "attachment:queued_command"
					queuedCommandValidated = true
				case "task_reminder":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected task_reminder attachment during %s turn", turn.behavior)
					}
					content, ok := attachment["content"].([]any)
					if !ok || len(content) != 1 {
						return streamValidation{}, fmt.Errorf("invalid task_reminder attachment.content: expected 1 task, got %#v", attachment["content"])
					}
					task, _ := content[0].(map[string]any)
					if strings.TrimSpace(asString(task["id"])) != currentTaskID {
						return streamValidation{}, fmt.Errorf("invalid task_reminder attachment.content[0].id: expected %q, got %q", currentTaskID, strings.TrimSpace(asString(task["id"])))
					}
					if strings.TrimSpace(asString(task["status"])) != "completed" {
						return streamValidation{}, fmt.Errorf("invalid task_reminder attachment.content[0].status: expected %q, got %q", "completed", strings.TrimSpace(asString(task["status"])))
					}
					if strings.TrimSpace(asString(task["subject"])) != currentTaskDescription {
						return streamValidation{}, fmt.Errorf("invalid task_reminder attachment.content[0].subject: expected %q, got %q", currentTaskDescription, strings.TrimSpace(asString(task["subject"])))
					}
					if intFromAny(attachment["itemCount"]) != 1 {
						return streamValidation{}, fmt.Errorf("invalid task_reminder attachment.itemCount: expected 1, got %d", intFromAny(attachment["itemCount"]))
					}
					result.TaskReminderAttachmentValidated = true
					result.TaskReminderAttachmentEvent = "attachment:task_reminder"
					taskReminderAttachmentValidated = true
				case "todo_reminder":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected todo_reminder attachment during %s turn", turn.behavior)
					}
					content, ok := attachment["content"].([]any)
					if !ok || len(content) != 1 {
						return streamValidation{}, fmt.Errorf("invalid todo_reminder attachment.content: expected 1 todo, got %#v", attachment["content"])
					}
					todo, _ := content[0].(map[string]any)
					if strings.TrimSpace(asString(todo["content"])) != currentTaskDescription {
						return streamValidation{}, fmt.Errorf("invalid todo_reminder attachment.content[0].content: expected %q, got %q", currentTaskDescription, strings.TrimSpace(asString(todo["content"])))
					}
					if strings.TrimSpace(asString(todo["status"])) != "completed" {
						return streamValidation{}, fmt.Errorf("invalid todo_reminder attachment.content[0].status: expected %q, got %q", "completed", strings.TrimSpace(asString(todo["status"])))
					}
					if strings.TrimSpace(asString(todo["activeForm"])) != "Completing direct-connect echo task" {
						return streamValidation{}, fmt.Errorf("invalid todo_reminder attachment.content[0].activeForm: expected %q, got %q", "Completing direct-connect echo task", strings.TrimSpace(asString(todo["activeForm"])))
					}
					if intFromAny(attachment["itemCount"]) != 1 {
						return streamValidation{}, fmt.Errorf("invalid todo_reminder attachment.itemCount: expected 1, got %d", intFromAny(attachment["itemCount"]))
					}
					result.TodoReminderAttachmentValidated = true
					result.TodoReminderAttachmentEvent = "attachment:todo_reminder"
				case "compaction_reminder":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected compaction_reminder attachment during %s turn", turn.behavior)
					}
					result.CompactionReminderValidated = true
					result.CompactionReminderEvent = "attachment:compaction_reminder"
					compactionReminderValidated = true
				case "context_efficiency":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected context_efficiency attachment during %s turn", turn.behavior)
					}
					result.ContextEfficiencyValidated = true
					result.ContextEfficiencyEvent = "attachment:context_efficiency"
					contextEfficiencyValidated = true
				case "auto_mode_exit":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected auto_mode_exit attachment during %s turn", turn.behavior)
					}
					result.AutoModeExitValidated = true
					result.AutoModeExitEvent = "attachment:auto_mode_exit"
					autoModeExitValidated = true
				case "plan_mode":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected plan_mode attachment during %s turn", turn.behavior)
					}
					if strings.TrimSpace(asString(attachment["reminderType"])) != "full" {
						return streamValidation{}, fmt.Errorf("invalid plan_mode attachment.reminderType: expected %q, got %q", "full", strings.TrimSpace(asString(attachment["reminderType"])))
					}
					planFilePath := strings.TrimSpace(asString(attachment["planFilePath"]))
					if planFilePath == "" {
						return streamValidation{}, fmt.Errorf("invalid plan_mode attachment: missing planFilePath")
					}
					if !strings.HasSuffix(strings.ReplaceAll(planFilePath, "\\", "/"), ".claude/plan.md") {
						return streamValidation{}, fmt.Errorf("invalid plan_mode attachment.planFilePath: %q", planFilePath)
					}
					planExists, ok := attachment["planExists"].(bool)
					if !ok || planExists {
						return streamValidation{}, fmt.Errorf("invalid plan_mode attachment.planExists: expected false")
					}
					isSubAgent, ok := attachment["isSubAgent"].(bool)
					if !ok || isSubAgent {
						return streamValidation{}, fmt.Errorf("invalid plan_mode attachment.isSubAgent: expected false")
					}
					result.PlanModeValidated = true
					result.PlanModeEvent = "attachment:plan_mode"
					planModeValidated = true
				case "plan_mode_exit":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected plan_mode_exit attachment during %s turn", turn.behavior)
					}
					planFilePath := strings.TrimSpace(asString(attachment["planFilePath"]))
					if planFilePath == "" {
						return streamValidation{}, fmt.Errorf("invalid plan_mode_exit attachment: missing planFilePath")
					}
					if !strings.HasSuffix(strings.ReplaceAll(planFilePath, "\\", "/"), ".claude/plan.md") {
						return streamValidation{}, fmt.Errorf("invalid plan_mode_exit attachment.planFilePath: %q", planFilePath)
					}
					planExists, ok := attachment["planExists"].(bool)
					if !ok || planExists {
						return streamValidation{}, fmt.Errorf("invalid plan_mode_exit attachment.planExists: expected false")
					}
					result.PlanModeExitValidated = true
					result.PlanModeExitEvent = "attachment:plan_mode_exit"
					planModeExitValidated = true
				case "plan_mode_reentry":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected plan_mode_reentry attachment during %s turn", turn.behavior)
					}
					planFilePath := strings.TrimSpace(asString(attachment["planFilePath"]))
					if planFilePath == "" {
						return streamValidation{}, fmt.Errorf("invalid plan_mode_reentry attachment: missing planFilePath")
					}
					if !strings.HasSuffix(strings.ReplaceAll(planFilePath, "\\", "/"), ".claude/plan.md") {
						return streamValidation{}, fmt.Errorf("invalid plan_mode_reentry attachment.planFilePath: %q", planFilePath)
					}
					result.PlanModeReentryValidated = true
					result.PlanModeReentryEvent = "attachment:plan_mode_reentry"
					planModeReentryValidated = true
				case "date_change":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected date_change attachment during %s turn", turn.behavior)
					}
					newDate := strings.TrimSpace(asString(attachment["newDate"]))
					if newDate != "2026-04-09" {
						return streamValidation{}, fmt.Errorf("invalid date_change attachment.newDate: %q", newDate)
					}
					result.DateChangeValidated = true
					result.DateChangeEvent = "attachment:date_change"
					dateChangeValidated = true
				case "ultrathink_effort":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected ultrathink_effort attachment during %s turn", turn.behavior)
					}
					if strings.TrimSpace(asString(attachment["level"])) != "high" {
						return streamValidation{}, fmt.Errorf("invalid ultrathink_effort attachment.level: expected %q, got %q", "high", strings.TrimSpace(asString(attachment["level"])))
					}
					result.UltrathinkEffortValidated = true
					result.UltrathinkEffortEvent = "attachment:ultrathink_effort"
					ultrathinkEffortValidated = true
				case "deferred_tools_delta":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected deferred_tools_delta attachment during %s turn", turn.behavior)
					}
					addedNames, ok := attachment["addedNames"].([]any)
					if !ok || len(addedNames) != 1 || strings.TrimSpace(asString(addedNames[0])) != "ToolSearch" {
						return streamValidation{}, fmt.Errorf("invalid deferred_tools_delta attachment.addedNames")
					}
					addedLines, ok := attachment["addedLines"].([]any)
					if !ok || len(addedLines) != 1 || strings.TrimSpace(asString(addedLines[0])) != "- ToolSearch: Search deferred tools on demand" {
						return streamValidation{}, fmt.Errorf("invalid deferred_tools_delta attachment.addedLines")
					}
					removedNames, ok := attachment["removedNames"].([]any)
					if !ok || len(removedNames) != 0 {
						return streamValidation{}, fmt.Errorf("invalid deferred_tools_delta attachment.removedNames")
					}
					result.DeferredToolsDeltaValidated = true
					result.DeferredToolsDeltaEvent = "attachment:deferred_tools_delta"
					deferredToolsDeltaValidated = true
				case "agent_listing_delta":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected agent_listing_delta attachment during %s turn", turn.behavior)
					}
					addedTypes, ok := attachment["addedTypes"].([]any)
					if !ok || len(addedTypes) != 1 || strings.TrimSpace(asString(addedTypes[0])) != "explorer" {
						return streamValidation{}, fmt.Errorf("invalid agent_listing_delta attachment.addedTypes")
					}
					addedLines, ok := attachment["addedLines"].([]any)
					if !ok || len(addedLines) != 1 || strings.TrimSpace(asString(addedLines[0])) != "- explorer: Fast codebase explorer for scoped questions" {
						return streamValidation{}, fmt.Errorf("invalid agent_listing_delta attachment.addedLines")
					}
					removedTypes, ok := attachment["removedTypes"].([]any)
					if !ok || len(removedTypes) != 0 {
						return streamValidation{}, fmt.Errorf("invalid agent_listing_delta attachment.removedTypes")
					}
					if initial, ok := attachment["isInitial"].(bool); !ok || !initial {
						return streamValidation{}, fmt.Errorf("invalid agent_listing_delta attachment.isInitial")
					}
					if showConcurrencyNote, ok := attachment["showConcurrencyNote"].(bool); !ok || !showConcurrencyNote {
						return streamValidation{}, fmt.Errorf("invalid agent_listing_delta attachment.showConcurrencyNote")
					}
					result.AgentListingDeltaValidated = true
					result.AgentListingDeltaEvent = "attachment:agent_listing_delta"
					agentListingDeltaValidated = true
				case "mcp_instructions_delta":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected mcp_instructions_delta attachment during %s turn", turn.behavior)
					}
					addedNames, ok := attachment["addedNames"].([]any)
					if !ok || len(addedNames) != 1 || strings.TrimSpace(asString(addedNames[0])) != "chrome" {
						return streamValidation{}, fmt.Errorf("invalid mcp_instructions_delta attachment.addedNames")
					}
					addedBlocks, ok := attachment["addedBlocks"].([]any)
					if !ok || len(addedBlocks) != 1 || strings.TrimSpace(asString(addedBlocks[0])) != "## chrome\nUse ToolSearch before browser actions." {
						return streamValidation{}, fmt.Errorf("invalid mcp_instructions_delta attachment.addedBlocks")
					}
					removedNames, ok := attachment["removedNames"].([]any)
					if !ok || len(removedNames) != 0 {
						return streamValidation{}, fmt.Errorf("invalid mcp_instructions_delta attachment.removedNames")
					}
					result.MCPInstructionsDeltaValidated = true
					result.MCPInstructionsDeltaEvent = "attachment:mcp_instructions_delta"
					mcpInstructionsDeltaValidated = true
				case "companion_intro":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected companion_intro attachment during %s turn", turn.behavior)
					}
					if strings.TrimSpace(asString(attachment["name"])) != "Mochi" {
						return streamValidation{}, fmt.Errorf("invalid companion_intro attachment.name: expected %q, got %q", "Mochi", strings.TrimSpace(asString(attachment["name"])))
					}
					if strings.TrimSpace(asString(attachment["species"])) != "otter" {
						return streamValidation{}, fmt.Errorf("invalid companion_intro attachment.species: expected %q, got %q", "otter", strings.TrimSpace(asString(attachment["species"])))
					}
					result.CompanionIntroValidated = true
					result.CompanionIntroEvent = "attachment:companion_intro"
					companionIntroValidated = true
				case "token_usage":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected token_usage attachment during %s turn", turn.behavior)
					}
					used, ok := attachment["used"].(float64)
					if !ok || int(used) != 1024 {
						return streamValidation{}, fmt.Errorf("invalid token_usage attachment.used")
					}
					total, ok := attachment["total"].(float64)
					if !ok || int(total) != 200000 {
						return streamValidation{}, fmt.Errorf("invalid token_usage attachment.total")
					}
					remaining, ok := attachment["remaining"].(float64)
					if !ok || int(remaining) != 198976 {
						return streamValidation{}, fmt.Errorf("invalid token_usage attachment.remaining")
					}
					result.TokenUsageValidated = true
					result.TokenUsageEvent = "attachment:token_usage"
					tokenUsageValidated = true
				case "output_token_usage":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected output_token_usage attachment during %s turn", turn.behavior)
					}
					turnTokens, ok := attachment["turn"].(float64)
					if !ok || int(turnTokens) != 256 {
						return streamValidation{}, fmt.Errorf("invalid output_token_usage attachment.turn")
					}
					sessionTokens, ok := attachment["session"].(float64)
					if !ok || int(sessionTokens) != 512 {
						return streamValidation{}, fmt.Errorf("invalid output_token_usage attachment.session")
					}
					budget, ok := attachment["budget"].(float64)
					if !ok || int(budget) != 1024 {
						return streamValidation{}, fmt.Errorf("invalid output_token_usage attachment.budget")
					}
					result.OutputTokenUsageValidated = true
					result.OutputTokenUsageEvent = "attachment:output_token_usage"
					outputTokenUsageValidated = true
				case "verify_plan_reminder":
					if turn.behavior != "allow" {
						return streamValidation{}, fmt.Errorf("unexpected verify_plan_reminder attachment during %s turn", turn.behavior)
					}
					result.VerifyPlanReminderValidated = true
					result.VerifyPlanReminderEvent = "attachment:verify_plan_reminder"
					verifyPlanReminderValidated = true
				default:
					return streamValidation{}, fmt.Errorf("invalid attachment type: %q", strings.TrimSpace(asString(attachment["type"])))
				}
			case "stream_event":
				if turn.behavior == "deny" {
					return streamValidation{}, fmt.Errorf("unexpected stream_event during deny turn")
				}
				if strings.TrimSpace(asString(incoming["session_id"])) == "" {
					return streamValidation{}, fmt.Errorf("invalid stream_event: missing session_id")
				}
				event, _ := incoming["event"].(map[string]any)
				switch strings.TrimSpace(asString(event["type"])) {
				case "message_start":
					message, _ := event["message"].(map[string]any)
					if strings.TrimSpace(asString(message["id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid message_start message.id: missing id")
					}
					if strings.TrimSpace(asString(message["type"])) != "message" {
						return streamValidation{}, fmt.Errorf("invalid message_start message.type: expected %q, got %q", "message", strings.TrimSpace(asString(message["type"])))
					}
					if strings.TrimSpace(asString(message["role"])) != "assistant" {
						return streamValidation{}, fmt.Errorf("invalid message_start message.role: expected %q, got %q", "assistant", strings.TrimSpace(asString(message["role"])))
					}
					if strings.TrimSpace(asString(message["model"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid message_start message.model: missing model")
					}
					if err := validateZeroUsageShape(message["usage"]); err != nil {
						return streamValidation{}, fmt.Errorf("invalid message_start usage: %w", err)
					}
					result.AssistantMessageStartValidated = true
					result.AssistantMessageStartEvent = "stream_event:message_start"
					assistantMessageStartValidated = true
				case "content_block_start":
					contentBlock, _ := event["content_block"].(map[string]any)
					if strings.TrimSpace(asString(contentBlock["type"])) != "tool_use" {
						return streamValidation{}, fmt.Errorf("invalid content_block_start content_block.type: %q", strings.TrimSpace(asString(contentBlock["type"])))
					}
					if strings.TrimSpace(asString(contentBlock["id"])) != currentToolUseID {
						return streamValidation{}, fmt.Errorf("invalid content_block_start content_block.id: expected %q, got %q", currentToolUseID, strings.TrimSpace(asString(contentBlock["id"])))
					}
					if strings.TrimSpace(asString(contentBlock["name"])) != "echo" {
						return streamValidation{}, fmt.Errorf("invalid content_block_start content_block.name: %q", strings.TrimSpace(asString(contentBlock["name"])))
					}
					if strings.TrimSpace(asString(contentBlock["input"])) != "" {
						return streamValidation{}, fmt.Errorf("invalid content_block_start content_block.input: expected empty placeholder")
					}
					result.ToolUseBlockStartValidated = true
					result.ToolUseBlockStartEvent = "stream_event:content_block_start:tool_use"
					toolUseBlockStartValidated = true
				case "content_block_delta":
					delta, _ := event["delta"].(map[string]any)
					switch strings.TrimSpace(asString(delta["type"])) {
					case "text_delta":
						if strings.TrimSpace(asString(delta["text"])) != turn.expectedResponse {
							return streamValidation{}, fmt.Errorf("invalid stream_event delta text: expected %q, got %q", turn.expectedResponse, strings.TrimSpace(asString(delta["text"])))
						}
						result.StreamContentValidated = true
						result.StreamContentEvent = "stream_event:content_block_delta"
					case "thinking_delta":
						if strings.TrimSpace(asString(delta["thinking"])) == "" {
							return streamValidation{}, fmt.Errorf("invalid thinking_delta: missing thinking")
						}
						result.ThinkingDeltaValidated = true
						result.ThinkingDeltaEvent = "stream_event:thinking_delta"
						thinkingDeltaValidated = true
					case "signature_delta":
						if strings.TrimSpace(asString(delta["signature"])) == "" {
							return streamValidation{}, fmt.Errorf("invalid signature_delta: missing signature")
						}
						result.ThinkingSignatureValidated = true
						result.ThinkingSignatureEvent = "stream_event:signature_delta"
						thinkingSignatureValidated = true
					case "input_json_delta":
						if strings.TrimSpace(asString(delta["partial_json"])) == "" {
							return streamValidation{}, fmt.Errorf("invalid input_json_delta: missing partial_json")
						}
						result.ToolUseDeltaValidated = true
						result.ToolUseDeltaEvent = "stream_event:input_json_delta"
						toolUseDeltaValidated = true
					default:
						return streamValidation{}, fmt.Errorf("invalid stream_event delta type: %s", asString(delta["type"]))
					}
				case "content_block_stop":
					result.ToolUseBlockStopValidated = true
					result.ToolUseBlockStopEvent = "stream_event:content_block_stop:tool_use"
					toolUseBlockStopValidated = true
				case "message_delta":
					delta, _ := event["delta"].(map[string]any)
					if strings.TrimSpace(asString(delta["stop_reason"])) != "end_turn" {
						return streamValidation{}, fmt.Errorf("invalid message_delta stop_reason: expected %q, got %q", "end_turn", strings.TrimSpace(asString(delta["stop_reason"])))
					}
					if err := validateZeroUsageShape(event["usage"]); err != nil {
						return streamValidation{}, fmt.Errorf("invalid message_delta usage: %w", err)
					}
					result.AssistantMessageDeltaValidated = true
					result.AssistantMessageDeltaEvent = "stream_event:message_delta"
					assistantMessageDeltaValidated = true
				case "message_stop":
					result.AssistantMessageStopValidated = true
					result.AssistantMessageStopEvent = "stream_event:message_stop"
					assistantMessageStopValidated = true
				default:
					return streamValidation{}, fmt.Errorf("invalid stream_event type: %s", asString(event["type"]))
				}
			case "streamlined_text":
				if turn.behavior == "deny" {
					return streamValidation{}, fmt.Errorf("unexpected streamlined_text during deny turn")
				}
				if strings.TrimSpace(asString(incoming["session_id"])) == "" {
					return streamValidation{}, fmt.Errorf("invalid streamlined_text: missing session_id")
				}
				if strings.TrimSpace(asString(incoming["text"])) != turn.expectedResponse {
					return streamValidation{}, fmt.Errorf("invalid streamlined_text text: expected %q, got %q", turn.expectedResponse, strings.TrimSpace(asString(incoming["text"])))
				}
				result.StreamlinedTextValidated = true
				result.StreamlinedTextEvent = "streamlined_text"
				streamlinedTextValidated = true
			case "assistant":
				if strings.TrimSpace(opts.ResumeSessionID) != "" && currentToolUseID == "" && !result.ReplayedAssistantMessageValidated {
					if strings.TrimSpace(asString(incoming["uuid"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid replayed assistant message: missing uuid")
					}
					if strings.TrimSpace(asString(incoming["session_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid replayed assistant message: missing session_id")
					}
					if incoming["parent_tool_use_id"] != nil {
						return streamValidation{}, fmt.Errorf("invalid replayed assistant message: expected parent_tool_use_id=null")
					}
					message, _ := incoming["message"].(map[string]any)
					if strings.TrimSpace(asString(message["role"])) != "assistant" {
						return streamValidation{}, fmt.Errorf("invalid replayed assistant message: missing role=assistant")
					}
					content, _ := message["content"].([]any)
					foundReplayText := false
					for _, item := range content {
						block, _ := item.(map[string]any)
						if strings.TrimSpace(asString(block["type"])) == "text" && strings.TrimSpace(asString(block["text"])) != "" {
							foundReplayText = true
							break
						}
					}
					if !foundReplayText {
						return streamValidation{}, fmt.Errorf("invalid replayed assistant message: missing text content")
					}
					result.ReplayedAssistantMessageValidated = true
					result.ReplayedAssistantMessageEvent = "assistant:replay"
					continue
				}
				message, _ := incoming["message"].(map[string]any)
				content, _ := message["content"].([]any)
				mirrorFound := false
				for _, item := range content {
					block, _ := item.(map[string]any)
					if strings.TrimSpace(asString(block["type"])) == "text" && strings.TrimSpace(asString(block["text"])) == "local command output: persisted direct-connect artifacts" {
						mirrorFound = true
						break
					}
				}
				if mirrorFound {
					if strings.TrimSpace(asString(incoming["uuid"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid local_command_output assistant mirror: missing uuid")
					}
					if strings.TrimSpace(asString(incoming["session_id"])) == "" {
						return streamValidation{}, fmt.Errorf("invalid local_command_output assistant mirror: missing session_id")
					}
					if strings.TrimSpace(asString(message["role"])) != "assistant" {
						return streamValidation{}, fmt.Errorf("invalid local_command_output assistant mirror: missing role=assistant")
					}
					if !result.LocalCommandOutputAssistantValidated {
						result.LocalCommandOutputAssistantValidated = true
						result.LocalCommandOutputAssistantEvent = "assistant:local_command_output"
					}
					continue
				}
				if turn.behavior == "deny" {
					return streamValidation{}, fmt.Errorf("unexpected assistant payload during deny turn")
				}
				foundThinking := false
				foundToolUse := false
				found := false
				for _, item := range content {
					block, _ := item.(map[string]any)
					switch strings.TrimSpace(asString(block["type"])) {
					case "thinking":
						if strings.TrimSpace(asString(block["thinking"])) == "" || strings.TrimSpace(asString(block["signature"])) == "" {
							return streamValidation{}, fmt.Errorf("invalid assistant thinking block: missing thinking or signature")
						}
						foundThinking = true
					case "tool_use":
						if strings.TrimSpace(asString(block["id"])) != currentToolUseID {
							return streamValidation{}, fmt.Errorf("invalid assistant tool_use block id: expected %q, got %q", currentToolUseID, strings.TrimSpace(asString(block["id"])))
						}
						if strings.TrimSpace(asString(block["name"])) != "echo" {
							return streamValidation{}, fmt.Errorf("invalid assistant tool_use block name: %q", strings.TrimSpace(asString(block["name"])))
						}
						input, _ := block["input"].(map[string]any)
						if strings.TrimSpace(asString(input["text"])) != turn.approvedPrompt {
							return streamValidation{}, fmt.Errorf("invalid assistant tool_use block input.text: expected %q, got %q", turn.approvedPrompt, strings.TrimSpace(asString(input["text"])))
						}
						foundToolUse = true
					case "text":
						if strings.TrimSpace(asString(block["text"])) == turn.expectedResponse {
							found = true
						}
					}
				}
				if !foundThinking {
					return streamValidation{}, fmt.Errorf("invalid assistant payload: missing thinking block")
				}
				if !foundToolUse {
					return streamValidation{}, fmt.Errorf("invalid assistant payload: missing tool_use block")
				}
				if !found {
					return streamValidation{}, fmt.Errorf("invalid assistant payload: missing echo for %q", turn.approvedPrompt)
				}
				if strings.TrimSpace(asString(incoming["stop_reason"])) != "end_turn" {
					return streamValidation{}, fmt.Errorf("invalid assistant stop_reason: expected %q, got %q", "end_turn", strings.TrimSpace(asString(incoming["stop_reason"])))
				}
				if err := validateZeroUsageShape(incoming["usage"]); err != nil {
					return streamValidation{}, fmt.Errorf("invalid assistant usage: %w", err)
				}
				result.AssistantThinkingValidated = true
				result.AssistantThinkingEvent = "assistant:thinking"
				assistantThinkingValidated = true
				result.AssistantToolUseValidated = true
				result.AssistantToolUseEvent = "assistant:tool_use"
				assistantToolUseValidated = true
				result.AssistantStopReasonValidated = true
				result.AssistantStopReasonEvent = "assistant:stop_reason"
				assistantStopReasonValidated = true
				result.AssistantUsageValidated = true
				result.AssistantUsageEvent = "assistant:usage"
				assistantUsageValidated = true
				result.MessageValidated = true
				result.MessageEvent = "assistant"
				result.ToolExecutionValidated = true
				result.ValidatedTurns++
				assistantValidated = true
			case "result":
				if asString(incoming["session_id"]) == "" {
					return streamValidation{}, fmt.Errorf("invalid result event: missing session_id")
				}
				if strings.TrimSpace(asString(incoming["fast_mode_state"])) != "off" {
					return streamValidation{}, fmt.Errorf("invalid result fast_mode_state: expected %q, got %q", "off", strings.TrimSpace(asString(incoming["fast_mode_state"])))
				}
				if turn.behavior == "allow" {
					if strings.TrimSpace(asString(incoming["subtype"])) != "success" {
						return streamValidation{}, fmt.Errorf("invalid result event subtype: %s", asString(incoming["subtype"]))
					}
					if intFromAny(incoming["num_turns"]) != result.ValidatedTurns {
						return streamValidation{}, fmt.Errorf("invalid result event: expected num_turns=%d, got %d", result.ValidatedTurns, intFromAny(incoming["num_turns"]))
					}
					if strings.TrimSpace(asString(incoming["result"])) != turn.expectedResponse {
						return streamValidation{}, fmt.Errorf("invalid result payload: expected result=%q, got %q", turn.expectedResponse, strings.TrimSpace(asString(incoming["result"])))
					}
					structuredOutput, _ := incoming["structured_output"].(map[string]any)
					if len(structuredOutput) == 0 {
						return streamValidation{}, fmt.Errorf("invalid result structured_output: missing object")
					}
					if strings.TrimSpace(asString(structuredOutput["text"])) != turn.expectedResponse {
						return streamValidation{}, fmt.Errorf("invalid result structured_output.text: expected %q, got %q", turn.expectedResponse, strings.TrimSpace(asString(structuredOutput["text"])))
					}
					usage, _ := incoming["usage"].(map[string]any)
					serverToolUse, _ := usage["server_tool_use"].(map[string]any)
					cacheCreation, _ := usage["cache_creation"].(map[string]any)
					iterations, _ := usage["iterations"].([]any)
					if intFromAny(usage["input_tokens"]) != 0 || intFromAny(usage["cache_creation_input_tokens"]) != 0 || intFromAny(usage["cache_read_input_tokens"]) != 0 || intFromAny(usage["output_tokens"]) != 0 || intFromAny(serverToolUse["web_search_requests"]) != 0 || intFromAny(serverToolUse["web_fetch_requests"]) != 0 || strings.TrimSpace(asString(usage["service_tier"])) != "standard" || intFromAny(cacheCreation["ephemeral_1h_input_tokens"]) != 0 || intFromAny(cacheCreation["ephemeral_5m_input_tokens"]) != 0 || strings.TrimSpace(asString(usage["inference_geo"])) != "" || len(iterations) != 0 || strings.TrimSpace(asString(usage["speed"])) != "standard" {
						return streamValidation{}, fmt.Errorf("invalid result usage: unexpected zero-value payload")
					}
					modelUsage, _ := incoming["modelUsage"].(map[string]any)
					modelUsageEntry, _ := modelUsage["claude-sonnet-4-5"].(map[string]any)
					if len(modelUsageEntry) == 0 {
						return streamValidation{}, fmt.Errorf("invalid result modelUsage: missing claude-sonnet-4-5 entry")
					}
					if intFromAny(modelUsageEntry["inputTokens"]) != 0 || intFromAny(modelUsageEntry["outputTokens"]) != 0 || intFromAny(modelUsageEntry["cacheReadInputTokens"]) != 0 || intFromAny(modelUsageEntry["cacheCreationInputTokens"]) != 0 || intFromAny(modelUsageEntry["webSearchRequests"]) != 0 || intFromAny(modelUsageEntry["contextWindow"]) != 0 || float64FromAny(modelUsageEntry["costUSD"]) != 0 {
						return streamValidation{}, fmt.Errorf("invalid result modelUsage: unexpected claude-sonnet-4-5 payload")
					}
					permissionDenials, _ := incoming["permission_denials"].([]any)
					if len(permissionDenials) != 0 {
						return streamValidation{}, fmt.Errorf("invalid result permission_denials: expected empty array, got %d entries", len(permissionDenials))
					}
					result.ResultValidated = true
					result.ResultEvent = "result:success"
					result.ResultStructuredOutputValidated = true
					result.ResultStructuredOutputEvent = "result:success:structured_output"
					result.ResultUsageValidated = true
					result.ResultUsageEvent = "result:success:usage"
					result.ResultModelUsageValidated = true
					result.ResultModelUsageEvent = "result:success:modelUsage"
					result.ResultPermissionDenialsValidated = true
					result.ResultPermissionDenialsEvent = "result:success:permission_denials"
					result.ResultFastModeStateValidated = true
					result.ResultFastModeStateEvent = "result:success:fast_mode_state"
				} else if turn.behavior == "deny" {
					if strings.TrimSpace(asString(incoming["subtype"])) != "error_during_execution" {
						return streamValidation{}, fmt.Errorf("invalid deny result subtype: %s", asString(incoming["subtype"]))
					}
					if err := validateZeroUsageShape(incoming["usage"]); err != nil {
						return streamValidation{}, fmt.Errorf("invalid deny result usage: %w", err)
					}
					if err := validateZeroModelUsageShape(incoming["modelUsage"]); err != nil {
						return streamValidation{}, fmt.Errorf("invalid deny result modelUsage: %w", err)
					}
					if permissionDenials, _ := incoming["permission_denials"].([]any); len(permissionDenials) == 0 {
						return streamValidation{}, fmt.Errorf("invalid deny result: missing permission_denials")
					} else {
						denial, _ := permissionDenials[0].(map[string]any)
						if strings.TrimSpace(asString(denial["tool_name"])) != "echo" {
							return streamValidation{}, fmt.Errorf("invalid deny result tool_name: %q", strings.TrimSpace(asString(denial["tool_name"])))
						}
						if strings.TrimSpace(asString(denial["tool_use_id"])) != currentToolUseID {
							return streamValidation{}, fmt.Errorf("invalid deny result tool_use_id: expected %q, got %q", currentToolUseID, strings.TrimSpace(asString(denial["tool_use_id"])))
						}
						toolInput, _ := denial["tool_input"].(map[string]any)
						if strings.TrimSpace(asString(toolInput["text"])) != turn.prompt {
							return streamValidation{}, fmt.Errorf("invalid deny result tool_input.text: expected %q, got %q", turn.prompt, strings.TrimSpace(asString(toolInput["text"])))
						}
					}
					if errorsList, _ := incoming["errors"].([]any); len(errorsList) == 0 {
						return streamValidation{}, fmt.Errorf("invalid deny result: missing errors")
					}
					if intFromAny(incoming["num_turns"]) != result.ValidatedTurns {
						return streamValidation{}, fmt.Errorf("invalid deny result: expected num_turns=%d, got %d", result.ValidatedTurns, intFromAny(incoming["num_turns"]))
					}
					if isError, ok := incoming["is_error"].(bool); !ok || !isError {
						return streamValidation{}, fmt.Errorf("invalid deny result: expected is_error=true")
					}
					result.ResultErrorValidated = true
					result.ResultErrorEvent = "result:error_during_execution"
					result.ResultErrorUsageValidated = true
					result.ResultErrorUsageEvent = "result:error:usage"
					result.ResultErrorPermissionDenialsValidated = true
					result.ResultErrorPermissionDenialsEvent = "result:error:permission_denials"
					result.ResultErrorModelUsageValidated = true
					result.ResultErrorModelUsageEvent = "result:error:modelUsage"
					result.ResultErrorFastModeStateValidated = true
					result.ResultErrorFastModeStateEvent = "result:error_during_execution:fast_mode_state"
				} else if turn.behavior == "max_turns" {
					if strings.TrimSpace(asString(incoming["subtype"])) != "error_max_turns" {
						return streamValidation{}, fmt.Errorf("invalid max-turns result subtype: %s", asString(incoming["subtype"]))
					}
					if err := validateZeroUsageShape(incoming["usage"]); err != nil {
						return streamValidation{}, fmt.Errorf("invalid max-turns result usage: %w", err)
					}
					if err := validateZeroModelUsageShape(incoming["modelUsage"]); err != nil {
						return streamValidation{}, fmt.Errorf("invalid max-turns result modelUsage: %w", err)
					}
					if permissionDenials, _ := incoming["permission_denials"].([]any); len(permissionDenials) != 0 {
						return streamValidation{}, fmt.Errorf("invalid max-turns result permission_denials: expected empty array, got %d entries", len(permissionDenials))
					}
					if intFromAny(incoming["num_turns"]) != result.ValidatedTurns {
						return streamValidation{}, fmt.Errorf("invalid max-turns result: expected num_turns=%d, got %d", result.ValidatedTurns, intFromAny(incoming["num_turns"]))
					}
					if isError, ok := incoming["is_error"].(bool); !ok || !isError {
						return streamValidation{}, fmt.Errorf("invalid max-turns result: expected is_error=true")
					}
					if strings.TrimSpace(asString(incoming["stop_reason"])) != "max_turns" {
						return streamValidation{}, fmt.Errorf("invalid max-turns result: expected stop_reason=max_turns, got %q", strings.TrimSpace(asString(incoming["stop_reason"])))
					}
					result.ResultErrorUsageValidated = true
					result.ResultErrorUsageEvent = "result:error:usage"
					result.ResultErrorPermissionDenialsValidated = true
					result.ResultErrorPermissionDenialsEvent = "result:error:permission_denials"
					result.ResultErrorModelUsageValidated = true
					result.ResultErrorModelUsageEvent = "result:error:modelUsage"
					result.ResultErrorMaxTurnsValidated = true
					result.ResultErrorMaxTurnsEvent = "result:error_max_turns"
					result.ResultErrorMaxTurnsFastModeStateValidated = true
					result.ResultErrorMaxTurnsFastModeStateEvent = "result:error_max_turns:fast_mode_state"
				} else if turn.behavior == "max_budget_usd" {
					if strings.TrimSpace(asString(incoming["subtype"])) != "error_max_budget_usd" {
						return streamValidation{}, fmt.Errorf("invalid max-budget-usd result subtype: %s", asString(incoming["subtype"]))
					}
					if err := validateZeroUsageShape(incoming["usage"]); err != nil {
						return streamValidation{}, fmt.Errorf("invalid max-budget-usd result usage: %w", err)
					}
					if err := validateZeroModelUsageShape(incoming["modelUsage"]); err != nil {
						return streamValidation{}, fmt.Errorf("invalid max-budget-usd result modelUsage: %w", err)
					}
					if permissionDenials, _ := incoming["permission_denials"].([]any); len(permissionDenials) != 0 {
						return streamValidation{}, fmt.Errorf("invalid max-budget-usd result permission_denials: expected empty array, got %d entries", len(permissionDenials))
					}
					if intFromAny(incoming["num_turns"]) != result.ValidatedTurns {
						return streamValidation{}, fmt.Errorf("invalid max-budget-usd result: expected num_turns=%d, got %d", result.ValidatedTurns, intFromAny(incoming["num_turns"]))
					}
					if isError, ok := incoming["is_error"].(bool); !ok || !isError {
						return streamValidation{}, fmt.Errorf("invalid max-budget-usd result: expected is_error=true")
					}
					if strings.TrimSpace(asString(incoming["stop_reason"])) != "max_budget_usd" {
						return streamValidation{}, fmt.Errorf("invalid max-budget-usd result: expected stop_reason=max_budget_usd, got %q", strings.TrimSpace(asString(incoming["stop_reason"])))
					}
					result.ResultErrorUsageValidated = true
					result.ResultErrorUsageEvent = "result:error:usage"
					result.ResultErrorPermissionDenialsValidated = true
					result.ResultErrorPermissionDenialsEvent = "result:error:permission_denials"
					result.ResultErrorModelUsageValidated = true
					result.ResultErrorModelUsageEvent = "result:error:modelUsage"
					result.ResultErrorMaxBudgetUSDValidated = true
					result.ResultErrorMaxBudgetUSDEvent = "result:error_max_budget_usd"
					result.ResultErrorMaxBudgetUSDFastModeStateValidated = true
					result.ResultErrorMaxBudgetUSDFastModeStateEvent = "result:error_max_budget_usd:fast_mode_state"
				} else {
					if strings.TrimSpace(asString(incoming["subtype"])) != "error_max_structured_output_retries" {
						return streamValidation{}, fmt.Errorf("invalid max-structured-output-retries result subtype: %s", asString(incoming["subtype"]))
					}
					if err := validateZeroUsageShape(incoming["usage"]); err != nil {
						return streamValidation{}, fmt.Errorf("invalid max-structured-output-retries result usage: %w", err)
					}
					if err := validateZeroModelUsageShape(incoming["modelUsage"]); err != nil {
						return streamValidation{}, fmt.Errorf("invalid max-structured-output-retries result modelUsage: %w", err)
					}
					if permissionDenials, _ := incoming["permission_denials"].([]any); len(permissionDenials) != 0 {
						return streamValidation{}, fmt.Errorf("invalid max-structured-output-retries result permission_denials: expected empty array, got %d entries", len(permissionDenials))
					}
					if intFromAny(incoming["num_turns"]) != result.ValidatedTurns {
						return streamValidation{}, fmt.Errorf("invalid max-structured-output-retries result: expected num_turns=%d, got %d", result.ValidatedTurns, intFromAny(incoming["num_turns"]))
					}
					if isError, ok := incoming["is_error"].(bool); !ok || !isError {
						return streamValidation{}, fmt.Errorf("invalid max-structured-output-retries result: expected is_error=true")
					}
					if strings.TrimSpace(asString(incoming["stop_reason"])) != "max_structured_output_retries" {
						return streamValidation{}, fmt.Errorf("invalid max-structured-output-retries result: expected stop_reason=max_structured_output_retries, got %q", strings.TrimSpace(asString(incoming["stop_reason"])))
					}
					result.ResultErrorUsageValidated = true
					result.ResultErrorUsageEvent = "result:error:usage"
					result.ResultErrorPermissionDenialsValidated = true
					result.ResultErrorPermissionDenialsEvent = "result:error:permission_denials"
					result.ResultErrorModelUsageValidated = true
					result.ResultErrorModelUsageEvent = "result:error:modelUsage"
					result.ResultErrorMaxStructuredOutputRetriesValidated = true
					result.ResultErrorMaxStructuredOutputRetriesEvent = "result:error_max_structured_output_retries"
					result.ResultErrorMaxStructuredOutputRetriesFastModeStateValidated = true
					result.ResultErrorMaxStructuredOutputRetriesFastModeStateEvent = "result:error_max_structured_output_retries:fast_mode_state"
				}
				resultValidated = true
			}
			if turn.behavior == "allow" && assistantValidated && resultValidated && taskStartedValidated && taskProgressValidated && taskNotificationValidated && queuedCommandValidated && filesPersistedValidated && apiRetryValidated && localCommandOutputValidated && elicitationCompleteValidated && postTurnSummaryValidated && compactionReminderValidated && contextEfficiencyValidated && autoModeExitValidated && planModeValidated && planModeExitValidated && planModeReentryValidated && dateChangeValidated && ultrathinkEffortValidated && deferredToolsDeltaValidated && agentListingDeltaValidated && mcpInstructionsDeltaValidated && companionIntroValidated && tokenUsageValidated && outputTokenUsageValidated && verifyPlanReminderValidated && compactBoundaryValidated && statusCompactingValidated && statusClearedValidated && sessionStateIdleValidated && hookStartedValidated && hookProgressValidated && hookResponseValidated && thinkingDeltaValidated && thinkingSignatureValidated && toolUseBlockStartValidated && toolUseDeltaValidated && toolUseBlockStopValidated && assistantMessageStartValidated && assistantMessageDeltaValidated && assistantMessageStopValidated && assistantThinkingValidated && assistantToolUseValidated && assistantStopReasonValidated && assistantUsageValidated && structuredOutputAttachmentValidated && taskReminderAttachmentValidated && streamlinedTextValidated && streamlinedToolUseSummaryValidated && promptSuggestionValidated {
				break
			}
			if turn.behavior == "deny" && resultValidated {
				break
			}
			if turn.behavior == "max_turns" && resultValidated && maxTurnsReachedAttachmentValidated {
				break
			}
			if turn.behavior == "max_budget_usd" && resultValidated {
				break
			}
			if turn.behavior == "max_structured_output_retries" && resultValidated {
				break
			}
		}
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedUserMessageValidated {
		return streamValidation{}, fmt.Errorf("missing replayed user message during resume validation")
	}
	if opts.PrintMode && !result.CompactSummaryValidated {
		return streamValidation{}, fmt.Errorf("missing compact summary user message during print validation")
	}
	if opts.PrintMode && !result.CompactSummarySyntheticValidated {
		return streamValidation{}, fmt.Errorf("missing compact summary isSynthetic validation during print validation")
	}
	if opts.PrintMode && !result.CompactSummaryTimestampValidated {
		return streamValidation{}, fmt.Errorf("missing compact summary timestamp validation during print validation")
	}
	if opts.PrintMode && !result.CompactSummaryParentToolUseIDValidated {
		return streamValidation{}, fmt.Errorf("missing compact summary parent_tool_use_id validation during print validation")
	}
	if opts.PrintMode && strings.TrimSpace(opts.ResumeSessionID) == "" && !result.AckedInitialUserReplayValidated {
		return streamValidation{}, fmt.Errorf("missing initial user ack replay during fresh print validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedUserTimestampValidated {
		return streamValidation{}, fmt.Errorf("missing replayed user timestamp validation during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedUserParentToolUseIDValidated {
		return streamValidation{}, fmt.Errorf("missing replayed user parent_tool_use_id validation during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedQueuedCommandValidated {
		return streamValidation{}, fmt.Errorf("missing replayed queued_command during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedQueuedCommandSyntheticValidated {
		return streamValidation{}, fmt.Errorf("missing replayed queued_command isSynthetic validation during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedQueuedCommandTimestampValidated {
		return streamValidation{}, fmt.Errorf("missing replayed queued_command timestamp validation during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedQueuedCommandParentToolUseIDValidated {
		return streamValidation{}, fmt.Errorf("missing replayed queued_command parent_tool_use_id validation during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedToolResultValidated {
		return streamValidation{}, fmt.Errorf("missing replayed tool_result message during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedToolResultSyntheticValidated {
		return streamValidation{}, fmt.Errorf("missing replayed tool_result isSynthetic validation during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedToolResultTimestampValidated {
		return streamValidation{}, fmt.Errorf("missing replayed tool_result timestamp validation during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedToolResultParentToolUseIDValidated {
		return streamValidation{}, fmt.Errorf("missing replayed tool_result parent_tool_use_id validation during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedAssistantMessageValidated {
		return streamValidation{}, fmt.Errorf("missing replayed assistant message during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedCompactBoundaryValidated {
		return streamValidation{}, fmt.Errorf("missing replayed compact_boundary during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedCompactBoundaryPreservedSegmentValidated {
		return streamValidation{}, fmt.Errorf("missing replayed compact_boundary preserved_segment during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedUserSyntheticValidated {
		return streamValidation{}, fmt.Errorf("missing replayed user isSynthetic validation during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedLocalCommandBreadcrumbValidated {
		return streamValidation{}, fmt.Errorf("missing replayed local-command breadcrumb during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedLocalCommandBreadcrumbSyntheticValidated {
		return streamValidation{}, fmt.Errorf("missing replayed local-command breadcrumb isSynthetic validation during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedLocalCommandBreadcrumbTimestampValidated {
		return streamValidation{}, fmt.Errorf("missing replayed local-command breadcrumb timestamp validation during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedLocalCommandBreadcrumbParentToolUseIDValidated {
		return streamValidation{}, fmt.Errorf("missing replayed local-command breadcrumb parent_tool_use_id validation during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedLocalCommandStderrBreadcrumbValidated {
		return streamValidation{}, fmt.Errorf("missing replayed local-command stderr breadcrumb during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedLocalCommandStderrBreadcrumbSyntheticValidated {
		return streamValidation{}, fmt.Errorf("missing replayed local-command stderr breadcrumb isSynthetic validation during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedLocalCommandStderrBreadcrumbTimestampValidated {
		return streamValidation{}, fmt.Errorf("missing replayed local-command stderr breadcrumb timestamp validation during resume validation")
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" && !result.ReplayedLocalCommandStderrBreadcrumbParentToolUseIDValidated {
		return streamValidation{}, fmt.Errorf("missing replayed local-command stderr breadcrumb parent_tool_use_id validation during resume validation")
	}
	result.MultiTurnValidated = result.ValidatedTurns >= 2

	interruptID := "interrupt-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": interruptID,
		"request": map[string]any{
			"subtype": "interrupt",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect interrupt request: %w", err)
	}
	for !result.InterruptValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect interrupt flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) == interruptID {
			result.InterruptValidated = true
		}
	}
	setModelID := "set-model-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": setModelID,
		"request": map[string]any{
			"subtype": "set_model",
			"model":   "claude-sonnet-4-5",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect set_model request: %w", err)
	}
	for !result.SetModelValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect set_model flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) == setModelID {
			result.SetModelValidated = true
			result.SetModelEvent = "control_request:set_model"
		}
	}
	setPermissionModeID := "set-permission-mode-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": setPermissionModeID,
		"request": map[string]any{
			"subtype": "set_permission_mode",
			"mode":    "acceptEdits",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect set_permission_mode request: %w", err)
	}
	for !result.SetPermissionModeValidated || !result.StatusTransitionValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect set_permission_mode flow: %w", err)
		}
		switch strings.TrimSpace(asString(incoming["type"])) {
		case "control_response":
			response, _ := incoming["response"].(map[string]any)
			if strings.TrimSpace(asString(response["request_id"])) == setPermissionModeID {
				result.SetPermissionModeValidated = true
				result.SetPermissionModeEvent = "control_request:set_permission_mode"
			}
		case "system":
			if !result.SetPermissionModeValidated || strings.TrimSpace(asString(incoming["subtype"])) != "status" {
				continue
			}
			if strings.TrimSpace(asString(incoming["session_id"])) == "" {
				return streamValidation{}, fmt.Errorf("invalid set_permission_mode status transition: missing session_id")
			}
			if strings.TrimSpace(asString(incoming["uuid"])) == "" {
				return streamValidation{}, fmt.Errorf("invalid set_permission_mode status transition: missing uuid")
			}
			if strings.TrimSpace(asString(incoming["permissionMode"])) != "acceptEdits" {
				return streamValidation{}, fmt.Errorf("invalid set_permission_mode status transition: expected permissionMode=%q, got %q", "acceptEdits", strings.TrimSpace(asString(incoming["permissionMode"])))
			}
			if strings.TrimSpace(asString(incoming["status"])) == "" {
				return streamValidation{}, fmt.Errorf("invalid set_permission_mode status transition: missing status")
			}
			result.StatusTransitionValidated = true
			result.StatusTransitionEvent = "system:status"
		}
	}
	setMaxThinkingTokensID := "set-max-thinking-tokens-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": setMaxThinkingTokensID,
		"request": map[string]any{
			"subtype":             "set_max_thinking_tokens",
			"max_thinking_tokens": 2048,
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect set_max_thinking_tokens request: %w", err)
	}
	for !result.SetMaxThinkingTokensValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect set_max_thinking_tokens flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) == setMaxThinkingTokensID {
			result.SetMaxThinkingTokensValidated = true
			result.SetMaxThinkingTokensEvent = "control_request:set_max_thinking_tokens"
		}
	}
	mcpStatusID := "mcp-status-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": mcpStatusID,
		"request": map[string]any{
			"subtype": "mcp_status",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect mcp_status request: %w", err)
	}
	for !result.MCPStatusValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect mcp_status flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != mcpStatusID {
			continue
		}
		responsePayload, _ := response["response"].(map[string]any)
		mcpServers, ok := responsePayload["mcpServers"].([]any)
		if !ok {
			return streamValidation{}, fmt.Errorf("invalid mcp_status response: missing mcpServers")
		}
		if len(mcpServers) != 0 {
			return streamValidation{}, fmt.Errorf("invalid mcp_status response: expected empty mcpServers, got %d", len(mcpServers))
		}
		result.MCPStatusValidated = true
		result.MCPStatusEvent = "control_request:mcp_status"
	}
	getContextUsageID := "get-context-usage-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": getContextUsageID,
		"request": map[string]any{
			"subtype": "get_context_usage",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect get_context_usage request: %w", err)
	}
	for !result.GetContextUsageValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect get_context_usage flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != getContextUsageID {
			continue
		}
		responsePayload, _ := response["response"].(map[string]any)
		if _, ok := responsePayload["categories"].([]any); !ok {
			return streamValidation{}, fmt.Errorf("invalid get_context_usage response: missing categories")
		}
		if intFromAny(responsePayload["totalTokens"]) != 0 || intFromAny(responsePayload["maxTokens"]) != 0 || intFromAny(responsePayload["rawMaxTokens"]) != 0 || intFromAny(responsePayload["percentage"]) != 0 {
			return streamValidation{}, fmt.Errorf("invalid get_context_usage response: expected zero totals")
		}
		if _, ok := responsePayload["gridRows"].([]any); !ok {
			return streamValidation{}, fmt.Errorf("invalid get_context_usage response: missing gridRows")
		}
		if strings.TrimSpace(asString(responsePayload["model"])) == "" {
			return streamValidation{}, fmt.Errorf("invalid get_context_usage response: missing model")
		}
		if _, ok := responsePayload["memoryFiles"].([]any); !ok {
			return streamValidation{}, fmt.Errorf("invalid get_context_usage response: missing memoryFiles")
		}
		if _, ok := responsePayload["mcpTools"].([]any); !ok {
			return streamValidation{}, fmt.Errorf("invalid get_context_usage response: missing mcpTools")
		}
		if _, ok := responsePayload["agents"].([]any); !ok {
			return streamValidation{}, fmt.Errorf("invalid get_context_usage response: missing agents")
		}
		if isAutoCompactEnabled, ok := responsePayload["isAutoCompactEnabled"].(bool); !ok || isAutoCompactEnabled {
			return streamValidation{}, fmt.Errorf("invalid get_context_usage response: expected isAutoCompactEnabled=false")
		}
		if responsePayload["apiUsage"] != nil {
			return streamValidation{}, fmt.Errorf("invalid get_context_usage response: expected apiUsage=null")
		}
		result.GetContextUsageValidated = true
		result.GetContextUsageEvent = "control_request:get_context_usage"
	}
	mcpMessageID := "mcp-message-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": mcpMessageID,
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
		return streamValidation{}, fmt.Errorf("write direct-connect mcp_message request: %w", err)
	}
	for !result.MCPMessageValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect mcp_message flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) == mcpMessageID {
			result.MCPMessageValidated = true
			result.MCPMessageEvent = "control_request:mcp_message"
		}
	}
	mcpSetServersID := "mcp-set-servers-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": mcpSetServersID,
		"request": map[string]any{
			"subtype": "mcp_set_servers",
			"servers": map[string]any{},
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect mcp_set_servers request: %w", err)
	}
	for !result.MCPSetServersValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect mcp_set_servers flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != mcpSetServersID {
			continue
		}
		responsePayload, _ := response["response"].(map[string]any)
		added, ok := responsePayload["added"].([]any)
		if !ok || len(added) != 0 {
			return streamValidation{}, fmt.Errorf("invalid mcp_set_servers response: expected empty added")
		}
		removed, ok := responsePayload["removed"].([]any)
		if !ok || len(removed) != 0 {
			return streamValidation{}, fmt.Errorf("invalid mcp_set_servers response: expected empty removed")
		}
		errorsMap, ok := responsePayload["errors"].(map[string]any)
		if !ok || len(errorsMap) != 0 {
			return streamValidation{}, fmt.Errorf("invalid mcp_set_servers response: expected empty errors")
		}
		result.MCPSetServersValidated = true
		result.MCPSetServersEvent = "control_request:mcp_set_servers"
	}
	reloadPluginsID := "reload-plugins-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": reloadPluginsID,
		"request": map[string]any{
			"subtype": "reload_plugins",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect reload_plugins request: %w", err)
	}
	for !result.ReloadPluginsValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect reload_plugins flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != reloadPluginsID {
			continue
		}
		responsePayload, _ := response["response"].(map[string]any)
		commands, ok := responsePayload["commands"].([]any)
		if !ok || len(commands) != 0 {
			return streamValidation{}, fmt.Errorf("invalid reload_plugins response: expected empty commands")
		}
		agents, ok := responsePayload["agents"].([]any)
		if !ok || len(agents) != 0 {
			return streamValidation{}, fmt.Errorf("invalid reload_plugins response: expected empty agents")
		}
		plugins, ok := responsePayload["plugins"].([]any)
		if !ok || len(plugins) != 0 {
			return streamValidation{}, fmt.Errorf("invalid reload_plugins response: expected empty plugins")
		}
		mcpServers, ok := responsePayload["mcpServers"].([]any)
		if !ok || len(mcpServers) != 0 {
			return streamValidation{}, fmt.Errorf("invalid reload_plugins response: expected empty mcpServers")
		}
		errorCount, ok := responsePayload["error_count"].(float64)
		if !ok || int(errorCount) != 0 {
			return streamValidation{}, fmt.Errorf("invalid reload_plugins response: expected error_count=0")
		}
		result.ReloadPluginsValidated = true
		result.ReloadPluginsEvent = "control_request:reload_plugins"
	}
	mcpAuthMissingID := "mcp-authenticate-missing-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": mcpAuthMissingID,
		"request": map[string]any{
			"subtype":    "mcp_authenticate",
			"serverName": "missing-mcp",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect mcp_authenticate missing request: %w", err)
	}
	mcpAuthMissingValidated := false
	for !mcpAuthMissingValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect mcp_authenticate missing flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != mcpAuthMissingID {
			continue
		}
		if strings.TrimSpace(asString(response["subtype"])) != "error" {
			return streamValidation{}, fmt.Errorf("invalid mcp_authenticate missing response subtype: %s", asString(response["subtype"]))
		}
		if strings.TrimSpace(asString(response["error"])) != "Server not found: missing-mcp" {
			return streamValidation{}, fmt.Errorf("invalid mcp_authenticate missing error: %s", asString(response["error"]))
		}
		mcpAuthMissingValidated = true
	}
	mcpAuthUnsupportedID := "mcp-authenticate-unsupported-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": mcpAuthUnsupportedID,
		"request": map[string]any{
			"subtype":    "mcp_authenticate",
			"serverName": "demo-stdio-mcp",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect mcp_authenticate unsupported request: %w", err)
	}
	mcpAuthUnsupportedValidated := false
	for !mcpAuthUnsupportedValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect mcp_authenticate unsupported flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != mcpAuthUnsupportedID {
			continue
		}
		if strings.TrimSpace(asString(response["subtype"])) != "error" {
			return streamValidation{}, fmt.Errorf("invalid mcp_authenticate unsupported response subtype: %s", asString(response["subtype"]))
		}
		if strings.TrimSpace(asString(response["error"])) != `Server type "stdio" does not support OAuth authentication` {
			return streamValidation{}, fmt.Errorf("invalid mcp_authenticate unsupported error: %s", asString(response["error"]))
		}
		mcpAuthUnsupportedValidated = true
	}
	mcpAuthSuccessID := "mcp-authenticate-success-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": mcpAuthSuccessID,
		"request": map[string]any{
			"subtype":    "mcp_authenticate",
			"serverName": "demo-http-mcp",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect mcp_authenticate success request: %w", err)
	}
	for !result.MCPAuthenticateValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect mcp_authenticate success flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != mcpAuthSuccessID {
			continue
		}
		if strings.TrimSpace(asString(response["subtype"])) != "success" {
			return streamValidation{}, fmt.Errorf("invalid mcp_authenticate success response subtype: %s", asString(response["subtype"]))
		}
		responsePayload, _ := response["response"].(map[string]any)
		requiresUserAction, ok := responsePayload["requiresUserAction"].(bool)
		if !ok || !requiresUserAction {
			return streamValidation{}, fmt.Errorf("invalid mcp_authenticate success response: missing requiresUserAction=true")
		}
		if strings.TrimSpace(asString(responsePayload["authUrl"])) != "https://example.test/oauth/demo-http-mcp" {
			return streamValidation{}, fmt.Errorf("invalid mcp_authenticate success response: unexpected authUrl")
		}
		result.MCPAuthenticateValidated = true
		result.MCPAuthenticateEvent = "control_request:mcp_authenticate"
	}
	mcpOAuthCallbackMissingFlowID := "mcp-oauth-callback-missing-flow-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": mcpOAuthCallbackMissingFlowID,
		"request": map[string]any{
			"subtype":     "mcp_oauth_callback_url",
			"serverName":  "demo-sse-mcp",
			"callbackUrl": "https://example.test/callback?code=demo-code",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect mcp_oauth_callback_url missing-flow request: %w", err)
	}
	mcpOAuthMissingFlowValidated := false
	for !mcpOAuthMissingFlowValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect mcp_oauth_callback_url missing-flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != mcpOAuthCallbackMissingFlowID {
			continue
		}
		if strings.TrimSpace(asString(response["subtype"])) != "error" {
			return streamValidation{}, fmt.Errorf("invalid mcp_oauth_callback_url missing-flow response subtype: %s", asString(response["subtype"]))
		}
		if strings.TrimSpace(asString(response["error"])) != "No active OAuth flow for server: demo-sse-mcp" {
			return streamValidation{}, fmt.Errorf("invalid mcp_oauth_callback_url missing-flow error: %s", asString(response["error"]))
		}
		mcpOAuthMissingFlowValidated = true
	}
	mcpAuthCallbackPrepID := "mcp-authenticate-callback-prep-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": mcpAuthCallbackPrepID,
		"request": map[string]any{
			"subtype":    "mcp_authenticate",
			"serverName": "demo-sse-mcp",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect mcp_authenticate callback prep request: %w", err)
	}
	mcpAuthCallbackPrepValidated := false
	for !mcpAuthCallbackPrepValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect mcp_authenticate callback prep flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != mcpAuthCallbackPrepID {
			continue
		}
		if strings.TrimSpace(asString(response["subtype"])) != "success" {
			return streamValidation{}, fmt.Errorf("invalid mcp_authenticate callback prep subtype: %s", asString(response["subtype"]))
		}
		mcpAuthCallbackPrepValidated = true
	}
	mcpOAuthCallbackInvalidID := "mcp-oauth-callback-invalid-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": mcpOAuthCallbackInvalidID,
		"request": map[string]any{
			"subtype":     "mcp_oauth_callback_url",
			"serverName":  "demo-sse-mcp",
			"callbackUrl": "https://example.test/callback?state=demo-state",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect mcp_oauth_callback_url invalid request: %w", err)
	}
	mcpOAuthInvalidValidated := false
	for !mcpOAuthInvalidValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect mcp_oauth_callback_url invalid flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != mcpOAuthCallbackInvalidID {
			continue
		}
		if strings.TrimSpace(asString(response["subtype"])) != "error" {
			return streamValidation{}, fmt.Errorf("invalid mcp_oauth_callback_url invalid response subtype: %s", asString(response["subtype"]))
		}
		if strings.TrimSpace(asString(response["error"])) != "Invalid callback URL: missing authorization code. Please paste the full redirect URL including the code parameter." {
			return streamValidation{}, fmt.Errorf("invalid mcp_oauth_callback_url invalid error: %s", asString(response["error"]))
		}
		mcpOAuthInvalidValidated = true
	}
	mcpOAuthCallbackSuccessID := "mcp-oauth-callback-success-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": mcpOAuthCallbackSuccessID,
		"request": map[string]any{
			"subtype":     "mcp_oauth_callback_url",
			"serverName":  "demo-sse-mcp",
			"callbackUrl": "https://example.test/callback?code=demo-code&state=demo-state",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect mcp_oauth_callback_url success request: %w", err)
	}
	for !result.MCPOAuthCallbackURLValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect mcp_oauth_callback_url success flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != mcpOAuthCallbackSuccessID {
			continue
		}
		if strings.TrimSpace(asString(response["subtype"])) != "success" {
			return streamValidation{}, fmt.Errorf("invalid mcp_oauth_callback_url success response subtype: %s", asString(response["subtype"]))
		}
		responsePayload, _ := response["response"].(map[string]any)
		if len(responsePayload) != 0 {
			return streamValidation{}, fmt.Errorf("invalid mcp_oauth_callback_url success response: expected empty payload")
		}
		result.MCPOAuthCallbackURLValidated = true
		result.MCPOAuthCallbackURLEvent = "control_request:mcp_oauth_callback_url"
	}
	mcpReconnectID := "mcp-reconnect-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": mcpReconnectID,
		"request": map[string]any{
			"subtype":    "mcp_reconnect",
			"serverName": "demo-mcp",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect mcp_reconnect request: %w", err)
	}
	for !result.MCPReconnectValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect mcp_reconnect flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != mcpReconnectID {
			continue
		}
		result.MCPReconnectValidated = true
		result.MCPReconnectEvent = "control_request:mcp_reconnect"
	}
	mcpToggleID := "mcp-toggle-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": mcpToggleID,
		"request": map[string]any{
			"subtype":    "mcp_toggle",
			"serverName": "demo-mcp",
			"enabled":    true,
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect mcp_toggle request: %w", err)
	}
	for !result.MCPToggleValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect mcp_toggle flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != mcpToggleID {
			continue
		}
		result.MCPToggleValidated = true
		result.MCPToggleEvent = "control_request:mcp_toggle"
	}
	seedReadStateID := "seed-read-state-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": seedReadStateID,
		"request": map[string]any{
			"subtype": "seed_read_state",
			"path":    "/tmp/missing.txt",
			"mtime":   123456789,
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect seed_read_state request: %w", err)
	}
	for !result.SeedReadStateValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect seed_read_state flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != seedReadStateID {
			continue
		}
		result.SeedReadStateValidated = true
		result.SeedReadStateEvent = "control_request:seed_read_state"
	}
	rewindFilesID := "rewind-files-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": rewindFilesID,
		"request": map[string]any{
			"subtype":         "rewind_files",
			"user_message_id": "user-msg-1",
			"dry_run":         true,
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect rewind_files request: %w", err)
	}
	for !result.RewindFilesValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect rewind_files flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != rewindFilesID {
			continue
		}
		responsePayload, _ := response["response"].(map[string]any)
		canRewind, ok := responsePayload["canRewind"].(bool)
		if !ok {
			return streamValidation{}, fmt.Errorf("invalid rewind_files response: missing canRewind")
		}
		filesChangedRaw, _ := responsePayload["filesChanged"].([]any)
		if len(filesChangedRaw) != 1 || strings.TrimSpace(asString(filesChangedRaw[0])) != "README.md" {
			return streamValidation{}, fmt.Errorf("invalid rewind_files response: unexpected filesChanged=%#v", responsePayload["filesChanged"])
		}
		insertions, ok := responsePayload["insertions"].(float64)
		if !ok {
			return streamValidation{}, fmt.Errorf("invalid rewind_files response: missing insertions")
		}
		deletions, ok := responsePayload["deletions"].(float64)
		if !ok {
			return streamValidation{}, fmt.Errorf("invalid rewind_files response: missing deletions")
		}
		result.RewindFilesValidated = true
		result.RewindFilesEvent = "control_request:rewind_files"
		result.RewindFilesCanRewind = canRewind
		result.RewindFilesFilesChanged = len(filesChangedRaw)
		result.RewindFilesInsertions = int(insertions)
		result.RewindFilesDeletions = int(deletions)
		if errText := strings.TrimSpace(asString(responsePayload["error"])); errText != "" {
			result.RewindFilesError = errText
		}
	}
	cancelAsyncMessageID := "cancel-async-message-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": cancelAsyncMessageID,
		"request": map[string]any{
			"subtype":      "cancel_async_message",
			"message_uuid": "async-msg-1",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect cancel_async_message request: %w", err)
	}
	for !result.CancelAsyncMessageValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect cancel_async_message flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != cancelAsyncMessageID {
			continue
		}
		responsePayload, _ := response["response"].(map[string]any)
		cancelled, ok := responsePayload["cancelled"].(bool)
		if !ok {
			return streamValidation{}, fmt.Errorf("invalid cancel_async_message response: missing cancelled")
		}
		if cancelled {
			return streamValidation{}, fmt.Errorf("invalid cancel_async_message response: expected cancelled=false")
		}
		result.CancelAsyncMessageValidated = true
		result.CancelAsyncMessageEvent = "control_request:cancel_async_message"
	}
	stopTaskID := "stop-task-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": stopTaskID,
		"request": map[string]any{
			"subtype": "stop_task",
			"task_id": "task-1",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect stop_task request: %w", err)
	}
	for !result.StopTaskValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect stop_task flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) == stopTaskID {
			result.StopTaskValidated = true
			result.StopTaskEvent = "control_request:stop_task"
		}
	}
	applyFlagSettingsID := "apply-flag-settings-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": applyFlagSettingsID,
		"request": map[string]any{
			"subtype": "apply_flag_settings",
			"settings": map[string]any{
				"model": "claude-sonnet-4-5",
			},
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect apply_flag_settings request: %w", err)
	}
	for !result.ApplyFlagSettingsValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect apply_flag_settings flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) == applyFlagSettingsID {
			result.ApplyFlagSettingsValidated = true
			result.ApplyFlagSettingsEvent = "control_request:apply_flag_settings"
		}
	}
	getSettingsID := "get-settings-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": getSettingsID,
		"request": map[string]any{
			"subtype": "get_settings",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect get_settings request: %w", err)
	}
	for !result.GetSettingsValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect get_settings flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != getSettingsID {
			continue
		}
		responsePayload, _ := response["response"].(map[string]any)
		effective, ok := responsePayload["effective"].(map[string]any)
		if !ok || len(effective) != 0 {
			return streamValidation{}, fmt.Errorf("invalid get_settings response: expected empty effective")
		}
		sources, ok := responsePayload["sources"].([]any)
		if !ok || len(sources) != 0 {
			return streamValidation{}, fmt.Errorf("invalid get_settings response: expected empty sources")
		}
		applied, ok := responsePayload["applied"].(map[string]any)
		if !ok {
			return streamValidation{}, fmt.Errorf("invalid get_settings response: missing applied")
		}
		if strings.TrimSpace(asString(applied["model"])) == "" {
			return streamValidation{}, fmt.Errorf("invalid get_settings response: missing applied.model")
		}
		if applied["effort"] != nil {
			return streamValidation{}, fmt.Errorf("invalid get_settings response: expected applied.effort=null")
		}
		result.GetSettingsValidated = true
		result.GetSettingsEvent = "control_request:get_settings"
	}
	generateSessionTitleID := "generate-session-title-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": generateSessionTitleID,
		"request": map[string]any{
			"subtype":     "generate_session_title",
			"description": "summarize this session",
			"persist":     false,
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect generate_session_title request: %w", err)
	}
	for !result.GenerateSessionTitleValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect generate_session_title flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != generateSessionTitleID {
			continue
		}
		responsePayload, _ := response["response"].(map[string]any)
		if strings.TrimSpace(asString(responsePayload["title"])) == "" {
			return streamValidation{}, fmt.Errorf("invalid generate_session_title response: missing title")
		}
		result.GenerateSessionTitleValidated = true
		result.GenerateSessionTitleEvent = "control_request:generate_session_title"
	}
	sideQuestionID := "side-question-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": sideQuestionID,
		"request": map[string]any{
			"subtype":  "side_question",
			"question": "what is the summary?",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect side_question request: %w", err)
	}
	for !result.SideQuestionValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect side_question flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != sideQuestionID {
			continue
		}
		responsePayload, _ := response["response"].(map[string]any)
		if strings.TrimSpace(asString(responsePayload["response"])) == "" {
			return streamValidation{}, fmt.Errorf("invalid side_question response: missing response")
		}
		result.SideQuestionValidated = true
		result.SideQuestionEvent = "control_request:side_question"
	}
	initializeID := "initialize-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": initializeID,
		"request": map[string]any{
			"subtype": "initialize",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect initialize request: %w", err)
	}
	for !result.InitializeValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect initialize flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != initializeID {
			continue
		}
		responsePayload, _ := response["response"].(map[string]any)
		availableOutputStyles, _ := responsePayload["available_output_styles"].([]any)
		accountPayload, _ := responsePayload["account"].(map[string]any)
		if _, ok := responsePayload["commands"].([]any); !ok || strings.TrimSpace(asString(responsePayload["output_style"])) == "" || len(availableOutputStyles) == 0 {
			return streamValidation{}, fmt.Errorf("invalid initialize response: missing commands/output_style/available_output_styles")
		}
		if _, ok := responsePayload["agents"].([]any); !ok {
			return streamValidation{}, fmt.Errorf("invalid initialize response: missing agents")
		}
		if _, ok := responsePayload["models"].([]any); !ok {
			return streamValidation{}, fmt.Errorf("invalid initialize response: missing models")
		}
		if strings.TrimSpace(asString(accountPayload["apiProvider"])) == "" {
			return streamValidation{}, fmt.Errorf("invalid initialize response: missing account.apiProvider")
		}
		result.InitializeValidated = true
		result.InitializeEvent = "control_request:initialize"
	}
	elicitationID := "elicitation-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": elicitationID,
		"request": map[string]any{
			"subtype":         "elicitation",
			"mcp_server_name": "demo-mcp",
			"message":         "Need more input",
			"mode":            "form",
			"elicitation_id":  "eli-probe",
			"requested_schema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"answer": map[string]any{"type": "string"},
				},
			},
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect elicitation request: %w", err)
	}
	for !result.ElicitationValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect elicitation flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != elicitationID {
			continue
		}
		if strings.TrimSpace(asString(response["subtype"])) != "success" {
			return streamValidation{}, fmt.Errorf("invalid elicitation response subtype: %s", asString(response["subtype"]))
		}
		responsePayload, _ := response["response"].(map[string]any)
		if strings.TrimSpace(asString(responsePayload["action"])) != "cancel" {
			return streamValidation{}, fmt.Errorf("invalid elicitation response: expected action=cancel")
		}
		result.ElicitationValidated = true
		result.ElicitationEvent = "control_request:elicitation"
	}
	hookCallbackID := "hook-callback-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": hookCallbackID,
		"request": map[string]any{
			"subtype":     "hook_callback",
			"callback_id": "cb-probe",
			"tool_use_id": "tool-probe",
			"input": map[string]any{
				"session_id":        "hook-session",
				"transcript_path":   "/tmp/direct-connect-transcript.jsonl",
				"cwd":               "/tmp",
				"hook_event_name":   "Notification",
				"message":           "direct-connect hook callback",
				"notification_type": "info",
			},
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect hook_callback request: %w", err)
	}
	for !result.HookCallbackValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect hook_callback flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != hookCallbackID {
			continue
		}
		if strings.TrimSpace(asString(response["subtype"])) != "success" {
			return streamValidation{}, fmt.Errorf("invalid hook_callback response subtype: %s", asString(response["subtype"]))
		}
		result.HookCallbackValidated = true
		result.HookCallbackEvent = "control_request:hook_callback"
	}
	channelEnableID := "channel-enable-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": channelEnableID,
		"request": map[string]any{
			"subtype":    "channel_enable",
			"serverName": "demo-mcp",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect channel_enable request: %w", err)
	}
	for !result.ChannelEnableValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect channel_enable flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != channelEnableID {
			continue
		}
		if strings.TrimSpace(asString(response["subtype"])) != "success" {
			return streamValidation{}, fmt.Errorf("invalid channel_enable response subtype: %s", asString(response["subtype"]))
		}
		responsePayload, _ := response["response"].(map[string]any)
		if strings.TrimSpace(asString(responsePayload["serverName"])) != "demo-mcp" {
			return streamValidation{}, fmt.Errorf("invalid channel_enable response: missing echoed serverName")
		}
		result.ChannelEnableValidated = true
		result.ChannelEnableEvent = "control_request:channel_enable"
	}
	setProactiveID := "set-proactive-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": setProactiveID,
		"request": map[string]any{
			"subtype": "set_proactive",
			"enabled": true,
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect set_proactive request: %w", err)
	}
	for !result.SetProactiveValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect set_proactive flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) == setProactiveID {
			result.SetProactiveValidated = true
			result.SetProactiveEvent = "control_request:set_proactive"
		}
	}
	remoteControlEnableID := "remote-control-enable-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": remoteControlEnableID,
		"request": map[string]any{
			"subtype": "remote_control",
			"enabled": true,
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect remote_control enable request: %w", err)
	}
	for !result.RemoteControlValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect remote_control enable flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) == "system" && strings.TrimSpace(asString(incoming["subtype"])) == "bridge_state" {
			if strings.TrimSpace(asString(incoming["state"])) != "connected" {
				return streamValidation{}, fmt.Errorf("invalid bridge_state enable event state: %s", asString(incoming["state"]))
			}
			if strings.TrimSpace(asString(incoming["detail"])) != "stub remote control enabled" {
				return streamValidation{}, fmt.Errorf("invalid bridge_state enable event detail: %s", asString(incoming["detail"]))
			}
			result.BridgeStateValidated = true
			result.BridgeStateEvent = "system:bridge_state:connected"
			continue
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) != remoteControlEnableID {
			continue
		}
		responsePayload, _ := response["response"].(map[string]any)
		if strings.TrimSpace(asString(responsePayload["session_url"])) == "" || strings.TrimSpace(asString(responsePayload["connect_url"])) == "" || strings.TrimSpace(asString(responsePayload["environment_id"])) == "" {
			return streamValidation{}, fmt.Errorf("invalid remote_control enable response: missing session_url/connect_url/environment_id")
		}
		result.RemoteControlValidated = true
		result.RemoteControlEvent = "control_request:remote_control"
	}
	remoteControlDisableID := "remote-control-disable-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": remoteControlDisableID,
		"request": map[string]any{
			"subtype": "remote_control",
			"enabled": false,
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect remote_control disable request: %w", err)
	}
	remoteControlDisabled := false
	for !remoteControlDisabled {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect remote_control disable flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) == "system" && strings.TrimSpace(asString(incoming["subtype"])) == "bridge_state" {
			if strings.TrimSpace(asString(incoming["state"])) != "disconnected" {
				return streamValidation{}, fmt.Errorf("invalid bridge_state disable event state: %s", asString(incoming["state"]))
			}
			if strings.TrimSpace(asString(incoming["detail"])) != "stub remote control disabled" {
				return streamValidation{}, fmt.Errorf("invalid bridge_state disable event detail: %s", asString(incoming["detail"]))
			}
			continue
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) == remoteControlDisableID {
			if strings.TrimSpace(asString(response["subtype"])) != "success" {
				return streamValidation{}, fmt.Errorf("invalid remote_control disable response subtype: %s", asString(response["subtype"]))
			}
			responsePayload, _ := response["response"].(map[string]any)
			if strings.TrimSpace(asString(responsePayload["session_url"])) != "" || strings.TrimSpace(asString(responsePayload["connect_url"])) != "" || strings.TrimSpace(asString(responsePayload["environment_id"])) != "" {
				return streamValidation{}, fmt.Errorf("invalid remote_control disable response: expected stub reset payload to be empty")
			}
			remoteControlDisabled = true
		}
	}
	endSessionID := "end-session-probe"
	if err := conn.WriteJSON(map[string]any{
		"type":       "control_request",
		"request_id": endSessionID,
		"request": map[string]any{
			"subtype": "end_session",
			"reason":  "direct-connect validation complete",
		},
	}); err != nil {
		return streamValidation{}, fmt.Errorf("write direct-connect end_session request: %w", err)
	}
	for !result.EndSessionValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect end_session flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) == endSessionID {
			result.EndSessionValidated = true
			result.EndSessionEvent = "control_request:end_session"
		}
	}

	return result, nil
}

func buildWebsocketDial(rawWSURL, authToken string) (string, http.Header, *websocket.Dialer, error) {
	header := http.Header{}
	if strings.TrimSpace(authToken) != "" {
		header.Set("Authorization", "Bearer "+authToken)
	}

	if strings.HasPrefix(rawWSURL, "ws+unix://") {
		rest := strings.TrimPrefix(rawWSURL, "ws+unix://")
		socketPart, pathPart, _ := strings.Cut(rest, "/")
		socketPath, err := url.PathUnescape(socketPart)
		if err != nil {
			return "", nil, nil, fmt.Errorf("decode ws+unix socket path: %w", err)
		}
		if !strings.HasPrefix(socketPath, "/") {
			socketPath = "/" + socketPath
		}
		pathPart = "/" + strings.TrimPrefix(pathPart, "/")
		dialer := &websocket.Dialer{
			NetDialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
			HandshakeTimeout: 5 * time.Second,
		}
		return "ws://unix" + pathPart, header, dialer, nil
	}

	dialer := &websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	return rawWSURL, header, dialer, nil
}

func (r Result) String() string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("status=%s\n", r.Status))
	b.WriteString(fmt.Sprintf("action=%s\n", r.Action))
	b.WriteString(fmt.Sprintf("connect_url=%s\n", valueOrNone(r.ConnectURL)))
	b.WriteString(fmt.Sprintf("transport=%s\n", valueOrNone(r.Transport)))
	b.WriteString(fmt.Sprintf("server_url=%s\n", valueOrNone(r.ServerURL)))
	b.WriteString(fmt.Sprintf("auth_token_present=%t\n", strings.TrimSpace(r.AuthToken) != ""))
	b.WriteString(fmt.Sprintf("print_mode=%t\n", r.PrintMode))
	b.WriteString(fmt.Sprintf("print_prompt=%s\n", valueOrNone(r.PrintPrompt)))
	b.WriteString(fmt.Sprintf("output_format=%s\n", valueOrNone(r.OutputFormat)))
	b.WriteString(fmt.Sprintf("request_cwd=%s\n", valueOrNone(r.RequestCWD)))
	b.WriteString(fmt.Sprintf("session_id=%s\n", valueOrNone(r.SessionID)))
	b.WriteString(fmt.Sprintf("ws_url=%s\n", valueOrNone(r.WSURL)))
	b.WriteString(fmt.Sprintf("work_dir=%s\n", valueOrNone(r.WorkDir)))
	b.WriteString(fmt.Sprintf("stream_validated=%t\n", r.StreamValidated))
	b.WriteString(fmt.Sprintf("stream_event=%s\n", valueOrNone(r.StreamEvent)))
	b.WriteString(fmt.Sprintf("stream_content_validated=%t\n", r.StreamContentValidated))
	b.WriteString(fmt.Sprintf("stream_content_event=%s\n", valueOrNone(r.StreamContentEvent)))
	b.WriteString(fmt.Sprintf("thinking_delta_validated=%t\n", r.ThinkingDeltaValidated))
	b.WriteString(fmt.Sprintf("thinking_delta_event=%s\n", valueOrNone(r.ThinkingDeltaEvent)))
	b.WriteString(fmt.Sprintf("thinking_signature_validated=%t\n", r.ThinkingSignatureValidated))
	b.WriteString(fmt.Sprintf("thinking_signature_event=%s\n", valueOrNone(r.ThinkingSignatureEvent)))
	b.WriteString(fmt.Sprintf("tool_use_delta_validated=%t\n", r.ToolUseDeltaValidated))
	b.WriteString(fmt.Sprintf("tool_use_delta_event=%s\n", valueOrNone(r.ToolUseDeltaEvent)))
	b.WriteString(fmt.Sprintf("tool_use_block_start_validated=%t\n", r.ToolUseBlockStartValidated))
	b.WriteString(fmt.Sprintf("tool_use_block_start_event=%s\n", valueOrNone(r.ToolUseBlockStartEvent)))
	b.WriteString(fmt.Sprintf("tool_use_block_stop_validated=%t\n", r.ToolUseBlockStopValidated))
	b.WriteString(fmt.Sprintf("tool_use_block_stop_event=%s\n", valueOrNone(r.ToolUseBlockStopEvent)))
	b.WriteString(fmt.Sprintf("assistant_message_start_validated=%t\n", r.AssistantMessageStartValidated))
	b.WriteString(fmt.Sprintf("assistant_message_start_event=%s\n", valueOrNone(r.AssistantMessageStartEvent)))
	b.WriteString(fmt.Sprintf("assistant_message_delta_validated=%t\n", r.AssistantMessageDeltaValidated))
	b.WriteString(fmt.Sprintf("assistant_message_delta_event=%s\n", valueOrNone(r.AssistantMessageDeltaEvent)))
	b.WriteString(fmt.Sprintf("assistant_message_stop_validated=%t\n", r.AssistantMessageStopValidated))
	b.WriteString(fmt.Sprintf("assistant_message_stop_event=%s\n", valueOrNone(r.AssistantMessageStopEvent)))
	b.WriteString(fmt.Sprintf("assistant_thinking_validated=%t\n", r.AssistantThinkingValidated))
	b.WriteString(fmt.Sprintf("assistant_thinking_event=%s\n", valueOrNone(r.AssistantThinkingEvent)))
	b.WriteString(fmt.Sprintf("assistant_tool_use_validated=%t\n", r.AssistantToolUseValidated))
	b.WriteString(fmt.Sprintf("assistant_tool_use_event=%s\n", valueOrNone(r.AssistantToolUseEvent)))
	b.WriteString(fmt.Sprintf("assistant_stop_reason_validated=%t\n", r.AssistantStopReasonValidated))
	b.WriteString(fmt.Sprintf("assistant_stop_reason_event=%s\n", valueOrNone(r.AssistantStopReasonEvent)))
	b.WriteString(fmt.Sprintf("assistant_usage_validated=%t\n", r.AssistantUsageValidated))
	b.WriteString(fmt.Sprintf("assistant_usage_event=%s\n", valueOrNone(r.AssistantUsageEvent)))
	b.WriteString(fmt.Sprintf("structured_output_attachment_validated=%t\n", r.StructuredOutputAttachmentValidated))
	b.WriteString(fmt.Sprintf("structured_output_attachment_event=%s\n", valueOrNone(r.StructuredOutputAttachmentEvent)))
	b.WriteString(fmt.Sprintf("max_turns_reached_attachment_validated=%t\n", r.MaxTurnsReachedAttachmentValidated))
	b.WriteString(fmt.Sprintf("max_turns_reached_attachment_event=%s\n", valueOrNone(r.MaxTurnsReachedAttachmentEvent)))
	b.WriteString(fmt.Sprintf("task_status_attachment_validated=%t\n", r.TaskStatusAttachmentValidated))
	b.WriteString(fmt.Sprintf("task_status_attachment_event=%s\n", valueOrNone(r.TaskStatusAttachmentEvent)))
	b.WriteString(fmt.Sprintf("queued_command_validated=%t\n", r.QueuedCommandValidated))
	b.WriteString(fmt.Sprintf("queued_command_event=%s\n", valueOrNone(r.QueuedCommandEvent)))
	b.WriteString(fmt.Sprintf("task_reminder_attachment_validated=%t\n", r.TaskReminderAttachmentValidated))
	b.WriteString(fmt.Sprintf("task_reminder_attachment_event=%s\n", valueOrNone(r.TaskReminderAttachmentEvent)))
	b.WriteString(fmt.Sprintf("todo_reminder_attachment_validated=%t\n", r.TodoReminderAttachmentValidated))
	b.WriteString(fmt.Sprintf("todo_reminder_attachment_event=%s\n", valueOrNone(r.TodoReminderAttachmentEvent)))
	b.WriteString(fmt.Sprintf("compaction_reminder_validated=%t\n", r.CompactionReminderValidated))
	b.WriteString(fmt.Sprintf("compaction_reminder_event=%s\n", valueOrNone(r.CompactionReminderEvent)))
	b.WriteString(fmt.Sprintf("context_efficiency_validated=%t\n", r.ContextEfficiencyValidated))
	b.WriteString(fmt.Sprintf("context_efficiency_event=%s\n", valueOrNone(r.ContextEfficiencyEvent)))
	b.WriteString(fmt.Sprintf("auto_mode_exit_validated=%t\n", r.AutoModeExitValidated))
	b.WriteString(fmt.Sprintf("auto_mode_exit_event=%s\n", valueOrNone(r.AutoModeExitEvent)))
	b.WriteString(fmt.Sprintf("plan_mode_validated=%t\n", r.PlanModeValidated))
	b.WriteString(fmt.Sprintf("plan_mode_event=%s\n", valueOrNone(r.PlanModeEvent)))
	b.WriteString(fmt.Sprintf("plan_mode_exit_validated=%t\n", r.PlanModeExitValidated))
	b.WriteString(fmt.Sprintf("plan_mode_exit_event=%s\n", valueOrNone(r.PlanModeExitEvent)))
	b.WriteString(fmt.Sprintf("plan_mode_reentry_validated=%t\n", r.PlanModeReentryValidated))
	b.WriteString(fmt.Sprintf("plan_mode_reentry_event=%s\n", valueOrNone(r.PlanModeReentryEvent)))
	b.WriteString(fmt.Sprintf("date_change_validated=%t\n", r.DateChangeValidated))
	b.WriteString(fmt.Sprintf("date_change_event=%s\n", valueOrNone(r.DateChangeEvent)))
	b.WriteString(fmt.Sprintf("ultrathink_effort_validated=%t\n", r.UltrathinkEffortValidated))
	b.WriteString(fmt.Sprintf("ultrathink_effort_event=%s\n", valueOrNone(r.UltrathinkEffortEvent)))
	b.WriteString(fmt.Sprintf("deferred_tools_delta_validated=%t\n", r.DeferredToolsDeltaValidated))
	b.WriteString(fmt.Sprintf("deferred_tools_delta_event=%s\n", valueOrNone(r.DeferredToolsDeltaEvent)))
	b.WriteString(fmt.Sprintf("agent_listing_delta_validated=%t\n", r.AgentListingDeltaValidated))
	b.WriteString(fmt.Sprintf("agent_listing_delta_event=%s\n", valueOrNone(r.AgentListingDeltaEvent)))
	b.WriteString(fmt.Sprintf("mcp_instructions_delta_validated=%t\n", r.MCPInstructionsDeltaValidated))
	b.WriteString(fmt.Sprintf("mcp_instructions_delta_event=%s\n", valueOrNone(r.MCPInstructionsDeltaEvent)))
	b.WriteString(fmt.Sprintf("companion_intro_validated=%t\n", r.CompanionIntroValidated))
	b.WriteString(fmt.Sprintf("companion_intro_event=%s\n", valueOrNone(r.CompanionIntroEvent)))
	b.WriteString(fmt.Sprintf("token_usage_validated=%t\n", r.TokenUsageValidated))
	b.WriteString(fmt.Sprintf("token_usage_event=%s\n", valueOrNone(r.TokenUsageEvent)))
	b.WriteString(fmt.Sprintf("output_token_usage_validated=%t\n", r.OutputTokenUsageValidated))
	b.WriteString(fmt.Sprintf("output_token_usage_event=%s\n", valueOrNone(r.OutputTokenUsageEvent)))
	b.WriteString(fmt.Sprintf("verify_plan_reminder_validated=%t\n", r.VerifyPlanReminderValidated))
	b.WriteString(fmt.Sprintf("verify_plan_reminder_event=%s\n", valueOrNone(r.VerifyPlanReminderEvent)))
	b.WriteString(fmt.Sprintf("streamlined_text_validated=%t\n", r.StreamlinedTextValidated))
	b.WriteString(fmt.Sprintf("streamlined_text_event=%s\n", valueOrNone(r.StreamlinedTextEvent)))
	b.WriteString(fmt.Sprintf("system_validated=%t\n", r.SystemValidated))
	b.WriteString(fmt.Sprintf("system_event=%s\n", valueOrNone(r.SystemEvent)))
	b.WriteString(fmt.Sprintf("status_validated=%t\n", r.StatusValidated))
	b.WriteString(fmt.Sprintf("status_event=%s\n", valueOrNone(r.StatusEvent)))
	b.WriteString(fmt.Sprintf("status_transition_validated=%t\n", r.StatusTransitionValidated))
	b.WriteString(fmt.Sprintf("status_transition_event=%s\n", valueOrNone(r.StatusTransitionEvent)))
	b.WriteString(fmt.Sprintf("status_compacting_lifecycle_validated=%t\n", r.StatusCompactingLifecycleValidated))
	b.WriteString(fmt.Sprintf("status_compacting_lifecycle_event=%s\n", valueOrNone(r.StatusCompactingLifecycleEvent)))
	b.WriteString(fmt.Sprintf("compact_summary_validated=%t\n", r.CompactSummaryValidated))
	b.WriteString(fmt.Sprintf("compact_summary_event=%s\n", valueOrNone(r.CompactSummaryEvent)))
	b.WriteString(fmt.Sprintf("compact_summary_synthetic_validated=%t\n", r.CompactSummarySyntheticValidated))
	b.WriteString(fmt.Sprintf("compact_summary_synthetic_event=%s\n", valueOrNone(r.CompactSummarySyntheticEvent)))
	b.WriteString(fmt.Sprintf("compact_summary_timestamp_validated=%t\n", r.CompactSummaryTimestampValidated))
	b.WriteString(fmt.Sprintf("compact_summary_timestamp_event=%s\n", valueOrNone(r.CompactSummaryTimestampEvent)))
	b.WriteString(fmt.Sprintf("compact_summary_parent_tool_use_id_validated=%t\n", r.CompactSummaryParentToolUseIDValidated))
	b.WriteString(fmt.Sprintf("compact_summary_parent_tool_use_id_event=%s\n", valueOrNone(r.CompactSummaryParentToolUseIDEvent)))
	b.WriteString(fmt.Sprintf("acked_initial_user_replay_validated=%t\n", r.AckedInitialUserReplayValidated))
	b.WriteString(fmt.Sprintf("acked_initial_user_replay_event=%s\n", valueOrNone(r.AckedInitialUserReplayEvent)))
	b.WriteString(fmt.Sprintf("replayed_user_message_validated=%t\n", r.ReplayedUserMessageValidated))
	b.WriteString(fmt.Sprintf("replayed_user_message_event=%s\n", valueOrNone(r.ReplayedUserMessageEvent)))
	b.WriteString(fmt.Sprintf("replayed_user_synthetic_validated=%t\n", r.ReplayedUserSyntheticValidated))
	b.WriteString(fmt.Sprintf("replayed_user_synthetic_event=%s\n", valueOrNone(r.ReplayedUserSyntheticEvent)))
	b.WriteString(fmt.Sprintf("replayed_user_timestamp_validated=%t\n", r.ReplayedUserTimestampValidated))
	b.WriteString(fmt.Sprintf("replayed_user_timestamp_event=%s\n", valueOrNone(r.ReplayedUserTimestampEvent)))
	b.WriteString(fmt.Sprintf("replayed_user_parent_tool_use_id_validated=%t\n", r.ReplayedUserParentToolUseIDValidated))
	b.WriteString(fmt.Sprintf("replayed_user_parent_tool_use_id_event=%s\n", valueOrNone(r.ReplayedUserParentToolUseIDEvent)))
	b.WriteString(fmt.Sprintf("replayed_queued_command_validated=%t\n", r.ReplayedQueuedCommandValidated))
	b.WriteString(fmt.Sprintf("replayed_queued_command_event=%s\n", valueOrNone(r.ReplayedQueuedCommandEvent)))
	b.WriteString(fmt.Sprintf("replayed_queued_command_synthetic_validated=%t\n", r.ReplayedQueuedCommandSyntheticValidated))
	b.WriteString(fmt.Sprintf("replayed_queued_command_synthetic_event=%s\n", valueOrNone(r.ReplayedQueuedCommandSyntheticEvent)))
	b.WriteString(fmt.Sprintf("replayed_queued_command_timestamp_validated=%t\n", r.ReplayedQueuedCommandTimestampValidated))
	b.WriteString(fmt.Sprintf("replayed_queued_command_timestamp_event=%s\n", valueOrNone(r.ReplayedQueuedCommandTimestampEvent)))
	b.WriteString(fmt.Sprintf("replayed_queued_command_parent_tool_use_id_validated=%t\n", r.ReplayedQueuedCommandParentToolUseIDValidated))
	b.WriteString(fmt.Sprintf("replayed_queued_command_parent_tool_use_id_event=%s\n", valueOrNone(r.ReplayedQueuedCommandParentToolUseIDEvent)))
	b.WriteString(fmt.Sprintf("replayed_tool_result_validated=%t\n", r.ReplayedToolResultValidated))
	b.WriteString(fmt.Sprintf("replayed_tool_result_event=%s\n", valueOrNone(r.ReplayedToolResultEvent)))
	b.WriteString(fmt.Sprintf("replayed_tool_result_synthetic_validated=%t\n", r.ReplayedToolResultSyntheticValidated))
	b.WriteString(fmt.Sprintf("replayed_tool_result_synthetic_event=%s\n", valueOrNone(r.ReplayedToolResultSyntheticEvent)))
	b.WriteString(fmt.Sprintf("replayed_tool_result_timestamp_validated=%t\n", r.ReplayedToolResultTimestampValidated))
	b.WriteString(fmt.Sprintf("replayed_tool_result_timestamp_event=%s\n", valueOrNone(r.ReplayedToolResultTimestampEvent)))
	b.WriteString(fmt.Sprintf("replayed_tool_result_parent_tool_use_id_validated=%t\n", r.ReplayedToolResultParentToolUseIDValidated))
	b.WriteString(fmt.Sprintf("replayed_tool_result_parent_tool_use_id_event=%s\n", valueOrNone(r.ReplayedToolResultParentToolUseIDEvent)))
	b.WriteString(fmt.Sprintf("replayed_assistant_message_validated=%t\n", r.ReplayedAssistantMessageValidated))
	b.WriteString(fmt.Sprintf("replayed_assistant_message_event=%s\n", valueOrNone(r.ReplayedAssistantMessageEvent)))
	b.WriteString(fmt.Sprintf("replayed_compact_boundary_validated=%t\n", r.ReplayedCompactBoundaryValidated))
	b.WriteString(fmt.Sprintf("replayed_compact_boundary_event=%s\n", valueOrNone(r.ReplayedCompactBoundaryEvent)))
	b.WriteString(fmt.Sprintf("replayed_compact_boundary_preserved_segment_validated=%t\n", r.ReplayedCompactBoundaryPreservedSegmentValidated))
	b.WriteString(fmt.Sprintf("replayed_compact_boundary_preserved_segment_event=%s\n", valueOrNone(r.ReplayedCompactBoundaryPreservedSegmentEvent)))
	b.WriteString(fmt.Sprintf("replayed_local_command_breadcrumb_validated=%t\n", r.ReplayedLocalCommandBreadcrumbValidated))
	b.WriteString(fmt.Sprintf("replayed_local_command_breadcrumb_event=%s\n", valueOrNone(r.ReplayedLocalCommandBreadcrumbEvent)))
	b.WriteString(fmt.Sprintf("replayed_local_command_breadcrumb_synthetic_validated=%t\n", r.ReplayedLocalCommandBreadcrumbSyntheticValidated))
	b.WriteString(fmt.Sprintf("replayed_local_command_breadcrumb_synthetic_event=%s\n", valueOrNone(r.ReplayedLocalCommandBreadcrumbSyntheticEvent)))
	b.WriteString(fmt.Sprintf("replayed_local_command_breadcrumb_timestamp_validated=%t\n", r.ReplayedLocalCommandBreadcrumbTimestampValidated))
	b.WriteString(fmt.Sprintf("replayed_local_command_breadcrumb_timestamp_event=%s\n", valueOrNone(r.ReplayedLocalCommandBreadcrumbTimestampEvent)))
	b.WriteString(fmt.Sprintf("replayed_local_command_breadcrumb_parent_tool_use_id_validated=%t\n", r.ReplayedLocalCommandBreadcrumbParentToolUseIDValidated))
	b.WriteString(fmt.Sprintf("replayed_local_command_breadcrumb_parent_tool_use_id_event=%s\n", valueOrNone(r.ReplayedLocalCommandBreadcrumbParentToolUseIDEvent)))
	b.WriteString(fmt.Sprintf("replayed_local_command_stderr_breadcrumb_validated=%t\n", r.ReplayedLocalCommandStderrBreadcrumbValidated))
	b.WriteString(fmt.Sprintf("replayed_local_command_stderr_breadcrumb_event=%s\n", valueOrNone(r.ReplayedLocalCommandStderrBreadcrumbEvent)))
	b.WriteString(fmt.Sprintf("replayed_local_command_stderr_breadcrumb_synthetic_validated=%t\n", r.ReplayedLocalCommandStderrBreadcrumbSyntheticValidated))
	b.WriteString(fmt.Sprintf("replayed_local_command_stderr_breadcrumb_synthetic_event=%s\n", valueOrNone(r.ReplayedLocalCommandStderrBreadcrumbSyntheticEvent)))
	b.WriteString(fmt.Sprintf("replayed_local_command_stderr_breadcrumb_timestamp_validated=%t\n", r.ReplayedLocalCommandStderrBreadcrumbTimestampValidated))
	b.WriteString(fmt.Sprintf("replayed_local_command_stderr_breadcrumb_timestamp_event=%s\n", valueOrNone(r.ReplayedLocalCommandStderrBreadcrumbTimestampEvent)))
	b.WriteString(fmt.Sprintf("replayed_local_command_stderr_breadcrumb_parent_tool_use_id_validated=%t\n", r.ReplayedLocalCommandStderrBreadcrumbParentToolUseIDValidated))
	b.WriteString(fmt.Sprintf("replayed_local_command_stderr_breadcrumb_parent_tool_use_id_event=%s\n", valueOrNone(r.ReplayedLocalCommandStderrBreadcrumbParentToolUseIDEvent)))
	b.WriteString(fmt.Sprintf("auth_validated=%t\n", r.AuthValidated))
	b.WriteString(fmt.Sprintf("auth_event=%s\n", valueOrNone(r.AuthEvent)))
	b.WriteString(fmt.Sprintf("keep_alive_validated=%t\n", r.KeepAliveValidated))
	b.WriteString(fmt.Sprintf("keep_alive_event=%s\n", valueOrNone(r.KeepAliveEvent)))
	b.WriteString(fmt.Sprintf("update_environment_variables_validated=%t\n", r.UpdateEnvironmentVariablesValidated))
	b.WriteString(fmt.Sprintf("update_environment_variables_event=%s\n", valueOrNone(r.UpdateEnvironmentVariablesEvent)))
	b.WriteString(fmt.Sprintf("control_cancel_validated=%t\n", r.ControlCancelValidated))
	b.WriteString(fmt.Sprintf("control_cancel_event=%s\n", valueOrNone(r.ControlCancelEvent)))
	b.WriteString(fmt.Sprintf("message_validated=%t\n", r.MessageValidated))
	b.WriteString(fmt.Sprintf("message_event=%s\n", valueOrNone(r.MessageEvent)))
	b.WriteString(fmt.Sprintf("validated_turns=%d\n", r.ValidatedTurns))
	b.WriteString(fmt.Sprintf("multi_turn_validated=%t\n", r.MultiTurnValidated))
	b.WriteString(fmt.Sprintf("result_validated=%t\n", r.ResultValidated))
	b.WriteString(fmt.Sprintf("result_event=%s\n", valueOrNone(r.ResultEvent)))
	b.WriteString(fmt.Sprintf("result_structured_output_validated=%t\n", r.ResultStructuredOutputValidated))
	b.WriteString(fmt.Sprintf("result_structured_output_event=%s\n", valueOrNone(r.ResultStructuredOutputEvent)))
	b.WriteString(fmt.Sprintf("result_usage_validated=%t\n", r.ResultUsageValidated))
	b.WriteString(fmt.Sprintf("result_usage_event=%s\n", valueOrNone(r.ResultUsageEvent)))
	b.WriteString(fmt.Sprintf("result_model_usage_validated=%t\n", r.ResultModelUsageValidated))
	b.WriteString(fmt.Sprintf("result_model_usage_event=%s\n", valueOrNone(r.ResultModelUsageEvent)))
	b.WriteString(fmt.Sprintf("result_permission_denials_validated=%t\n", r.ResultPermissionDenialsValidated))
	b.WriteString(fmt.Sprintf("result_permission_denials_event=%s\n", valueOrNone(r.ResultPermissionDenialsEvent)))
	b.WriteString(fmt.Sprintf("result_fast_mode_state_validated=%t\n", r.ResultFastModeStateValidated))
	b.WriteString(fmt.Sprintf("result_fast_mode_state_event=%s\n", valueOrNone(r.ResultFastModeStateEvent)))
	b.WriteString(fmt.Sprintf("result_error_validated=%t\n", r.ResultErrorValidated))
	b.WriteString(fmt.Sprintf("result_error_event=%s\n", valueOrNone(r.ResultErrorEvent)))
	b.WriteString(fmt.Sprintf("result_error_usage_validated=%t\n", r.ResultErrorUsageValidated))
	b.WriteString(fmt.Sprintf("result_error_usage_event=%s\n", valueOrNone(r.ResultErrorUsageEvent)))
	b.WriteString(fmt.Sprintf("result_error_permission_denials_validated=%t\n", r.ResultErrorPermissionDenialsValidated))
	b.WriteString(fmt.Sprintf("result_error_permission_denials_event=%s\n", valueOrNone(r.ResultErrorPermissionDenialsEvent)))
	b.WriteString(fmt.Sprintf("result_error_model_usage_validated=%t\n", r.ResultErrorModelUsageValidated))
	b.WriteString(fmt.Sprintf("result_error_model_usage_event=%s\n", valueOrNone(r.ResultErrorModelUsageEvent)))
	b.WriteString(fmt.Sprintf("result_error_fast_mode_state_validated=%t\n", r.ResultErrorFastModeStateValidated))
	b.WriteString(fmt.Sprintf("result_error_fast_mode_state_event=%s\n", valueOrNone(r.ResultErrorFastModeStateEvent)))
	b.WriteString(fmt.Sprintf("result_error_max_turns_validated=%t\n", r.ResultErrorMaxTurnsValidated))
	b.WriteString(fmt.Sprintf("result_error_max_turns_event=%s\n", valueOrNone(r.ResultErrorMaxTurnsEvent)))
	b.WriteString(fmt.Sprintf("result_error_max_turns_fast_mode_state_validated=%t\n", r.ResultErrorMaxTurnsFastModeStateValidated))
	b.WriteString(fmt.Sprintf("result_error_max_turns_fast_mode_state_event=%s\n", valueOrNone(r.ResultErrorMaxTurnsFastModeStateEvent)))
	b.WriteString(fmt.Sprintf("result_error_max_budget_usd_validated=%t\n", r.ResultErrorMaxBudgetUSDValidated))
	b.WriteString(fmt.Sprintf("result_error_max_budget_usd_event=%s\n", valueOrNone(r.ResultErrorMaxBudgetUSDEvent)))
	b.WriteString(fmt.Sprintf("result_error_max_budget_usd_fast_mode_state_validated=%t\n", r.ResultErrorMaxBudgetUSDFastModeStateValidated))
	b.WriteString(fmt.Sprintf("result_error_max_budget_usd_fast_mode_state_event=%s\n", valueOrNone(r.ResultErrorMaxBudgetUSDFastModeStateEvent)))
	b.WriteString(fmt.Sprintf("result_error_max_structured_output_retries_validated=%t\n", r.ResultErrorMaxStructuredOutputRetriesValidated))
	b.WriteString(fmt.Sprintf("result_error_max_structured_output_retries_event=%s\n", valueOrNone(r.ResultErrorMaxStructuredOutputRetriesEvent)))
	b.WriteString(fmt.Sprintf("result_error_max_structured_output_retries_fast_mode_state_validated=%t\n", r.ResultErrorMaxStructuredOutputRetriesFastModeStateValidated))
	b.WriteString(fmt.Sprintf("result_error_max_structured_output_retries_fast_mode_state_event=%s\n", valueOrNone(r.ResultErrorMaxStructuredOutputRetriesFastModeStateEvent)))
	b.WriteString(fmt.Sprintf("control_validated=%t\n", r.ControlValidated))
	b.WriteString(fmt.Sprintf("permission_validated=%t\n", r.PermissionValidated))
	b.WriteString(fmt.Sprintf("permission_denied_validated=%t\n", r.PermissionDeniedValidated))
	b.WriteString(fmt.Sprintf("permission_denied_event=%s\n", valueOrNone(r.PermissionDeniedEvent)))
	b.WriteString(fmt.Sprintf("task_started_validated=%t\n", r.TaskStartedValidated))
	b.WriteString(fmt.Sprintf("task_started_event=%s\n", valueOrNone(r.TaskStartedEvent)))
	b.WriteString(fmt.Sprintf("task_progress_validated=%t\n", r.TaskProgressValidated))
	b.WriteString(fmt.Sprintf("task_progress_event=%s\n", valueOrNone(r.TaskProgressEvent)))
	b.WriteString(fmt.Sprintf("task_notification_validated=%t\n", r.TaskNotificationValidated))
	b.WriteString(fmt.Sprintf("task_notification_event=%s\n", valueOrNone(r.TaskNotificationEvent)))
	b.WriteString(fmt.Sprintf("files_persisted_validated=%t\n", r.FilesPersistedValidated))
	b.WriteString(fmt.Sprintf("files_persisted_event=%s\n", valueOrNone(r.FilesPersistedEvent)))
	b.WriteString(fmt.Sprintf("api_retry_validated=%t\n", r.APIRetryValidated))
	b.WriteString(fmt.Sprintf("api_retry_event=%s\n", valueOrNone(r.APIRetryEvent)))
	b.WriteString(fmt.Sprintf("local_command_output_validated=%t\n", r.LocalCommandOutputValidated))
	b.WriteString(fmt.Sprintf("local_command_output_event=%s\n", valueOrNone(r.LocalCommandOutputEvent)))
	b.WriteString(fmt.Sprintf("local_command_output_assistant_validated=%t\n", r.LocalCommandOutputAssistantValidated))
	b.WriteString(fmt.Sprintf("local_command_output_assistant_event=%s\n", valueOrNone(r.LocalCommandOutputAssistantEvent)))
	b.WriteString(fmt.Sprintf("elicitation_validated=%t\n", r.ElicitationValidated))
	b.WriteString(fmt.Sprintf("elicitation_event=%s\n", valueOrNone(r.ElicitationEvent)))
	b.WriteString(fmt.Sprintf("hook_callback_validated=%t\n", r.HookCallbackValidated))
	b.WriteString(fmt.Sprintf("hook_callback_event=%s\n", valueOrNone(r.HookCallbackEvent)))
	b.WriteString(fmt.Sprintf("channel_enable_validated=%t\n", r.ChannelEnableValidated))
	b.WriteString(fmt.Sprintf("channel_enable_event=%s\n", valueOrNone(r.ChannelEnableEvent)))
	b.WriteString(fmt.Sprintf("elicitation_complete_validated=%t\n", r.ElicitationCompleteValidated))
	b.WriteString(fmt.Sprintf("elicitation_complete_event=%s\n", valueOrNone(r.ElicitationCompleteEvent)))
	b.WriteString(fmt.Sprintf("tool_progress_validated=%t\n", r.ToolProgressValidated))
	b.WriteString(fmt.Sprintf("tool_progress_event=%s\n", valueOrNone(r.ToolProgressEvent)))
	b.WriteString(fmt.Sprintf("rate_limit_validated=%t\n", r.RateLimitValidated))
	b.WriteString(fmt.Sprintf("rate_limit_event=%s\n", valueOrNone(r.RateLimitEvent)))
	b.WriteString(fmt.Sprintf("tool_use_summary_validated=%t\n", r.ToolUseSummaryValidated))
	b.WriteString(fmt.Sprintf("tool_use_summary_event=%s\n", valueOrNone(r.ToolUseSummaryEvent)))
	b.WriteString(fmt.Sprintf("tool_use_summary_shape_validated=%t\n", r.ToolUseSummaryShapeValidated))
	b.WriteString(fmt.Sprintf("tool_use_summary_shape_event=%s\n", valueOrNone(r.ToolUseSummaryShapeEvent)))
	b.WriteString(fmt.Sprintf("streamlined_tool_use_summary_validated=%t\n", r.StreamlinedToolUseSummaryValidated))
	b.WriteString(fmt.Sprintf("streamlined_tool_use_summary_event=%s\n", valueOrNone(r.StreamlinedToolUseSummaryEvent)))
	b.WriteString(fmt.Sprintf("prompt_suggestion_validated=%t\n", r.PromptSuggestionValidated))
	b.WriteString(fmt.Sprintf("prompt_suggestion_event=%s\n", valueOrNone(r.PromptSuggestionEvent)))
	b.WriteString(fmt.Sprintf("post_turn_summary_validated=%t\n", r.PostTurnSummaryValidated))
	b.WriteString(fmt.Sprintf("post_turn_summary_event=%s\n", valueOrNone(r.PostTurnSummaryEvent)))
	b.WriteString(fmt.Sprintf("compact_boundary_validated=%t\n", r.CompactBoundaryValidated))
	b.WriteString(fmt.Sprintf("compact_boundary_event=%s\n", valueOrNone(r.CompactBoundaryEvent)))
	b.WriteString(fmt.Sprintf("compact_boundary_preserved_segment_validated=%t\n", r.CompactBoundaryPreservedSegmentValidated))
	b.WriteString(fmt.Sprintf("compact_boundary_preserved_segment_event=%s\n", valueOrNone(r.CompactBoundaryPreservedSegmentEvent)))
	b.WriteString(fmt.Sprintf("session_state_changed_validated=%t\n", r.SessionStateChangedValidated))
	b.WriteString(fmt.Sprintf("session_state_changed_event=%s\n", valueOrNone(r.SessionStateChangedEvent)))
	b.WriteString(fmt.Sprintf("session_state_requires_action_validated=%t\n", r.SessionStateRequiresActionValidated))
	b.WriteString(fmt.Sprintf("session_state_requires_action_event=%s\n", valueOrNone(r.SessionStateRequiresActionEvent)))
	b.WriteString(fmt.Sprintf("hook_started_validated=%t\n", r.HookStartedValidated))
	b.WriteString(fmt.Sprintf("hook_started_event=%s\n", valueOrNone(r.HookStartedEvent)))
	b.WriteString(fmt.Sprintf("hook_progress_validated=%t\n", r.HookProgressValidated))
	b.WriteString(fmt.Sprintf("hook_progress_event=%s\n", valueOrNone(r.HookProgressEvent)))
	b.WriteString(fmt.Sprintf("hook_response_validated=%t\n", r.HookResponseValidated))
	b.WriteString(fmt.Sprintf("hook_response_event=%s\n", valueOrNone(r.HookResponseEvent)))
	b.WriteString(fmt.Sprintf("tool_execution_validated=%t\n", r.ToolExecutionValidated))
	b.WriteString(fmt.Sprintf("interrupt_validated=%t\n", r.InterruptValidated))
	b.WriteString(fmt.Sprintf("set_model_validated=%t\n", r.SetModelValidated))
	b.WriteString(fmt.Sprintf("set_model_event=%s\n", valueOrNone(r.SetModelEvent)))
	b.WriteString(fmt.Sprintf("set_permission_mode_validated=%t\n", r.SetPermissionModeValidated))
	b.WriteString(fmt.Sprintf("set_permission_mode_event=%s\n", valueOrNone(r.SetPermissionModeEvent)))
	b.WriteString(fmt.Sprintf("set_max_thinking_tokens_validated=%t\n", r.SetMaxThinkingTokensValidated))
	b.WriteString(fmt.Sprintf("set_max_thinking_tokens_event=%s\n", valueOrNone(r.SetMaxThinkingTokensEvent)))
	b.WriteString(fmt.Sprintf("mcp_status_validated=%t\n", r.MCPStatusValidated))
	b.WriteString(fmt.Sprintf("mcp_status_event=%s\n", valueOrNone(r.MCPStatusEvent)))
	b.WriteString(fmt.Sprintf("get_context_usage_validated=%t\n", r.GetContextUsageValidated))
	b.WriteString(fmt.Sprintf("get_context_usage_event=%s\n", valueOrNone(r.GetContextUsageEvent)))
	b.WriteString(fmt.Sprintf("mcp_message_validated=%t\n", r.MCPMessageValidated))
	b.WriteString(fmt.Sprintf("mcp_message_event=%s\n", valueOrNone(r.MCPMessageEvent)))
	b.WriteString(fmt.Sprintf("mcp_set_servers_validated=%t\n", r.MCPSetServersValidated))
	b.WriteString(fmt.Sprintf("mcp_set_servers_event=%s\n", valueOrNone(r.MCPSetServersEvent)))
	b.WriteString(fmt.Sprintf("reload_plugins_validated=%t\n", r.ReloadPluginsValidated))
	b.WriteString(fmt.Sprintf("reload_plugins_event=%s\n", valueOrNone(r.ReloadPluginsEvent)))
	b.WriteString(fmt.Sprintf("mcp_authenticate_validated=%t\n", r.MCPAuthenticateValidated))
	b.WriteString(fmt.Sprintf("mcp_authenticate_event=%s\n", valueOrNone(r.MCPAuthenticateEvent)))
	b.WriteString(fmt.Sprintf("mcp_oauth_callback_url_validated=%t\n", r.MCPOAuthCallbackURLValidated))
	b.WriteString(fmt.Sprintf("mcp_oauth_callback_url_event=%s\n", valueOrNone(r.MCPOAuthCallbackURLEvent)))
	b.WriteString(fmt.Sprintf("mcp_reconnect_validated=%t\n", r.MCPReconnectValidated))
	b.WriteString(fmt.Sprintf("mcp_reconnect_event=%s\n", valueOrNone(r.MCPReconnectEvent)))
	b.WriteString(fmt.Sprintf("mcp_toggle_validated=%t\n", r.MCPToggleValidated))
	b.WriteString(fmt.Sprintf("mcp_toggle_event=%s\n", valueOrNone(r.MCPToggleEvent)))
	b.WriteString(fmt.Sprintf("seed_read_state_validated=%t\n", r.SeedReadStateValidated))
	b.WriteString(fmt.Sprintf("seed_read_state_event=%s\n", valueOrNone(r.SeedReadStateEvent)))
	b.WriteString(fmt.Sprintf("rewind_files_validated=%t\n", r.RewindFilesValidated))
	b.WriteString(fmt.Sprintf("rewind_files_event=%s\n", valueOrNone(r.RewindFilesEvent)))
	b.WriteString(fmt.Sprintf("rewind_files_can_rewind=%t\n", r.RewindFilesCanRewind))
	b.WriteString(fmt.Sprintf("rewind_files_files_changed=%d\n", r.RewindFilesFilesChanged))
	b.WriteString(fmt.Sprintf("rewind_files_insertions=%d\n", r.RewindFilesInsertions))
	b.WriteString(fmt.Sprintf("rewind_files_deletions=%d\n", r.RewindFilesDeletions))
	b.WriteString(fmt.Sprintf("rewind_files_error=%s\n", valueOrNone(r.RewindFilesError)))
	b.WriteString(fmt.Sprintf("cancel_async_message_validated=%t\n", r.CancelAsyncMessageValidated))
	b.WriteString(fmt.Sprintf("cancel_async_message_event=%s\n", valueOrNone(r.CancelAsyncMessageEvent)))
	b.WriteString(fmt.Sprintf("stop_task_validated=%t\n", r.StopTaskValidated))
	b.WriteString(fmt.Sprintf("stop_task_event=%s\n", valueOrNone(r.StopTaskEvent)))
	b.WriteString(fmt.Sprintf("apply_flag_settings_validated=%t\n", r.ApplyFlagSettingsValidated))
	b.WriteString(fmt.Sprintf("apply_flag_settings_event=%s\n", valueOrNone(r.ApplyFlagSettingsEvent)))
	b.WriteString(fmt.Sprintf("get_settings_validated=%t\n", r.GetSettingsValidated))
	b.WriteString(fmt.Sprintf("get_settings_event=%s\n", valueOrNone(r.GetSettingsEvent)))
	b.WriteString(fmt.Sprintf("generate_session_title_validated=%t\n", r.GenerateSessionTitleValidated))
	b.WriteString(fmt.Sprintf("generate_session_title_event=%s\n", valueOrNone(r.GenerateSessionTitleEvent)))
	b.WriteString(fmt.Sprintf("side_question_validated=%t\n", r.SideQuestionValidated))
	b.WriteString(fmt.Sprintf("side_question_event=%s\n", valueOrNone(r.SideQuestionEvent)))
	b.WriteString(fmt.Sprintf("initialize_validated=%t\n", r.InitializeValidated))
	b.WriteString(fmt.Sprintf("initialize_event=%s\n", valueOrNone(r.InitializeEvent)))
	b.WriteString(fmt.Sprintf("set_proactive_validated=%t\n", r.SetProactiveValidated))
	b.WriteString(fmt.Sprintf("set_proactive_event=%s\n", valueOrNone(r.SetProactiveEvent)))
	b.WriteString(fmt.Sprintf("bridge_state_validated=%t\n", r.BridgeStateValidated))
	b.WriteString(fmt.Sprintf("bridge_state_event=%s\n", valueOrNone(r.BridgeStateEvent)))
	b.WriteString(fmt.Sprintf("remote_control_validated=%t\n", r.RemoteControlValidated))
	b.WriteString(fmt.Sprintf("remote_control_event=%s\n", valueOrNone(r.RemoteControlEvent)))
	b.WriteString(fmt.Sprintf("end_session_validated=%t\n", r.EndSessionValidated))
	b.WriteString(fmt.Sprintf("end_session_event=%s\n", valueOrNone(r.EndSessionEvent)))
	b.WriteString(fmt.Sprintf("backend_validated=%t\n", r.BackendValidated))
	b.WriteString(fmt.Sprintf("backend_status=%s\n", valueOrNone(r.BackendStatus)))
	b.WriteString(fmt.Sprintf("backend_pid=%d\n", r.BackendPID))
	b.WriteString(fmt.Sprintf("backend_started_at=%d\n", r.BackendStartedAt))
	b.WriteString(fmt.Sprintf("backend_stopped_at=%d\n", r.BackendStoppedAt))
	b.WriteString(fmt.Sprintf("backend_exit_code=%d\n", r.BackendExitCode))
	return b.String()
}

func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func validatePreservedSegment(compactMetadata map[string]any, prefix string) error {
	preservedSegment, _ := compactMetadata["preserved_segment"].(map[string]any)
	if strings.TrimSpace(asString(preservedSegment["head_uuid"])) == "" {
		return fmt.Errorf("%s: missing compact_metadata.preserved_segment.head_uuid", prefix)
	}
	if strings.TrimSpace(asString(preservedSegment["anchor_uuid"])) == "" {
		return fmt.Errorf("%s: missing compact_metadata.preserved_segment.anchor_uuid", prefix)
	}
	if strings.TrimSpace(asString(preservedSegment["tail_uuid"])) == "" {
		return fmt.Errorf("%s: missing compact_metadata.preserved_segment.tail_uuid", prefix)
	}
	return nil
}

func validateParentToolUseIDNull(incoming map[string]any, prefix string) error {
	if incoming["parent_tool_use_id"] != nil {
		return fmt.Errorf("%s: expected parent_tool_use_id=null", prefix)
	}
	return nil
}

func validateZeroUsageShape(raw any) error {
	usage, _ := raw.(map[string]any)
	serverToolUse, _ := usage["server_tool_use"].(map[string]any)
	cacheCreation, _ := usage["cache_creation"].(map[string]any)
	iterations, _ := usage["iterations"].([]any)
	if intFromAny(usage["input_tokens"]) != 0 || intFromAny(usage["cache_creation_input_tokens"]) != 0 || intFromAny(usage["cache_read_input_tokens"]) != 0 || intFromAny(usage["output_tokens"]) != 0 || intFromAny(serverToolUse["web_search_requests"]) != 0 || intFromAny(serverToolUse["web_fetch_requests"]) != 0 || strings.TrimSpace(asString(usage["service_tier"])) != "standard" || intFromAny(cacheCreation["ephemeral_1h_input_tokens"]) != 0 || intFromAny(cacheCreation["ephemeral_5m_input_tokens"]) != 0 || strings.TrimSpace(asString(usage["inference_geo"])) != "" || len(iterations) != 0 || strings.TrimSpace(asString(usage["speed"])) != "standard" {
		return fmt.Errorf("unexpected zero-value payload")
	}
	return nil
}

func validateZeroModelUsageShape(raw any) error {
	modelUsage, _ := raw.(map[string]any)
	modelUsageEntry, _ := modelUsage["claude-sonnet-4-5"].(map[string]any)
	if len(modelUsageEntry) == 0 || intFromAny(modelUsageEntry["inputTokens"]) != 0 || intFromAny(modelUsageEntry["outputTokens"]) != 0 || intFromAny(modelUsageEntry["cacheReadInputTokens"]) != 0 || intFromAny(modelUsageEntry["cacheCreationInputTokens"]) != 0 || intFromAny(modelUsageEntry["webSearchRequests"]) != 0 || intFromAny(modelUsageEntry["contextWindow"]) != 0 || float64FromAny(modelUsageEntry["costUSD"]) != 0 {
		return fmt.Errorf("unexpected claude-sonnet-4-5 payload")
	}
	return nil
}

func intFromAny(v any) int {
	switch typed := v.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return 0
	}
}

func float64FromAny(v any) float64 {
	switch typed := v.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	default:
		return 0
	}
}

func extractPromptText(messageEnvelope map[string]any) string {
	message, _ := messageEnvelope["message"].(map[string]any)
	content := message["content"]
	switch typed := content.(type) {
	case string:
		return strings.TrimSpace(typed)
	case []any:
		for _, item := range typed {
			entry, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if strings.TrimSpace(asString(entry["type"])) != "text" {
				continue
			}
			if text := strings.TrimSpace(asString(entry["text"])); text != "" {
				return text
			}
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func valueOrNone(v string) string {
	if strings.TrimSpace(v) == "" {
		return "none"
	}
	return v
}

func actionForOptions(opts Options) string {
	if strings.TrimSpace(opts.StopSessionID) != "" {
		return "stop-direct-connect-session"
	}
	if strings.TrimSpace(opts.ResumeSessionID) != "" {
		return "resume-direct-connect"
	}
	return "open-direct-connect"
}

func hasFlag(args []string, flag string) bool {
	for _, arg := range args {
		if arg == flag {
			return true
		}
	}
	return false
}
