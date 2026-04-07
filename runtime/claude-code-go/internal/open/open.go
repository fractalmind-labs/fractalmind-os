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
	Status                        string
	Action                        string
	ConnectURL                    string
	Transport                     string
	ServerURL                     string
	AuthToken                     string
	PrintMode                     bool
	PrintPrompt                   string
	OutputFormat                  string
	RequestCWD                    string
	SessionID                     string
	WSURL                         string
	WorkDir                       string
	StreamValidated               bool
	StreamEvent                   string
	StreamContentValidated        bool
	StreamContentEvent            string
	SystemValidated               bool
	SystemEvent                   string
	StatusValidated               bool
	StatusEvent                   string
	AuthValidated                 bool
	AuthEvent                     string
	KeepAliveValidated            bool
	KeepAliveEvent                string
	ControlCancelValidated        bool
	ControlCancelEvent            string
	MessageValidated              bool
	MessageEvent                  string
	ValidatedTurns                int
	MultiTurnValidated            bool
	ResultValidated               bool
	ResultEvent                   string
	ResultErrorValidated          bool
	ResultErrorEvent              string
	ControlValidated              bool
	PermissionValidated           bool
	PermissionDeniedValidated     bool
	PermissionDeniedEvent         string
	TaskStartedValidated          bool
	TaskStartedEvent              string
	TaskProgressValidated         bool
	TaskProgressEvent             string
	TaskNotificationValidated     bool
	TaskNotificationEvent         string
	FilesPersistedValidated       bool
	FilesPersistedEvent           string
	APIRetryValidated             bool
	APIRetryEvent                 string
	LocalCommandOutputValidated   bool
	LocalCommandOutputEvent       string
	ElicitationValidated          bool
	ElicitationEvent              string
	HookCallbackValidated         bool
	HookCallbackEvent             string
	ChannelEnableValidated        bool
	ChannelEnableEvent            string
	ElicitationCompleteValidated  bool
	ElicitationCompleteEvent      string
	ToolProgressValidated         bool
	ToolProgressEvent             string
	RateLimitValidated            bool
	RateLimitEvent                string
	ToolUseSummaryValidated       bool
	ToolUseSummaryEvent           string
	PostTurnSummaryValidated      bool
	PostTurnSummaryEvent          string
	CompactBoundaryValidated      bool
	CompactBoundaryEvent          string
	SessionStateChangedValidated  bool
	SessionStateChangedEvent      string
	HookStartedValidated          bool
	HookStartedEvent              string
	HookProgressValidated         bool
	HookProgressEvent             string
	HookResponseValidated         bool
	HookResponseEvent             string
	ToolExecutionValidated        bool
	InterruptValidated            bool
	SetModelValidated             bool
	SetModelEvent                 string
	SetPermissionModeValidated    bool
	SetPermissionModeEvent        string
	SetMaxThinkingTokensValidated bool
	SetMaxThinkingTokensEvent     string
	MCPStatusValidated            bool
	MCPStatusEvent                string
	GetContextUsageValidated      bool
	GetContextUsageEvent          string
	MCPMessageValidated           bool
	MCPMessageEvent               string
	MCPSetServersValidated        bool
	MCPSetServersEvent            string
	ReloadPluginsValidated        bool
	ReloadPluginsEvent            string
	MCPReconnectValidated         bool
	MCPReconnectEvent             string
	MCPToggleValidated            bool
	MCPToggleEvent                string
	SeedReadStateValidated        bool
	SeedReadStateEvent            string
	RewindFilesValidated          bool
	RewindFilesEvent              string
	RewindFilesCanRewind          bool
	RewindFilesFilesChanged       int
	RewindFilesInsertions         int
	RewindFilesDeletions          int
	RewindFilesError              string
	CancelAsyncMessageValidated   bool
	CancelAsyncMessageEvent       string
	StopTaskValidated             bool
	StopTaskEvent                 string
	ApplyFlagSettingsValidated    bool
	ApplyFlagSettingsEvent        string
	GetSettingsValidated          bool
	GetSettingsEvent              string
	GenerateSessionTitleValidated bool
	GenerateSessionTitleEvent     string
	SideQuestionValidated         bool
	SideQuestionEvent             string
	InitializeValidated           bool
	InitializeEvent               string
	SetProactiveValidated         bool
	SetProactiveEvent             string
	BridgeStateValidated          bool
	BridgeStateEvent              string
	RemoteControlValidated        bool
	RemoteControlEvent            string
	EndSessionValidated           bool
	EndSessionEvent               string
	BackendValidated              bool
	BackendStatus                 string
	BackendPID                    int
	BackendStartedAt              int64
	BackendStoppedAt              int64
	BackendExitCode               int
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
		Status:                        "connected",
		Action:                        actionForOptions(opts),
		ConnectURL:                    opts.ConnectURL,
		Transport:                     transport,
		ServerURL:                     serverURL,
		AuthToken:                     authToken,
		PrintMode:                     opts.PrintMode,
		PrintPrompt:                   opts.PrintPrompt,
		OutputFormat:                  opts.OutputFormat,
		RequestCWD:                    cwd,
		SessionID:                     session.SessionID,
		WSURL:                         session.WSURL,
		WorkDir:                       session.WorkDir,
		StreamValidated:               true,
		StreamEvent:                   streamResult.StreamEvent,
		StreamContentValidated:        streamResult.StreamContentValidated,
		StreamContentEvent:            streamResult.StreamContentEvent,
		SystemValidated:               streamResult.SystemValidated,
		SystemEvent:                   streamResult.SystemEvent,
		StatusValidated:               streamResult.StatusValidated,
		StatusEvent:                   streamResult.StatusEvent,
		AuthValidated:                 streamResult.AuthValidated,
		AuthEvent:                     streamResult.AuthEvent,
		KeepAliveValidated:            streamResult.KeepAliveValidated,
		KeepAliveEvent:                streamResult.KeepAliveEvent,
		ControlCancelValidated:        streamResult.ControlCancelValidated,
		ControlCancelEvent:            streamResult.ControlCancelEvent,
		MessageValidated:              streamResult.MessageValidated,
		MessageEvent:                  streamResult.MessageEvent,
		ValidatedTurns:                streamResult.ValidatedTurns,
		MultiTurnValidated:            streamResult.MultiTurnValidated,
		ResultValidated:               streamResult.ResultValidated,
		ResultEvent:                   streamResult.ResultEvent,
		ResultErrorValidated:          streamResult.ResultErrorValidated,
		ResultErrorEvent:              streamResult.ResultErrorEvent,
		ControlValidated:              streamResult.ControlValidated,
		PermissionValidated:           streamResult.PermissionValidated,
		PermissionDeniedValidated:     streamResult.PermissionDeniedValidated,
		PermissionDeniedEvent:         streamResult.PermissionDeniedEvent,
		TaskStartedValidated:          streamResult.TaskStartedValidated,
		TaskStartedEvent:              streamResult.TaskStartedEvent,
		TaskProgressValidated:         streamResult.TaskProgressValidated,
		TaskProgressEvent:             streamResult.TaskProgressEvent,
		TaskNotificationValidated:     streamResult.TaskNotificationValidated,
		TaskNotificationEvent:         streamResult.TaskNotificationEvent,
		FilesPersistedValidated:       streamResult.FilesPersistedValidated,
		FilesPersistedEvent:           streamResult.FilesPersistedEvent,
		APIRetryValidated:             streamResult.APIRetryValidated,
		APIRetryEvent:                 streamResult.APIRetryEvent,
		LocalCommandOutputValidated:   streamResult.LocalCommandOutputValidated,
		LocalCommandOutputEvent:       streamResult.LocalCommandOutputEvent,
		ElicitationValidated:          streamResult.ElicitationValidated,
		ElicitationEvent:              streamResult.ElicitationEvent,
		HookCallbackValidated:         streamResult.HookCallbackValidated,
		HookCallbackEvent:             streamResult.HookCallbackEvent,
		ChannelEnableValidated:        streamResult.ChannelEnableValidated,
		ChannelEnableEvent:            streamResult.ChannelEnableEvent,
		ElicitationCompleteValidated:  streamResult.ElicitationCompleteValidated,
		ElicitationCompleteEvent:      streamResult.ElicitationCompleteEvent,
		ToolProgressValidated:         streamResult.ToolProgressValidated,
		ToolProgressEvent:             streamResult.ToolProgressEvent,
		RateLimitValidated:            streamResult.RateLimitValidated,
		RateLimitEvent:                streamResult.RateLimitEvent,
		ToolUseSummaryValidated:       streamResult.ToolUseSummaryValidated,
		ToolUseSummaryEvent:           streamResult.ToolUseSummaryEvent,
		PostTurnSummaryValidated:      streamResult.PostTurnSummaryValidated,
		PostTurnSummaryEvent:          streamResult.PostTurnSummaryEvent,
		CompactBoundaryValidated:      streamResult.CompactBoundaryValidated,
		CompactBoundaryEvent:          streamResult.CompactBoundaryEvent,
		SessionStateChangedValidated:  streamResult.SessionStateChangedValidated,
		SessionStateChangedEvent:      streamResult.SessionStateChangedEvent,
		HookStartedValidated:          streamResult.HookStartedValidated,
		HookStartedEvent:              streamResult.HookStartedEvent,
		HookProgressValidated:         streamResult.HookProgressValidated,
		HookProgressEvent:             streamResult.HookProgressEvent,
		HookResponseValidated:         streamResult.HookResponseValidated,
		HookResponseEvent:             streamResult.HookResponseEvent,
		ToolExecutionValidated:        streamResult.ToolExecutionValidated,
		InterruptValidated:            streamResult.InterruptValidated,
		SetModelValidated:             streamResult.SetModelValidated,
		SetModelEvent:                 streamResult.SetModelEvent,
		SetPermissionModeValidated:    streamResult.SetPermissionModeValidated,
		SetPermissionModeEvent:        streamResult.SetPermissionModeEvent,
		SetMaxThinkingTokensValidated: streamResult.SetMaxThinkingTokensValidated,
		SetMaxThinkingTokensEvent:     streamResult.SetMaxThinkingTokensEvent,
		MCPStatusValidated:            streamResult.MCPStatusValidated,
		MCPStatusEvent:                streamResult.MCPStatusEvent,
		GetContextUsageValidated:      streamResult.GetContextUsageValidated,
		GetContextUsageEvent:          streamResult.GetContextUsageEvent,
		MCPMessageValidated:           streamResult.MCPMessageValidated,
		MCPMessageEvent:               streamResult.MCPMessageEvent,
		MCPSetServersValidated:        streamResult.MCPSetServersValidated,
		MCPSetServersEvent:            streamResult.MCPSetServersEvent,
		ReloadPluginsValidated:        streamResult.ReloadPluginsValidated,
		ReloadPluginsEvent:            streamResult.ReloadPluginsEvent,
		MCPReconnectValidated:         streamResult.MCPReconnectValidated,
		MCPReconnectEvent:             streamResult.MCPReconnectEvent,
		MCPToggleValidated:            streamResult.MCPToggleValidated,
		MCPToggleEvent:                streamResult.MCPToggleEvent,
		SeedReadStateValidated:        streamResult.SeedReadStateValidated,
		SeedReadStateEvent:            streamResult.SeedReadStateEvent,
		RewindFilesValidated:          streamResult.RewindFilesValidated,
		RewindFilesEvent:              streamResult.RewindFilesEvent,
		RewindFilesCanRewind:          streamResult.RewindFilesCanRewind,
		RewindFilesFilesChanged:       streamResult.RewindFilesFilesChanged,
		RewindFilesInsertions:         streamResult.RewindFilesInsertions,
		RewindFilesDeletions:          streamResult.RewindFilesDeletions,
		RewindFilesError:              streamResult.RewindFilesError,
		CancelAsyncMessageValidated:   streamResult.CancelAsyncMessageValidated,
		CancelAsyncMessageEvent:       streamResult.CancelAsyncMessageEvent,
		StopTaskValidated:             streamResult.StopTaskValidated,
		StopTaskEvent:                 streamResult.StopTaskEvent,
		ApplyFlagSettingsValidated:    streamResult.ApplyFlagSettingsValidated,
		ApplyFlagSettingsEvent:        streamResult.ApplyFlagSettingsEvent,
		GetSettingsValidated:          streamResult.GetSettingsValidated,
		GetSettingsEvent:              streamResult.GetSettingsEvent,
		GenerateSessionTitleValidated: streamResult.GenerateSessionTitleValidated,
		GenerateSessionTitleEvent:     streamResult.GenerateSessionTitleEvent,
		SideQuestionValidated:         streamResult.SideQuestionValidated,
		SideQuestionEvent:             streamResult.SideQuestionEvent,
		InitializeValidated:           streamResult.InitializeValidated,
		InitializeEvent:               streamResult.InitializeEvent,
		SetProactiveValidated:         streamResult.SetProactiveValidated,
		SetProactiveEvent:             streamResult.SetProactiveEvent,
		BridgeStateValidated:          streamResult.BridgeStateValidated,
		BridgeStateEvent:              streamResult.BridgeStateEvent,
		RemoteControlValidated:        streamResult.RemoteControlValidated,
		RemoteControlEvent:            streamResult.RemoteControlEvent,
		EndSessionValidated:           streamResult.EndSessionValidated,
		EndSessionEvent:               streamResult.EndSessionEvent,
		BackendValidated:              state.BackendPID > 0 && strings.TrimSpace(state.BackendStatus) == "running",
		BackendStatus:                 state.BackendStatus,
		BackendPID:                    state.BackendPID,
		BackendStartedAt:              state.BackendStartedAt,
		BackendStoppedAt:              state.BackendStoppedAt,
		BackendExitCode:               state.BackendExitCode,
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
	StreamEvent                   string
	StreamContentValidated        bool
	StreamContentEvent            string
	SystemValidated               bool
	SystemEvent                   string
	StatusValidated               bool
	StatusEvent                   string
	AuthValidated                 bool
	AuthEvent                     string
	KeepAliveValidated            bool
	KeepAliveEvent                string
	ControlCancelValidated        bool
	ControlCancelEvent            string
	MessageValidated              bool
	MessageEvent                  string
	ValidatedTurns                int
	MultiTurnValidated            bool
	ResultValidated               bool
	ResultEvent                   string
	ResultErrorValidated          bool
	ResultErrorEvent              string
	ControlValidated              bool
	PermissionValidated           bool
	PermissionDeniedValidated     bool
	PermissionDeniedEvent         string
	TaskStartedValidated          bool
	TaskStartedEvent              string
	TaskProgressValidated         bool
	TaskProgressEvent             string
	TaskNotificationValidated     bool
	TaskNotificationEvent         string
	FilesPersistedValidated       bool
	FilesPersistedEvent           string
	APIRetryValidated             bool
	APIRetryEvent                 string
	LocalCommandOutputValidated   bool
	LocalCommandOutputEvent       string
	ElicitationValidated          bool
	ElicitationEvent              string
	HookCallbackValidated         bool
	HookCallbackEvent             string
	ChannelEnableValidated        bool
	ChannelEnableEvent            string
	ElicitationCompleteValidated  bool
	ElicitationCompleteEvent      string
	ToolProgressValidated         bool
	ToolProgressEvent             string
	RateLimitValidated            bool
	RateLimitEvent                string
	ToolUseSummaryValidated       bool
	ToolUseSummaryEvent           string
	PostTurnSummaryValidated      bool
	PostTurnSummaryEvent          string
	CompactBoundaryValidated      bool
	CompactBoundaryEvent          string
	SessionStateChangedValidated  bool
	SessionStateChangedEvent      string
	HookStartedValidated          bool
	HookStartedEvent              string
	HookProgressValidated         bool
	HookProgressEvent             string
	HookResponseValidated         bool
	HookResponseEvent             string
	ToolExecutionValidated        bool
	InterruptValidated            bool
	SetModelValidated             bool
	SetModelEvent                 string
	SetPermissionModeValidated    bool
	SetPermissionModeEvent        string
	SetMaxThinkingTokensValidated bool
	SetMaxThinkingTokensEvent     string
	MCPStatusValidated            bool
	MCPStatusEvent                string
	GetContextUsageValidated      bool
	GetContextUsageEvent          string
	MCPMessageValidated           bool
	MCPMessageEvent               string
	MCPSetServersValidated        bool
	MCPSetServersEvent            string
	ReloadPluginsValidated        bool
	ReloadPluginsEvent            string
	MCPReconnectValidated         bool
	MCPReconnectEvent             string
	MCPToggleValidated            bool
	MCPToggleEvent                string
	SeedReadStateValidated        bool
	SeedReadStateEvent            string
	RewindFilesValidated          bool
	RewindFilesEvent              string
	RewindFilesCanRewind          bool
	RewindFilesFilesChanged       int
	RewindFilesInsertions         int
	RewindFilesDeletions          int
	RewindFilesError              string
	CancelAsyncMessageValidated   bool
	CancelAsyncMessageEvent       string
	StopTaskValidated             bool
	StopTaskEvent                 string
	ApplyFlagSettingsValidated    bool
	ApplyFlagSettingsEvent        string
	GetSettingsValidated          bool
	GetSettingsEvent              string
	GenerateSessionTitleValidated bool
	GenerateSessionTitleEvent     string
	SideQuestionValidated         bool
	SideQuestionEvent             string
	InitializeValidated           bool
	InitializeEvent               string
	SetProactiveValidated         bool
	SetProactiveEvent             string
	BridgeStateValidated          bool
	BridgeStateEvent              string
	RemoteControlValidated        bool
	RemoteControlEvent            string
	EndSessionValidated           bool
	EndSessionEvent               string
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
	}
	for _, turn := range turns {
		currentToolUseID := ""
		currentRequestID := ""
		currentTaskID := ""
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
		filesPersistedValidated := false
		apiRetryValidated := false
		localCommandOutputValidated := false
		elicitationCompleteValidated := false
		postTurnSummaryValidated := false
		compactBoundaryValidated := false
		sessionStateRunningValidated := false
		sessionStateIdleValidated := false
		hookStartedValidated := false
		hookProgressValidated := false
		hookResponseValidated := false
		for {
			var incoming map[string]any
			if err := conn.ReadJSON(&incoming); err != nil {
				return streamValidation{}, fmt.Errorf("read direct-connect message flow: %w", err)
			}

			switch strings.TrimSpace(asString(incoming["type"])) {
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
					result.CompactBoundaryValidated = true
					result.CompactBoundaryEvent = "system:compact_boundary"
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
						if !sessionStateRunningValidated {
							return streamValidation{}, fmt.Errorf("invalid session_state_changed: idle seen before running")
						}
						sessionStateIdleValidated = true
						result.SessionStateChangedValidated = true
						result.SessionStateChangedEvent = "system:session_state_changed:idle"
					case "requires_action":
						return streamValidation{}, fmt.Errorf("unexpected session_state_changed state: %s", state)
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
				result.ToolUseSummaryValidated = true
				result.ToolUseSummaryEvent = "tool_use_summary"
			case "stream_event":
				if turn.behavior == "deny" {
					return streamValidation{}, fmt.Errorf("unexpected stream_event during deny turn")
				}
				if strings.TrimSpace(asString(incoming["session_id"])) == "" {
					return streamValidation{}, fmt.Errorf("invalid stream_event: missing session_id")
				}
				event, _ := incoming["event"].(map[string]any)
				if strings.TrimSpace(asString(event["type"])) != "content_block_delta" {
					return streamValidation{}, fmt.Errorf("invalid stream_event type: %s", asString(event["type"]))
				}
				delta, _ := event["delta"].(map[string]any)
				if strings.TrimSpace(asString(delta["type"])) != "text_delta" {
					return streamValidation{}, fmt.Errorf("invalid stream_event delta type: %s", asString(delta["type"]))
				}
				if strings.TrimSpace(asString(delta["text"])) != turn.expectedResponse {
					return streamValidation{}, fmt.Errorf("invalid stream_event delta text: expected %q, got %q", turn.expectedResponse, strings.TrimSpace(asString(delta["text"])))
				}
				result.StreamContentValidated = true
				result.StreamContentEvent = "stream_event:content_block_delta"
			case "assistant":
				if turn.behavior == "deny" {
					return streamValidation{}, fmt.Errorf("unexpected assistant payload during deny turn")
				}
				message, _ := incoming["message"].(map[string]any)
				content, _ := message["content"].([]any)
				found := false
				for _, item := range content {
					block, _ := item.(map[string]any)
					if strings.TrimSpace(asString(block["text"])) == turn.expectedResponse {
						found = true
						break
					}
				}
				if !found {
					return streamValidation{}, fmt.Errorf("invalid assistant payload: missing echo for %q", turn.approvedPrompt)
				}
				result.MessageValidated = true
				result.MessageEvent = "assistant"
				result.ToolExecutionValidated = true
				result.ValidatedTurns++
				assistantValidated = true
			case "result":
				if asString(incoming["session_id"]) == "" {
					return streamValidation{}, fmt.Errorf("invalid result event: missing session_id")
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
					result.ResultValidated = true
					result.ResultEvent = "result:success"
				} else {
					if strings.TrimSpace(asString(incoming["subtype"])) != "error_during_execution" {
						return streamValidation{}, fmt.Errorf("invalid deny result subtype: %s", asString(incoming["subtype"]))
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
				}
				resultValidated = true
			}
			if turn.behavior == "allow" && assistantValidated && resultValidated && taskStartedValidated && taskProgressValidated && taskNotificationValidated && filesPersistedValidated && apiRetryValidated && localCommandOutputValidated && elicitationCompleteValidated && postTurnSummaryValidated && compactBoundaryValidated && sessionStateIdleValidated && hookStartedValidated && hookProgressValidated && hookResponseValidated {
				break
			}
			if turn.behavior == "deny" && resultValidated {
				break
			}
		}
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
	for !result.SetPermissionModeValidated {
		var incoming map[string]any
		if err := conn.ReadJSON(&incoming); err != nil {
			return streamValidation{}, fmt.Errorf("read direct-connect set_permission_mode flow: %w", err)
		}
		if strings.TrimSpace(asString(incoming["type"])) != "control_response" {
			continue
		}
		response, _ := incoming["response"].(map[string]any)
		if strings.TrimSpace(asString(response["request_id"])) == setPermissionModeID {
			result.SetPermissionModeValidated = true
			result.SetPermissionModeEvent = "control_request:set_permission_mode"
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
	b.WriteString(fmt.Sprintf("system_validated=%t\n", r.SystemValidated))
	b.WriteString(fmt.Sprintf("system_event=%s\n", valueOrNone(r.SystemEvent)))
	b.WriteString(fmt.Sprintf("status_validated=%t\n", r.StatusValidated))
	b.WriteString(fmt.Sprintf("status_event=%s\n", valueOrNone(r.StatusEvent)))
	b.WriteString(fmt.Sprintf("auth_validated=%t\n", r.AuthValidated))
	b.WriteString(fmt.Sprintf("auth_event=%s\n", valueOrNone(r.AuthEvent)))
	b.WriteString(fmt.Sprintf("keep_alive_validated=%t\n", r.KeepAliveValidated))
	b.WriteString(fmt.Sprintf("keep_alive_event=%s\n", valueOrNone(r.KeepAliveEvent)))
	b.WriteString(fmt.Sprintf("control_cancel_validated=%t\n", r.ControlCancelValidated))
	b.WriteString(fmt.Sprintf("control_cancel_event=%s\n", valueOrNone(r.ControlCancelEvent)))
	b.WriteString(fmt.Sprintf("message_validated=%t\n", r.MessageValidated))
	b.WriteString(fmt.Sprintf("message_event=%s\n", valueOrNone(r.MessageEvent)))
	b.WriteString(fmt.Sprintf("validated_turns=%d\n", r.ValidatedTurns))
	b.WriteString(fmt.Sprintf("multi_turn_validated=%t\n", r.MultiTurnValidated))
	b.WriteString(fmt.Sprintf("result_validated=%t\n", r.ResultValidated))
	b.WriteString(fmt.Sprintf("result_event=%s\n", valueOrNone(r.ResultEvent)))
	b.WriteString(fmt.Sprintf("result_error_validated=%t\n", r.ResultErrorValidated))
	b.WriteString(fmt.Sprintf("result_error_event=%s\n", valueOrNone(r.ResultErrorEvent)))
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
	b.WriteString(fmt.Sprintf("post_turn_summary_validated=%t\n", r.PostTurnSummaryValidated))
	b.WriteString(fmt.Sprintf("post_turn_summary_event=%s\n", valueOrNone(r.PostTurnSummaryEvent)))
	b.WriteString(fmt.Sprintf("compact_boundary_validated=%t\n", r.CompactBoundaryValidated))
	b.WriteString(fmt.Sprintf("compact_boundary_event=%s\n", valueOrNone(r.CompactBoundaryEvent)))
	b.WriteString(fmt.Sprintf("session_state_changed_validated=%t\n", r.SessionStateChangedValidated))
	b.WriteString(fmt.Sprintf("session_state_changed_event=%s\n", valueOrNone(r.SessionStateChangedEvent)))
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
