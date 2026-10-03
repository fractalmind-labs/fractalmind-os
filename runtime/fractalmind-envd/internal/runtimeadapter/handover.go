package runtimeadapter

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/boundedrun"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
)

// Transient physical exclusion only. No business record or private key is
// written here. A confirmed acceptance remains encrypted on Sui; this lease
// never authorizes a tool call, and a Host restart cannot recreate its promise.
type nativeReviewLease struct {
	hash        string
	nonce       string
	deadline    time.Time
	expiresAtMS int64
}

func (a *boundedFileAgent) reviewHandover(ctx context.Context, r Request, command nodecommand.NodeCommand, checkpoint *nodecommand.ChainExecution) (Response, error) {
	response := Response{SchemaVersion: SchemaVersion, Adapter: AdapterName, CommandID: r.CommandID, Operation: r.Operation, ObservedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	deny := func(code string, err error) (Response, error) {
		response.Error = &Error{Code: code, Message: err.Error()}
		return response, nil
	}
	reader, ok := a.reader.(nodecommand.HandoverAuthorityReader)
	if !ok || checkpoint == nil || r.Handover == nil || r.Operation != OperationStatus || command.Action != "status" || r.Agent != command.Target.AgentID {
		return deny("handover_unavailable", fmt.Errorf("native review authority is unavailable"))
	}
	// Snapshot all proposed path sets; neither a caller nor another goroutine
	// can change an accepted constraint after the review.
	raw, err := json.Marshal(r.Handover)
	if err != nil {
		return deny("boundary_denied", err)
	}
	var proposal nodecommand.HandoverProposal
	if err = json.Unmarshal(raw, &proposal); err != nil {
		return deny("boundary_denied", err)
	}
	source, err := reader.InspectHandover(ctx, command, *checkpoint, proposal)
	if err != nil {
		return deny("handover_changed", err)
	}
	hash, err := proposal.Hash()
	if err != nil || hash != source.ProposalHash {
		return deny("boundary_denied", fmt.Errorf("proposal hash mismatch"))
	}
	status, err := a.nativeStatus(r)
	if err != nil || !status.OK {
		return deny("workspace_changed", fmt.Errorf("native continuity unavailable"))
	}
	var physical NativeState
	if json.Unmarshal(status.Result, &physical) != nil || physical.PhysicalState != "idle" || physical.WorkspaceHash != proposal.WorkspaceHash {
		return deny("instance_busy", fmt.Errorf("native instance is busy or workspace changed"))
	}
	workspace := a.workspaces[r.Agent]
	identity := a.inventory.WorkspaceIdentity(physical.InstanceID)
	if identity == nil {
		return deny("workspace_changed", fmt.Errorf("workspace identity unavailable"))
	}
	duration := time.Duration(proposal.ReviewExpiresAtMS-source.ClockMS) * time.Millisecond
	if duration <= 0 || duration > time.Duration(nodecommand.MaxHandoverReviewWindowMS)*time.Millisecond {
		return deny("handover_changed", fmt.Errorf("review is not fresh"))
	}
	deadline := time.Now().Add(duration)
	// Open the actual roots without running a tool. Invalid, missing or unsafe
	// path scopes cannot be advertised as an accepted enforcement boundary.
	tools, err := boundedrun.OpenTools(boundedrun.Policy{Workspace: workspace, WorkspaceIdentity: identity, Paths: proposal.Paths, MaxCalls: uint64(proposal.MaxCalls), Deadline: deadline}, func(context.Context) error { return fmt.Errorf("review cannot invoke tools") })
	if err != nil {
		return deny("boundary_denied", err)
	}
	if err = tools.Close(); err != nil {
		return deny("boundary_denied", err)
	}
	id := physical.InstanceID
	a.mu.Lock()
	_, active := a.active[id]
	old, reviewing := a.reviews[id]
	if active || reviewing && time.Now().Before(old.deadline) {
		a.mu.Unlock()
		return deny("instance_busy", fmt.Errorf("instance has a current execution or review"))
	}
	lease := &nativeReviewLease{hash: hash, nonce: proposal.Nonce, deadline: deadline, expiresAtMS: proposal.ReviewExpiresAtMS}
	a.reviews[id] = lease
	a.mu.Unlock()
	release := func() {
		a.mu.Lock()
		if current, ok := a.reviews[id]; ok && current == lease {
			delete(a.reviews, id)
		}
		a.mu.Unlock()
	}
	// Recheck every source after obtaining physical exclusion. Any intervening
	// new Run, revocation, version or budget change invalidates acceptance.
	var after nodecommand.HandoverAuthority
	if recheck, ok := reader.(interface {
		RecheckHandover(context.Context, nodecommand.NodeCommand, nodecommand.ChainExecution, nodecommand.HandoverProposal, nodecommand.HandoverAuthority) (nodecommand.HandoverAuthority, error)
	}); ok {
		after, err = recheck.RecheckHandover(ctx, command, *checkpoint, proposal, source)
	} else {
		after, err = reader.InspectHandover(ctx, command, *checkpoint, proposal)
	}
	if err != nil || after.ProposalHash != hash || after.CoverageRevision != source.CoverageRevision || after.ClockMS >= proposal.ReviewExpiresAtMS || !time.Now().Before(deadline) {
		release()
		return deny("handover_changed", fmt.Errorf("review source changed while reserving the physical instance"))
	}
	fresh, err := a.nativeStatus(r)
	if err != nil || !fresh.OK {
		release()
		return deny("workspace_changed", fmt.Errorf("workspace changed during review"))
	}
	var final NativeState
	if json.Unmarshal(fresh.Result, &final) != nil || final.InstanceID != id || final.WorkspaceHash != proposal.WorkspaceHash || final.PhysicalState != "idle" {
		release()
		return deny("workspace_changed", fmt.Errorf("native continuity changed during review"))
	}
	acceptance := nodecommand.HandoverAcceptance{Version: "1", ExecutionID: checkpoint.ID, OrganizationID: command.Target.OrganizationID, HumanID: checkpoint.HumanID, GrantID: checkpoint.GrantID, MembershipID: checkpoint.MembershipID, BindingID: checkpoint.CoordinatorBindingID, HostAddress: checkpoint.HostAddress, InstanceID: id, Proposal: proposal, CoverageRevision: after.CoverageRevision, ObservedAtMS: after.ClockMS}
	if err := acceptance.ValidateCommand(command, *checkpoint); err != nil {
		release()
		return deny("handover_changed", err)
	}
	response.OK = true
	response.Result = fresh.Result
	response.HandoverReview = &acceptance
	return response, nil
}
