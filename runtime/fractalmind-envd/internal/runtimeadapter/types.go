package runtimeadapter

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	SchemaVersion     = "1"
	AdapterName       = "agent-manager-runtime"
	MaxTimeoutSeconds = 300
	MaxTaskBytes      = 16 << 10
	MaxLogLines       = 1000
	DefaultLogLines   = 100
)

var stableErrorCodes = map[string]struct{}{
	"cancelled": {}, "duplicate_command_id": {}, "internal_error": {},
	"malformed_input": {}, "missing_agent": {}, "missing_command_id": {},
	"operation_failed": {}, "timeout": {}, "unsupported_operation": {},
}

type Operation string

const (
	OperationInventory    Operation = "inventory"
	OperationStatus       Operation = "status"
	OperationStart        Operation = "start"
	OperationStop         Operation = "stop"
	OperationAssign       Operation = "assign"
	OperationMonitor      Operation = "monitor"
	OperationLogs         Operation = "logs"
	OperationHealth       Operation = "health"
	OperationAvailability Operation = "availability"
)

type Request struct {
	SchemaVersion  string           `json:"schema_version"`
	CommandID      string           `json:"command_id"`
	IdempotencyKey string           `json:"idempotency_key,omitempty"`
	Operation      Operation        `json:"operation"`
	Agent          string           `json:"agent,omitempty"`
	TimeoutSeconds float64          `json:"timeout_seconds,omitempty"`
	Cancel         bool             `json:"cancel,omitempty"`
	Params         *OperationParams `json:"params,omitempty"`
}

// OperationParams is the complete set of local runtime inputs that a signed
// command may control. The executor validates the operation-specific subset
// before this value reaches agent-manager.
type OperationParams struct {
	Restore *bool  `json:"restore,omitempty"`
	Task    string `json:"task,omitempty"`
	Lines   *int   `json:"lines,omitempty"`
	Follow  *bool  `json:"follow,omitempty"`
}

func (r Request) Validate() error {
	if r.SchemaVersion != SchemaVersion {
		return fmt.Errorf("unsupported schema_version %q", r.SchemaVersion)
	}
	if strings.TrimSpace(r.CommandID) == "" {
		return fmt.Errorf("command_id is required")
	}
	if !r.Operation.Valid() {
		return fmt.Errorf("unsupported operation %q", r.Operation)
	}
	if r.Operation.RequiresAgent() && strings.TrimSpace(r.Agent) == "" {
		return fmt.Errorf("agent is required for %s", r.Operation)
	}
	if !r.Operation.RequiresAgent() && strings.TrimSpace(r.Agent) != "" {
		return fmt.Errorf("agent is not allowed for node-wide operation %s", r.Operation)
	}
	if r.TimeoutSeconds < 0 {
		return fmt.Errorf("timeout_seconds cannot be negative")
	}
	if r.TimeoutSeconds > MaxTimeoutSeconds {
		return fmt.Errorf("timeout_seconds exceeds %d", MaxTimeoutSeconds)
	}
	if err := r.validateParams(); err != nil {
		return err
	}
	return nil
}

func (r Request) validateParams() error {
	params := r.Params
	switch r.Operation {
	case OperationStart:
		if params == nil {
			return nil
		}
		if params.Task != "" || params.Lines != nil || params.Follow != nil {
			return fmt.Errorf("start only accepts restore")
		}
	case OperationAssign:
		if params == nil || strings.TrimSpace(params.Task) == "" {
			return fmt.Errorf("assign requires an inline task")
		}
		if len(params.Task) > MaxTaskBytes {
			return fmt.Errorf("assign task exceeds %d bytes", MaxTaskBytes)
		}
		if params.Restore != nil || params.Lines != nil || params.Follow != nil {
			return fmt.Errorf("assign only accepts an inline task")
		}
	case OperationMonitor, OperationLogs:
		if params == nil || params.Lines == nil || params.Follow == nil {
			return fmt.Errorf("%s requires bounded lines and follow=false", r.Operation)
		}
		if *params.Lines < 1 || *params.Lines > MaxLogLines {
			return fmt.Errorf("lines must be between 1 and %d", MaxLogLines)
		}
		if *params.Follow {
			return fmt.Errorf("follow mode is not allowed")
		}
		if params.Restore != nil || params.Task != "" {
			return fmt.Errorf("%s only accepts lines", r.Operation)
		}
	default:
		if params != nil {
			return fmt.Errorf("%s does not accept params", r.Operation)
		}
	}
	return nil
}

func (o Operation) Valid() bool {
	switch o {
	case OperationInventory, OperationStatus, OperationStart, OperationStop,
		OperationAssign, OperationMonitor, OperationLogs, OperationHealth,
		OperationAvailability:
		return true
	default:
		return false
	}
}

func (o Operation) RequiresAgent() bool {
	switch o {
	case OperationStatus, OperationStart, OperationStop, OperationAssign,
		OperationMonitor, OperationLogs, OperationAvailability:
		return true
	default:
		return false
	}
}

type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Detail  string `json:"detail,omitempty"`
}

type Response struct {
	SchemaVersion string          `json:"schema_version"`
	Adapter       string          `json:"adapter"`
	CommandID     string          `json:"command_id"`
	Operation     Operation       `json:"operation"`
	Duplicate     bool            `json:"duplicate"`
	OK            bool            `json:"ok"`
	ObservedAt    string          `json:"observed_at"`
	Result        json.RawMessage `json:"result"`
	Error         *Error          `json:"error"`
}

func (r Response) Validate(request Request) error {
	if r.SchemaVersion != SchemaVersion {
		return fmt.Errorf("adapter returned schema_version %q", r.SchemaVersion)
	}
	if r.Adapter != AdapterName {
		return fmt.Errorf("adapter returned name %q", r.Adapter)
	}
	if r.CommandID != request.CommandID {
		return fmt.Errorf("adapter returned command_id %q", r.CommandID)
	}
	if r.Operation != request.Operation {
		return fmt.Errorf("adapter returned operation %q", r.Operation)
	}
	if r.OK && r.Error != nil {
		return fmt.Errorf("successful adapter response includes an error")
	}
	if !r.OK && r.Error == nil {
		return fmt.Errorf("failed adapter response has no error")
	}
	if r.Error != nil {
		if _, ok := stableErrorCodes[r.Error.Code]; !ok {
			return fmt.Errorf("adapter returned unstable error code %q", r.Error.Code)
		}
	}
	if strings.TrimSpace(r.ObservedAt) == "" {
		return fmt.Errorf("adapter response has no observed_at")
	}
	return nil
}

// Adapter is sealed to this package: callers can select a local adapter and
// pass it to NewExecutor, but cannot invoke the runtime without validation.
type Adapter interface {
	run(ctx context.Context, request Request) (Response, error)
}
