package runtimeadapter

import (
	"encoding/json"
	"fmt"
	"time"
)

// NativeState reports physical activity only. Idle is not a claim that every
// chain checkpoint is terminal, or authorization to adopt/continue an OKR.
type NativeState struct {
	InstanceID        string `json:"instance_id"`
	Runtime           string `json:"runtime"`
	PhysicalState     string `json:"physical_state"`
	WorkspaceHash     string `json:"workspace_hash"`
	ActiveCommandID   string `json:"active_command_id,omitempty"`
	ActiveExecutionID string `json:"active_execution_id,omitempty"`
	StartedAt         string `json:"started_at,omitempty"`
	ReviewPending     bool   `json:"review_pending,omitempty"`
	ReviewExpiresAtMS int64  `json:"review_expires_at_ms,omitempty"`
}
type nativeAttempt struct {
	commandID, executionID string
	started                time.Time
}

// Both the original configured name and its discovered native-* alias address
// the same physical slot. The gate spans all tool operations through Close.
func (a *boundedFileAgent) beginNative(agent, command, execution string) (func(), bool) {
	id := a.instanceIDs[agent]
	if id == "" {
		id = agent
	}
	a.mu.Lock()
	if review, exists := a.reviews[id]; exists {
		if time.Now().Before(review.deadline) {
			a.mu.Unlock()
			return nil, false
		}
		delete(a.reviews, id)
	}
	if _, exists := a.active[id]; exists {
		a.mu.Unlock()
		return nil, false
	}
	a.active[id] = nativeAttempt{command, execution, time.Now().UTC()}
	a.mu.Unlock()
	return func() { a.mu.Lock(); delete(a.active, id); a.mu.Unlock() }, true
}

func (a *boundedFileAgent) nativeStatus(request Request) (Response, error) {
	response := Response{SchemaVersion: SchemaVersion, Adapter: AdapterName, CommandID: request.CommandID, Operation: request.Operation, ObservedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	id := a.instanceIDs[request.Agent]
	scan := a.inventory.Discover()
	if scan.State != "complete" || id == "" {
		response.Error = &Error{Code: "workspace_changed", Message: "Native instance continuity is unavailable."}
		return response, nil
	}
	var hash string
	for _, instance := range scan.Instances {
		if instance.InstanceID == id {
			hash = instance.WorkspaceHash
		}
	}
	if hash == "" {
		return response, runError("missing_agent", fmt.Errorf("native instance is no longer present"))
	}
	state := NativeState{InstanceID: id, Runtime: "bounded-process-v1", PhysicalState: "idle", WorkspaceHash: hash}
	a.mu.Lock()
	if review, exists := a.reviews[id]; exists && time.Now().Before(review.deadline) {
		state.ReviewPending = true
		state.ReviewExpiresAtMS = review.expiresAtMS
	}
	if active, exists := a.active[id]; exists {
		state.PhysicalState = "running"
		state.ActiveCommandID = active.commandID
		state.ActiveExecutionID = active.executionID
		state.StartedAt = active.started.Format(time.RFC3339Nano)
	}
	a.mu.Unlock()
	response.Result, _ = json.Marshal(state)
	response.OK = true
	return response, nil
}
