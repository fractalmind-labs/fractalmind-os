package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

type Options struct {
	Port          int
	Host          string
	AuthToken     string
	Unix          string
	Workspace     string
	IdleTimeoutMs int
	MaxSessions   int
}

type Result struct {
	Status           string
	Action           string
	Transport        string
	Host             string
	Port             int
	Unix             string
	Workspace        string
	IdleTimeoutMs    int
	MaxSessions      int
	AuthToken        string
	AuthTokenSource  string
	SessionsEndpoint string
	LockfilePath     string
	SessionIndexPath string
}

type RunningServer struct {
	Result       Result
	server       *http.Server
	listener     net.Listener
	errCh        chan error
	lockfile     string
	store        *sessionStore
	sessionIndex *sessionIndexStore
}

type sessionInfo struct {
	ID      string
	WorkDir string
	Backend *backendProcess
}

type sessionStore struct {
	mu       sync.RWMutex
	sessions map[string]sessionInfo
}

type sessionRequest struct {
	CWD string `json:"cwd"`
}

type sessionResponse struct {
	SessionID string `json:"session_id"`
	WSURL     string `json:"ws_url"`
	WorkDir   string `json:"work_dir,omitempty"`
}

type sessionStateResponse struct {
	SessionID           string `json:"session_id"`
	TranscriptSessionID string `json:"transcript_session_id,omitempty"`
	WSURL               string `json:"ws_url,omitempty"`
	WorkDir             string `json:"work_dir,omitempty"`
	Status              string `json:"status,omitempty"`
	BackendStatus       string `json:"backend_status,omitempty"`
	BackendPID          int    `json:"backend_pid,omitempty"`
	BackendStartedAt    int64  `json:"backend_started_at,omitempty"`
	BackendStoppedAt    int64  `json:"backend_stopped_at,omitempty"`
	BackendExitCode     int    `json:"backend_exit_code,omitempty"`
	CreatedAt           int64  `json:"created_at,omitempty"`
	LastActiveAt        int64  `json:"last_active_at,omitempty"`
}

const directConnectEchoToolName = "echo"

func Run(args []string) (Result, error) {
	opts, authToken, authTokenSource, err := resolvedOptions(args)
	if err != nil {
		return Result{}, err
	}
	lockfilePath, err := defaultLockfilePath()
	if err != nil {
		return Result{}, err
	}
	sessionIndexPath, err := defaultSessionIndexPath()
	if err != nil {
		return Result{}, err
	}

	transport := "http"
	if strings.TrimSpace(opts.Unix) != "" {
		transport = "unix"
	}

	return Result{
		Status:           "stub",
		Action:           "start-server",
		Transport:        transport,
		Host:             opts.Host,
		Port:             opts.Port,
		Unix:             strings.TrimSpace(opts.Unix),
		Workspace:        strings.TrimSpace(opts.Workspace),
		IdleTimeoutMs:    opts.IdleTimeoutMs,
		MaxSessions:      opts.MaxSessions,
		AuthToken:        authToken,
		AuthTokenSource:  authTokenSource,
		LockfilePath:     lockfilePath,
		SessionIndexPath: sessionIndexPath,
	}, nil
}

func Start(args []string) (*RunningServer, error) {
	opts, authToken, authTokenSource, err := resolvedOptions(args)
	if err != nil {
		return nil, err
	}
	lockfilePath, err := defaultLockfilePath()
	if err != nil {
		return nil, err
	}
	sessionIndexPath, err := defaultSessionIndexPath()
	if err != nil {
		return nil, err
	}
	if existing, err := probeRunningServer(lockfilePath); err != nil {
		return nil, err
	} else if existing != nil {
		return nil, fmt.Errorf("server already running (pid %d) at %s", existing.PID, valueOrNone(existing.HTTPURL))
	}

	transportName := "http"
	if strings.TrimSpace(opts.Unix) != "" {
		transportName = "unix"
	}
	store := &sessionStore{sessions: map[string]sessionInfo{}}
	sessionIndex := newSessionIndexStore(sessionIndexPath)

	var (
		listener net.Listener
		result   Result
		wsBase   string
	)

	if strings.TrimSpace(opts.Unix) != "" {
		_ = os.Remove(opts.Unix)
		listener, err = net.Listen("unix", opts.Unix)
		if err != nil {
			return nil, fmt.Errorf("listen on unix socket: %w", err)
		}
		result = Result{
			Status:           "listening",
			Action:           "start-server",
			Transport:        "unix",
			Unix:             opts.Unix,
			Workspace:        strings.TrimSpace(opts.Workspace),
			IdleTimeoutMs:    opts.IdleTimeoutMs,
			MaxSessions:      opts.MaxSessions,
			AuthToken:        authToken,
			AuthTokenSource:  authTokenSource,
			SessionsEndpoint: "http://unix/sessions",
			LockfilePath:     lockfilePath,
			SessionIndexPath: sessionIndexPath,
		}
		wsBase = "ws+unix://" + url.PathEscape(opts.Unix) + "/ws"
	} else {
		listener, err = net.Listen("tcp", net.JoinHostPort(opts.Host, strconv.Itoa(opts.Port)))
		if err != nil {
			return nil, fmt.Errorf("listen on %s:%d: %w", opts.Host, opts.Port, err)
		}
		actualPort := listener.Addr().(*net.TCPAddr).Port
		result = Result{
			Status:           "listening",
			Action:           "start-server",
			Transport:        "http",
			Host:             opts.Host,
			Port:             actualPort,
			Workspace:        strings.TrimSpace(opts.Workspace),
			IdleTimeoutMs:    opts.IdleTimeoutMs,
			MaxSessions:      opts.MaxSessions,
			AuthToken:        authToken,
			AuthTokenSource:  authTokenSource,
			SessionsEndpoint: fmt.Sprintf("http://%s:%d/sessions", opts.Host, actualPort),
			LockfilePath:     lockfilePath,
			SessionIndexPath: sessionIndexPath,
		}
		wsBase = fmt.Sprintf("ws://%s:%d/ws", opts.Host, actualPort)
	}

	handler := buildMux(strings.TrimSpace(opts.Workspace), authToken, transportName, wsBase, store, sessionIndex, opts.MaxSessions)
	httpServer := &http.Server{Handler: handler}

	running := &RunningServer{
		Result:       result,
		server:       httpServer,
		listener:     listener,
		errCh:        make(chan error, 1),
		lockfile:     lockfilePath,
		store:        store,
		sessionIndex: sessionIndex,
	}
	if err := writeServerLock(lockfilePath, lockInfo{
		PID:       currentProcessID(),
		Host:      result.Host,
		Port:      result.Port,
		Unix:      result.Unix,
		HTTPURL:   result.SessionsEndpoint,
		StartedAt: nowUTC(),
	}); err != nil {
		_ = listener.Close()
		return nil, err
	}

	go func() {
		err := httpServer.Serve(listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			running.errCh <- err
			return
		}
		running.errCh <- nil
	}()

	return running, nil
}

func Serve(args []string, out io.Writer) error {
	running, err := Start(args)
	if err != nil {
		return err
	}

	if _, err := io.WriteString(out, running.Result.String()); err != nil {
		_ = running.Close()
		return err
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sigCh)

	select {
	case err := <-running.errCh:
		return err
	case <-sigCh:
		return running.Close()
	}
}

func (s *RunningServer) Close() error {
	if s == nil || s.server == nil {
		return nil
	}
	err := s.server.Shutdown(context.Background())
	if s.store != nil {
		if stopErr := s.store.stopAllBackends(s.sessionIndex); err == nil {
			err = stopErr
		}
	}
	if s.sessionIndex != nil {
		if stopErr := s.sessionIndex.setAllStatuses("stopped"); err == nil {
			err = stopErr
		}
	}
	if lockErr := removeServerLock(s.lockfile); err == nil {
		err = lockErr
	}
	if s.Result.Transport == "unix" && s.Result.Unix != "" {
		_ = os.Remove(s.Result.Unix)
	}
	if serveErr := <-s.errCh; err == nil {
		err = serveErr
	}
	return err
}

func buildMux(defaultWorkspace, authToken, transport, wsBase string, store *sessionStore, sessionIndex *sessionIndexStore, maxSessions int) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/sessions", func(w http.ResponseWriter, r *http.Request) {
		if strings.TrimSpace(authToken) != "" && r.Header.Get("Authorization") != "Bearer "+authToken {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Method == http.MethodGet {
			sessionID := strings.TrimSpace(r.URL.Query().Get("resume"))
			if sessionID == "" {
				http.Error(w, "missing resume session id", http.StatusBadRequest)
				return
			}
			entry, ok, err := sessionIndex.get(sessionID)
			if err != nil {
				http.Error(w, "failed to read session index", http.StatusInternalServerError)
				return
			}
			if !ok {
				http.Error(w, "session not found", http.StatusNotFound)
				return
			}
			if existing, ok := store.get(sessionID); ok {
				store.put(sessionInfo{ID: sessionID, WorkDir: entry.CWD, Backend: existing.Backend})
			} else if maxSessions > 0 && store.count() >= maxSessions {
				http.Error(w, fmt.Sprintf("max sessions reached (%d/%d)", store.count(), maxSessions), http.StatusTooManyRequests)
				return
			} else {
				store.put(sessionInfo{ID: sessionID, WorkDir: entry.CWD})
			}
			_ = sessionIndex.setStatus(sessionID, entry.CWD, "starting")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(sessionResponse{
				SessionID: sessionID,
				WSURL:     strings.TrimRight(wsBase, "/") + "/" + sessionID,
				WorkDir:   entry.CWD,
			})
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req sessionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}

		workDir := strings.TrimSpace(req.CWD)
		if workDir == "" {
			workDir = strings.TrimSpace(defaultWorkspace)
		}
		if maxSessions > 0 && store.count() >= maxSessions {
			http.Error(w, fmt.Sprintf("max sessions reached (%d/%d)", store.count(), maxSessions), http.StatusTooManyRequests)
			return
		}

		sessionID, err := generateSessionID()
		if err != nil {
			http.Error(w, "failed to generate session id", http.StatusInternalServerError)
			return
		}

		wsURL := strings.TrimRight(wsBase, "/") + "/" + sessionID
		if err := sessionIndex.upsert(sessionID, newSessionIndexEntry(sessionID, workDir)); err != nil {
			http.Error(w, "failed to persist session index", http.StatusInternalServerError)
			return
		}
		store.put(sessionInfo{ID: sessionID, WorkDir: workDir})

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(sessionResponse{
			SessionID: sessionID,
			WSURL:     wsURL,
			WorkDir:   workDir,
		})
	})
	mux.HandleFunc("/sessions/", func(w http.ResponseWriter, r *http.Request) {
		if strings.TrimSpace(authToken) != "" && r.Header.Get("Authorization") != "Bearer "+authToken {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodDelete {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		sessionID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/sessions/"))
		if sessionID == "" {
			http.Error(w, "missing session id", http.StatusBadRequest)
			return
		}
		entry, ok, err := sessionIndex.get(sessionID)
		if err != nil {
			http.Error(w, "failed to read session index", http.StatusInternalServerError)
			return
		}
		if !ok {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}
		if r.Method == http.MethodDelete {
			workDir := entry.CWD
			if live, ok := store.get(sessionID); ok {
				if live.Backend != nil {
					if err := live.Backend.stop(); err != nil {
						http.Error(w, "failed to stop backend", http.StatusInternalServerError)
						return
					}
					if err := sessionIndex.setBackendSnapshot(sessionID, live.WorkDir, live.Backend.snapshot()); err != nil {
						http.Error(w, "failed to persist backend lifecycle", http.StatusInternalServerError)
						return
					}
					workDir = firstNonEmpty(live.WorkDir, workDir)
				}
				store.delete(sessionID)
			} else {
				if err := sessionIndex.setBackendSnapshot(sessionID, workDir, backendSnapshot{Status: "stopped"}); err != nil {
					http.Error(w, "failed to persist backend lifecycle", http.StatusInternalServerError)
					return
				}
			}
			if err := sessionIndex.setStatus(sessionID, workDir, "stopped"); err != nil {
				http.Error(w, "failed to persist session state", http.StatusInternalServerError)
				return
			}
			stoppedEntry, _, err := sessionIndex.get(sessionID)
			if err != nil {
				http.Error(w, "failed to read session index", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(sessionStateResponse{
				SessionID:           stoppedEntry.SessionID,
				TranscriptSessionID: stoppedEntry.TranscriptSessionID,
				WSURL:               strings.TrimRight(wsBase, "/") + "/" + sessionID,
				WorkDir:             stoppedEntry.CWD,
				Status:              stoppedEntry.Status,
				BackendStatus:       stoppedEntry.BackendStatus,
				BackendPID:          stoppedEntry.BackendPID,
				BackendStartedAt:    stoppedEntry.BackendStartedAt,
				BackendStoppedAt:    stoppedEntry.BackendStoppedAt,
				BackendExitCode:     stoppedEntry.BackendExitCode,
				CreatedAt:           stoppedEntry.CreatedAt,
				LastActiveAt:        stoppedEntry.LastActiveAt,
			})
			return
		}
		if live, ok := store.get(sessionID); ok && live.Backend != nil {
			snap := live.Backend.snapshot()
			entry.BackendStatus = snap.Status
			entry.BackendPID = snap.PID
			entry.BackendStartedAt = snap.StartedAt
			entry.BackendStoppedAt = snap.StoppedAt
			entry.BackendExitCode = snap.ExitCode
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(sessionStateResponse{
			SessionID:           entry.SessionID,
			TranscriptSessionID: entry.TranscriptSessionID,
			WSURL:               strings.TrimRight(wsBase, "/") + "/" + sessionID,
			WorkDir:             entry.CWD,
			Status:              entry.Status,
			BackendStatus:       entry.BackendStatus,
			BackendPID:          entry.BackendPID,
			BackendStartedAt:    entry.BackendStartedAt,
			BackendStoppedAt:    entry.BackendStoppedAt,
			BackendExitCode:     entry.BackendExitCode,
			CreatedAt:           entry.CreatedAt,
			LastActiveAt:        entry.LastActiveAt,
		})
	})
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	mux.HandleFunc("/ws/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if strings.TrimSpace(authToken) != "" && r.Header.Get("Authorization") != "Bearer "+authToken {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		sessionID := strings.TrimPrefix(r.URL.Path, "/ws/")
		sessionID = strings.TrimSpace(sessionID)
		if sessionID == "" {
			http.Error(w, "missing session id", http.StatusBadRequest)
			return
		}
		session, ok := store.get(sessionID)
		if !ok {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}
		session, err := store.ensureBackend(sessionID)
		if err != nil {
			http.Error(w, "failed to start backend process", http.StatusInternalServerError)
			return
		}
		if err := sessionIndex.setBackendSnapshot(sessionID, session.WorkDir, session.Backend.snapshot()); err != nil {
			http.Error(w, "failed to persist backend lifecycle", http.StatusInternalServerError)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() {
			_ = sessionIndex.setStatus(sessionID, session.WorkDir, "detached")
			_ = conn.Close()
		}()
		_ = sessionIndex.touch(sessionID, session.WorkDir)
		event := map[string]string{
			"type":       "session_ready",
			"session_id": session.ID,
			"work_dir":   session.WorkDir,
			"transport":  transport,
		}
		_ = conn.WriteJSON(event)
		initUUID, err := generateRequestID()
		if err != nil {
			return
		}
		_ = conn.WriteJSON(map[string]any{
			"type":                "system",
			"subtype":             "init",
			"apiKeySource":        "oauth",
			"claude_code_version": "claude-code-go-dev",
			"cwd":                 session.WorkDir,
			"tools":               []string{directConnectEchoToolName},
			"mcp_servers":         []map[string]any{},
			"model":               "claude-sonnet-4-5",
			"permissionMode":      "default",
			"slash_commands":      []string{},
			"output_style":        "text",
			"skills":              []string{},
			"plugins":             []map[string]any{},
			"uuid":                initUUID,
			"session_id":          session.ID,
		})
		authUUID, err := generateRequestID()
		if err != nil {
			return
		}
		_ = conn.WriteJSON(map[string]any{
			"type":             "auth_status",
			"isAuthenticating": false,
			"output":           []string{"oauth"},
			"uuid":             authUUID,
			"session_id":       session.ID,
		})
		statusUUID, err := generateRequestID()
		if err != nil {
			return
		}
		_ = conn.WriteJSON(map[string]any{
			"type":           "system",
			"subtype":        "status",
			"status":         nil,
			"permissionMode": "default",
			"uuid":           statusUUID,
			"session_id":     session.ID,
		})
		_ = conn.WriteJSON(map[string]any{
			"type": "keep_alive",
		})
		var (
			pendingPrompt    string
			pendingRequestID string
			pendingToolUseID string
			completedTurns   int
		)
		for {
			var incoming map[string]any
			if err := conn.ReadJSON(&incoming); err != nil {
				if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) ||
					errors.Is(err, io.EOF) {
					return
				}
				return
			}

			switch strings.TrimSpace(asString(incoming["type"])) {
			case "user":
				_ = sessionIndex.setStatus(sessionID, session.WorkDir, "running")
				runningStateUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":       "system",
					"subtype":    "session_state_changed",
					"state":      "running",
					"uuid":       runningStateUUID,
					"session_id": session.ID,
				})
				pendingPrompt = extractPromptText(incoming)
				requestID, err := generateRequestID()
				if err != nil {
					return
				}
				toolUseID, err := generateRequestID()
				if err != nil {
					return
				}
				pendingRequestID = requestID
				pendingToolUseID = toolUseID
				_ = conn.WriteJSON(map[string]any{
					"type":       "control_request",
					"request_id": requestID,
					"request": map[string]any{
						"subtype":      "can_use_tool",
						"tool_name":    directConnectEchoToolName,
						"tool_use_id":  toolUseID,
						"title":        "direct-connect echo tool request",
						"display_name": "Echo",
						"description":  "Minimal direct-connect tool execution request",
						"input": map[string]any{
							"text": pendingPrompt,
						},
					},
				})
			case "control_response":
				if pendingPrompt == "" {
					continue
				}
				responseEnvelope, _ := incoming["response"].(map[string]any)
				if strings.TrimSpace(asString(responseEnvelope["request_id"])) != pendingRequestID {
					continue
				}
				responsePayload, _ := responseEnvelope["response"].(map[string]any)
				if behavior := strings.TrimSpace(asString(responsePayload["behavior"])); behavior == "deny" {
					resultUUID, err := generateRequestID()
					if err != nil {
						return
					}
					_ = conn.WriteJSON(map[string]any{
						"type":            "result",
						"subtype":         "error_during_execution",
						"duration_ms":     1,
						"duration_api_ms": 0,
						"is_error":        true,
						"num_turns":       completedTurns,
						"stop_reason":     "permission_denied",
						"total_cost_usd":  0,
						"usage":           map[string]any{},
						"modelUsage":      map[string]any{"claude-sonnet-4-5": minimalModelUsage()},
						"permission_denials": []map[string]any{
							{
								"tool_name":   directConnectEchoToolName,
								"tool_use_id": pendingToolUseID,
								"tool_input": map[string]any{
									"text": pendingPrompt,
								},
							},
						},
						"errors":     []string{"permission denied for tool " + directConnectEchoToolName},
						"uuid":       resultUUID,
						"session_id": session.ID,
					})
					pendingPrompt = ""
					pendingRequestID = ""
					pendingToolUseID = ""
					continue
				}
				toolInputText := pendingPrompt
				if updatedInput, ok := responsePayload["updatedInput"].(map[string]any); ok {
					if updatedText := strings.TrimSpace(asString(updatedInput["text"])); updatedText != "" {
						toolInputText = updatedText
					}
				}
				_ = sessionIndex.setStatus(sessionID, session.WorkDir, "running")
				_ = conn.WriteJSON(map[string]any{
					"type":       "control_cancel_request",
					"request_id": pendingRequestID,
				})
				taskID := "task-" + pendingToolUseID
				taskDescription := "direct-connect echo task"
				taskStartedUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":          "system",
					"subtype":       "task_started",
					"task_id":       taskID,
					"tool_use_id":   pendingToolUseID,
					"description":   taskDescription,
					"task_type":     "tool",
					"workflow_name": "direct-connect",
					"prompt":        toolInputText,
					"uuid":          taskStartedUUID,
					"session_id":    session.ID,
				})
				taskProgressUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":           "system",
					"subtype":        "task_progress",
					"task_id":        taskID,
					"tool_use_id":    pendingToolUseID,
					"description":    taskDescription,
					"usage":          map[string]any{"total_tokens": 0, "tool_uses": 1, "duration_ms": 1},
					"last_tool_name": directConnectEchoToolName,
					"summary":        "direct-connect echo task approved",
					"uuid":           taskProgressUUID,
					"session_id":     session.ID,
				})
				apiRetryUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":           "system",
					"subtype":        "api_retry",
					"attempt":        1,
					"max_retries":    3,
					"retry_delay_ms": 500,
					"error_status":   529,
					"error":          "rate_limit",
					"uuid":           apiRetryUUID,
					"session_id":     session.ID,
				})
				progressUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":                 "tool_progress",
					"tool_use_id":          pendingToolUseID,
					"tool_name":            directConnectEchoToolName,
					"parent_tool_use_id":   nil,
					"elapsed_time_seconds": 0,
					"uuid":                 progressUUID,
					"session_id":           session.ID,
				})
				rateLimitUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":       "rate_limit_event",
					"bucket":     "default",
					"limit":      100,
					"remaining":  99,
					"reset_secs": 60,
					"uuid":       rateLimitUUID,
					"session_id": session.ID,
				})
				responseText, err := session.Backend.roundTrip(toolInputText)
				if err != nil {
					return
				}
				_ = sessionIndex.setBackendSnapshot(sessionID, session.WorkDir, session.Backend.snapshot())
				streamUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type": "stream_event",
					"event": map[string]any{
						"type":  "content_block_delta",
						"index": 0,
						"delta": map[string]any{
							"type": "text_delta",
							"text": responseText,
						},
					},
					"parent_tool_use_id": nil,
					"uuid":               streamUUID,
					"session_id":         session.ID,
				})
				_ = conn.WriteJSON(map[string]any{
					"type": "assistant",
					"message": map[string]any{
						"role": "assistant",
						"content": []map[string]any{
							{
								"type": "text",
								"text": responseText,
							},
						},
					},
				})
				toolSummaryUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":           "tool_use_summary",
					"tool_name":      directConnectEchoToolName,
					"tool_use_id":    pendingToolUseID,
					"duration_ms":    1,
					"input_preview":  toolInputText,
					"output_preview": responseText,
					"uuid":           toolSummaryUUID,
					"session_id":     session.ID,
				})
				completedTurns++
				resultUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":               "result",
					"subtype":            "success",
					"duration_ms":        1,
					"duration_api_ms":    0,
					"is_error":           false,
					"num_turns":          completedTurns,
					"result":             responseText,
					"stop_reason":        nil,
					"total_cost_usd":     0,
					"usage":              map[string]any{},
					"modelUsage":         map[string]any{"claude-sonnet-4-5": minimalModelUsage()},
					"permission_denials": []map[string]any{},
					"uuid":               resultUUID,
					"session_id":         session.ID,
				})
				taskNotificationUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":        "system",
					"subtype":     "task_notification",
					"task_id":     taskID,
					"tool_use_id": pendingToolUseID,
					"status":      "completed",
					"output_file": session.WorkDir + "/.claude-code-go/tasks/" + taskID + ".log",
					"summary":     responseText,
					"usage":       map[string]any{"total_tokens": 0, "tool_uses": 1, "duration_ms": 1},
					"uuid":        taskNotificationUUID,
					"session_id":  session.ID,
				})
				filesPersistedUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":    "system",
					"subtype": "files_persisted",
					"files": []map[string]any{
						{
							"filename": session.WorkDir + "/.claude-code-go/tasks/" + taskID + ".log",
							"file_id":  taskID + "-output",
						},
					},
					"failed":       []map[string]any{},
					"processed_at": time.Now().UTC().Format(time.RFC3339),
					"uuid":         filesPersistedUUID,
					"session_id":   session.ID,
				})
				localCommandOutputUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":       "system",
					"subtype":    "local_command_output",
					"content":    "local command output: persisted direct-connect artifacts",
					"uuid":       localCommandOutputUUID,
					"session_id": session.ID,
				})
				elicitationCompleteUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":            "system",
					"subtype":         "elicitation_complete",
					"mcp_server_name": "demo-mcp-server",
					"elicitation_id":  "elicitation-direct-connect-echo",
					"uuid":            elicitationCompleteUUID,
					"session_id":      session.ID,
				})
				postTurnUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":            "system",
					"subtype":         "post_turn_summary",
					"summarizes_uuid": resultUUID,
					"status_category": "completed",
					"status_detail":   "direct-connect turn completed",
					"is_noteworthy":   false,
					"title":           "Turn complete",
					"description":     "Minimal direct-connect post-turn summary emitted by claude-code-go",
					"recent_action":   "Executed echo tool and returned assistant/result events",
					"needs_action":    "none",
					"artifact_urls":   []string{},
					"uuid":            postTurnUUID,
					"session_id":      session.ID,
				})
				compactBoundaryUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":    "system",
					"subtype": "compact_boundary",
					"compact_metadata": map[string]any{
						"trigger":    "auto",
						"pre_tokens": 128,
					},
					"uuid":       compactBoundaryUUID,
					"session_id": session.ID,
				})
				idleStateUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = sessionIndex.setStatus(sessionID, session.WorkDir, "idle")
				_ = conn.WriteJSON(map[string]any{
					"type":       "system",
					"subtype":    "session_state_changed",
					"state":      "idle",
					"uuid":       idleStateUUID,
					"session_id": session.ID,
				})
				hookStartedUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":       "system",
					"subtype":    "hook_started",
					"hook_id":    "hook-direct-connect-echo",
					"hook_name":  "DirectConnectEchoHook",
					"hook_event": "Stop",
					"uuid":       hookStartedUUID,
					"session_id": session.ID,
				})
				hookProgressUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":       "system",
					"subtype":    "hook_progress",
					"hook_id":    "hook-direct-connect-echo",
					"hook_name":  "DirectConnectEchoHook",
					"hook_event": "Stop",
					"output":     "echo hook running",
					"stdout":     responseText,
					"stderr":     "",
					"uuid":       hookProgressUUID,
					"session_id": session.ID,
				})
				hookResponseUUID, err := generateRequestID()
				if err != nil {
					return
				}
				_ = conn.WriteJSON(map[string]any{
					"type":       "system",
					"subtype":    "hook_response",
					"hook_id":    "hook-direct-connect-echo",
					"hook_name":  "DirectConnectEchoHook",
					"hook_event": "Stop",
					"output":     "echo hook completed",
					"stdout":     responseText,
					"stderr":     "",
					"exit_code":  0,
					"outcome":    "success",
					"uuid":       hookResponseUUID,
					"session_id": session.ID,
				})
				pendingPrompt = ""
				pendingRequestID = ""
				pendingToolUseID = ""
			case "control_request":
				_ = sessionIndex.setStatus(sessionID, session.WorkDir, "running")
				requestID := strings.TrimSpace(asString(incoming["request_id"]))
				request, _ := incoming["request"].(map[string]any)
				subtype := strings.TrimSpace(asString(request["subtype"]))
				if requestID == "" {
					continue
				}
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
				case "cancel_async_message":
					responsePayload["cancelled"] = false
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
				if subtype == "end_session" {
					return
				}
			}
		}
	})
	return mux
}

func (s *sessionStore) put(info sessionInfo) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[info.ID] = info
}

func (s *sessionStore) get(id string) (sessionInfo, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	info, ok := s.sessions[id]
	return info, ok
}

func (s *sessionStore) count() int {
	if s == nil {
		return 0
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.sessions)
}

func (s *sessionStore) delete(id string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, id)
}

func (s *sessionStore) ensureBackend(id string) (sessionInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	info, ok := s.sessions[id]
	if !ok {
		return sessionInfo{}, fmt.Errorf("session %s not found", id)
	}
	if info.Backend == nil || info.Backend.snapshot().Status == "stopped" {
		backend, err := startBackendProcess()
		if err != nil {
			return sessionInfo{}, err
		}
		info.Backend = backend
		s.sessions[id] = info
	}
	return info, nil
}

func (s *sessionStore) stopAllBackends(sessionIndex *sessionIndexStore) error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	sessions := make([]sessionInfo, 0, len(s.sessions))
	for _, info := range s.sessions {
		sessions = append(sessions, info)
	}
	s.mu.Unlock()

	var firstErr error
	for _, info := range sessions {
		if info.Backend == nil {
			continue
		}
		if err := info.Backend.stop(); err != nil && firstErr == nil {
			firstErr = err
		}
		if sessionIndex != nil {
			if err := sessionIndex.setBackendSnapshot(info.ID, info.WorkDir, info.Backend.snapshot()); err != nil && firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

func resolvedOptions(args []string) (Options, string, string, error) {
	opts, err := parseArgs(args)
	if err != nil {
		return Options{}, "", "", err
	}

	authToken := strings.TrimSpace(opts.AuthToken)
	authTokenSource := "provided"
	if authToken == "" {
		authTokenSource = "generated"
		authToken, err = generateAuthToken()
		if err != nil {
			return Options{}, "", "", fmt.Errorf("generate auth token: %w", err)
		}
	}
	return opts, authToken, authTokenSource, nil
}

func parseArgs(args []string) (Options, error) {
	opts := Options{
		Port:          0,
		Host:          "0.0.0.0",
		IdleTimeoutMs: 600000,
		MaxSessions:   32,
	}

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--port":
			if i+1 >= len(args) {
				return Options{}, fmt.Errorf("--port requires a value")
			}
			value, err := strconv.Atoi(args[i+1])
			if err != nil || value < 0 {
				return Options{}, fmt.Errorf("invalid --port %q", args[i+1])
			}
			opts.Port = value
			i++
		case "--host":
			if i+1 >= len(args) {
				return Options{}, fmt.Errorf("--host requires a value")
			}
			opts.Host = args[i+1]
			i++
		case "--auth-token":
			if i+1 >= len(args) {
				return Options{}, fmt.Errorf("--auth-token requires a value")
			}
			opts.AuthToken = args[i+1]
			i++
		case "--unix":
			if i+1 >= len(args) {
				return Options{}, fmt.Errorf("--unix requires a value")
			}
			opts.Unix = args[i+1]
			i++
		case "--workspace":
			if i+1 >= len(args) {
				return Options{}, fmt.Errorf("--workspace requires a value")
			}
			opts.Workspace = args[i+1]
			i++
		case "--idle-timeout":
			if i+1 >= len(args) {
				return Options{}, fmt.Errorf("--idle-timeout requires a value")
			}
			value, err := strconv.Atoi(args[i+1])
			if err != nil || value < 0 {
				return Options{}, fmt.Errorf("invalid --idle-timeout %q", args[i+1])
			}
			opts.IdleTimeoutMs = value
			i++
		case "--max-sessions":
			if i+1 >= len(args) {
				return Options{}, fmt.Errorf("--max-sessions requires a value")
			}
			value, err := strconv.Atoi(args[i+1])
			if err != nil || value < 0 {
				return Options{}, fmt.Errorf("invalid --max-sessions %q", args[i+1])
			}
			opts.MaxSessions = value
			i++
		default:
			return Options{}, fmt.Errorf("usage: claude-code-go server [--port <number>] [--host <string>] [--auth-token <token>] [--unix <path>] [--workspace <dir>] [--idle-timeout <ms>] [--max-sessions <n>]")
		}
	}

	return opts, nil
}

func generateAuthToken() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "sk-ant-cc-" + hex.EncodeToString(buf), nil
}

func generateSessionID() (string, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "sess-" + hex.EncodeToString(buf), nil
}

func generateRequestID() (string, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "req-" + hex.EncodeToString(buf), nil
}

func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func extractPromptText(payload map[string]any) string {
	message, _ := payload["message"].(map[string]any)
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

func (r Result) String() string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("status=%s\n", r.Status))
	b.WriteString(fmt.Sprintf("action=%s\n", r.Action))
	b.WriteString(fmt.Sprintf("transport=%s\n", r.Transport))
	if r.Transport == "unix" {
		b.WriteString(fmt.Sprintf("unix=%s\n", valueOrNone(r.Unix)))
	} else {
		b.WriteString(fmt.Sprintf("host=%s\n", valueOrNone(r.Host)))
		b.WriteString(fmt.Sprintf("port=%d\n", r.Port))
	}
	b.WriteString(fmt.Sprintf("workspace=%s\n", valueOrNone(r.Workspace)))
	b.WriteString(fmt.Sprintf("idle_timeout_ms=%d\n", r.IdleTimeoutMs))
	b.WriteString(fmt.Sprintf("max_sessions=%d\n", r.MaxSessions))
	b.WriteString(fmt.Sprintf("auth_token=%s\n", valueOrNone(r.AuthToken)))
	b.WriteString(fmt.Sprintf("auth_token_source=%s\n", valueOrNone(r.AuthTokenSource)))
	b.WriteString(fmt.Sprintf("sessions_endpoint=%s\n", valueOrNone(r.SessionsEndpoint)))
	b.WriteString(fmt.Sprintf("lockfile_path=%s\n", valueOrNone(r.LockfilePath)))
	b.WriteString(fmt.Sprintf("session_index_path=%s\n", valueOrNone(r.SessionIndexPath)))
	return b.String()
}

func valueOrNone(v string) string {
	if strings.TrimSpace(v) == "" {
		return "none"
	}
	return v
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func minimalModelUsage() map[string]any {
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
