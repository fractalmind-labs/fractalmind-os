package nodecommand

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// Current policy only. Historical Run reads intentionally retain the original
// contract cursor without claiming that this policy is still current.
type ExecutionHandoverAuthority struct {
	ApprovalID     string       `json:"approval_id"`
	ProposalHash   string       `json:"proposal_hash"`
	Nonce          string       `json:"nonce"`
	MaxCalls       Uint64String `json:"max_calls"`
	ManagedVersion Uint64String `json:"managed_version"`
}

// Signed reference for an explicit continuation under the reviewed policy.
// It is not authority; the chain projection and physical lease must match it.
type HandoverContinuationRef struct {
	ApprovalID   string `json:"approval_id"`
	ProposalHash string `json:"proposal_hash"`
	Nonce        string `json:"nonce"`
}

type moveHandoverPolicy struct {
	Agreement, ManagedVersion, MaxCalls uint64
	Nonce, ProposalHash                 []byte
	Approval                            moveAddress
}

func (r *chainRead) currentHandover(ctx context.Context, cap moveCapability, contract *ExecutionContractAuthority, instance *ManagedInstanceAuthority) (*ExecutionHandoverAuthority, error) {
	var policy moveHandoverPolicy
	pkg := r.resolver.okrPackageID
	if err := r.field(ctx, contract.ID, structKeyTag(pkg, "okr", "HandoverPolicyKey"), []byte{0}, pkg+"::okr::HandoverPolicyKey", pkg+"::okr::HandoverPolicy", &policy); err != nil {
		return nil, fmt.Errorf("current reviewed policy unavailable: %w", err)
	}
	if instance == nil || policy.Agreement != uint64(contract.AgreementVersion) || policy.ManagedVersion != uint64(instance.Version) || policy.MaxCalls == 0 || policy.MaxCalls > 1000 || cap.MaxBudget == 0 || cap.MaxBudget > policy.MaxCalls || len(policy.Nonce) != 32 || len(policy.ProposalHash) != 32 || policy.Approval == (moveAddress{}) {
		return nil, reject(CodeRevoked, "current reviewed policy, instance or tool ceiling changed", nil)
	}
	return &ExecutionHandoverAuthority{ApprovalID: policy.Approval.String(), ProposalHash: hex.EncodeToString(policy.ProposalHash), Nonce: hex.EncodeToString(policy.Nonce), MaxCalls: Uint64String(policy.MaxCalls), ManagedVersion: Uint64String(policy.ManagedVersion)}, nil
}

func HandoverContinuation(command NodeCommand) (*HandoverContinuationRef, error) {
	var payload struct {
		Continuation *HandoverContinuationRef `json:"handover_continue"`
	}
	if err := json.Unmarshal(command.Payload, &payload); err != nil {
		return nil, err
	}
	if p := payload.Continuation; p != nil {
		if _, err := canonicalHandoverID(p.ApprovalID); err != nil {
			return nil, err
		}
		if _, err := canonicalHex(p.ProposalHash, 32); err != nil {
			return nil, err
		}
		if _, err := canonicalHex(p.Nonce, 32); err != nil {
			return nil, err
		}
	}
	return payload.Continuation, nil
}

func ValidateExecutionHandover(command NodeCommand, state CapabilityState) error {
	if command.Action != "assign" {
		return nil
	}
	if state.Contract == nil {
		if state.Handover != nil || state.ManagedInstance != nil && state.ManagedInstance.Runtime == "bounded-process-v1" {
			return reject(CodeUnauthorized, "native assignment has no current reviewed OKR", nil)
		}
		return nil
	}
	p, err := HandoverContinuation(command)
	h := state.Handover
	if err != nil || p == nil || h == nil || state.ManagedInstance == nil || state.ManagedInstance.Version != h.ManagedVersion || command.Scope != "control" || command.Budget == nil || command.Budget.Asset != "TOOL_CALLS" || command.Budget.Amount == 0 || command.Budget.Amount > h.MaxCalls || p.ApprovalID != h.ApprovalID || p.ProposalHash != h.ProposalHash || p.Nonce != h.Nonce {
		return reject(CodeUnauthorized, "signed continuation differs from current reviewed policy", err)
	}
	return nil
}
