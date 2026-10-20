// Package agentruntime defines the runtime-neutral delivery contract shared by
// the Agent Manager and autonomous schedulers.
package agentruntime

import (
	"context"
	"time"
)

const (
	OhMyCode      = "ohMyCode"
	CodexAppCDP   = "codexAppCDP"
	ClaudeDesktop = "claudeDesktop"

	// DispatchModeHeartbeatRun asks the ohMyCode adapter to execute the
	// agent-manager heartbeat lifecycle instead of enqueueing a generic task.
	DispatchModeHeartbeatRun = "heartbeatRun"
)

// DispatchRequest is an internal agent wakeup that is not associated with a
// messaging channel.
type DispatchRequest struct {
	Runtime string
	Agent   string
	// Target names a receiver target under agents.ohMyCode.targets whose
	// destination to use: its Claude Desktop inbox for claudeDesktop, or its
	// agent-manager workspace and script for ohMyCode. Empty uses the shared
	// runtime settings.
	Target         string
	Text           string
	Source         string
	JobID          string
	RunID          string
	ScheduledAt    time.Time
	ExpiresAt      time.Time
	CoalesceKey    string
	CronProfiles   []string
	StartIfMissing bool
	DispatchMode   string
	Timeout        time.Duration
}

// DispatchResult reports a runtime delivery outcome. Most statuses only mean
// accepted, queued, or rejected; an explicitly completion-aware dispatch mode
// may report a terminal lifecycle outcome instead.
type DispatchResult struct {
	Runtime    string
	Agent      string
	Status     string
	EnvelopeID string
	InboxPath  string
	Error      string
}

// Dispatcher routes a request to an explicitly selected Agent Runtime.
type Dispatcher interface {
	DispatchRuntime(ctx context.Context, request DispatchRequest) DispatchResult
}
