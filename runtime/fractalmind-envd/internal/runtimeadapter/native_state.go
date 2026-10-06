package runtimeadapter

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
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
	release, _, ok := a.beginNativeContinuation(agent, command, execution, nil)
	return release, ok
}

// An untrusted matching reference may reserve the physical slot, but cannot
// consume a review. Only the independently checked chain policy commits it.
// Failure retains the same lease and releases only this attempt's slot.
func (a *boundedFileAgent) beginNativeContinuation(agent, command, execution string, continuation *nodecommand.HandoverContinuationRef) (func(), func(nodecommand.ExecutionHandoverAuthority) bool, bool) {
	id := a.instanceIDs[agent]
	if id == "" {
		id = agent
	}
	a.mu.Lock()
	if _, exists := a.active[id]; exists {
		a.mu.Unlock()
		return nil, nil, false
	}
	var lease *nativeReviewLease
	if review, exists := a.reviews[id]; exists {
		if time.Now().Before(review.deadline) {
			if continuation == nil || continuation.ProposalHash != review.hash || continuation.Nonce != review.nonce {
				a.mu.Unlock()
				return nil, nil, false
			}
			lease = review
		} else {
			delete(a.reviews, id)
		}
	}
	attempt := nativeAttempt{command, execution, time.Now().UTC()}
	a.active[id] = attempt
	a.mu.Unlock()
	release := func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		if current, exists := a.active[id]; exists && current == attempt {
			delete(a.active, id)
		}
	}
	commit := func(approved nodecommand.ExecutionHandoverAuthority) bool {
		a.mu.Lock()
		defer a.mu.Unlock()
		if current, exists := a.active[id]; !exists || current != attempt {
			return false
		}
		if continuation == nil || approved.ApprovalID != continuation.ApprovalID || approved.ProposalHash != continuation.ProposalHash || approved.Nonce != continuation.Nonce {
			return false
		}
		if lease != nil {
			if current := a.reviews[id]; current != lease || !time.Now().Before(lease.deadline) || approved.ProposalHash != lease.hash || approved.Nonce != lease.nonce {
				return false
			}
			delete(a.reviews, id)
		}
		return true
	}
	return release, commit, true
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
