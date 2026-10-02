package nodecommand

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"slices"
	"sort"
	"unicode/utf8"
)

// ExecutionContractAuthority is authenticated OKR context. Current authority
// uses the live cursor; execution history retains the signed command's cursor.
type ExecutionContractAuthority struct {
	ID               string       `json:"id"`
	AgreementVersion Uint64String `json:"agreement_version"`
	KRIndex          Uint64String `json:"kr_index"`
	BoundaryHash     string       `json:"boundary_hash"`
}
type ExecutionContractRef struct {
	ID               string       `json:"id"`
	AgreementVersion Uint64String `json:"agreement_version"`
	KRIndex          Uint64String `json:"kr_index"`
}
type moveContractBinding struct {
	Contract  moveAddress
	Agreement uint64
	Boundary  []byte
}
type moveCommandContract struct {
	Contract      moveAddress
	Agreement, KR uint64
	Boundary      []byte
}
type moveOkrMetric struct {
	Baseline, Target, Weight, MaxAge uint64
	Current                          []uint64
	Sampled                          uint64
	Run, Evidence                    []moveAddress
	Verified                         bool
	Verification                     []moveAddress
}
type moveOkr struct {
	ID, Org, Human                             moveAddress
	Logical                                    string
	State                                      uint8
	Version, Agreement                         uint64
	Priority                                   uint8
	Deadline                                   uint64
	Spec                                       moveAddress
	SpecRevision                               uint64
	Metrics                                    []moveOkrMetric
	NextKR                                     uint64
	Observations                               moveTable
	Managed                                    []moveAddress
	ManagedVersion                             uint64
	Membership                                 []moveAddress
	MembershipVersion                          uint64
	Workspace, Boundary                        []byte
	Asset                                      string
	Limit, Expiry, Activated                   uint64
	AgreementRecord, Acceptance, AcceptedHuman []moveAddress
	AcceptedAt                                 uint64
}
type moveOkrBudget struct {
	Asset           string
	Spent, Reserved uint64
	Claims          moveTable
}
type moveOkrClaim struct {
	Capability                     moveAddress
	Agreement, KR, Reserved, Spent uint64
	Settled                        bool
}

// Hash path sets with BCS and UTF-8 byte ordering, independently of per-command
// max_calls. Filesystem path validation remains the bounded tool's job.
func ExecutionBoundaryHash(paths map[string][]string) (string, error) {
	if len(paths) < 1 || len(paths) > 3 {
		return "", fmt.Errorf("expected 1-3 file tool boundaries")
	}
	actions := make([]string, 0, len(paths))
	for action, dirs := range paths {
		if (action != "file.read" && action != "file.write" && action != "file.list") || len(dirs) < 1 || len(dirs) > 16 {
			return "", fmt.Errorf("invalid tool boundary")
		}
		seen := map[string]bool{}
		for _, dir := range dirs {
			if !utf8.ValidString(dir) || len(dir) == 0 || len(dir) > 1024 || seen[dir] {
				return "", fmt.Errorf("invalid/duplicate UTF-8 directory")
			}
			seen[dir] = true
		}
		actions = append(actions, action)
	}
	sort.Strings(actions)
	encoded := []byte("fractalmind.execution-boundary.v1")
	encoded = append(encoded, byte(len(actions))) // all vector counts < 128
	for _, action := range actions {
		encoded = appendBCSBytes(encoded, []byte(action))
		dirs := append([]string(nil), paths[action]...)
		sort.Strings(dirs)
		encoded = append(encoded, byte(len(dirs)))
		for _, dir := range dirs {
			encoded = appendBCSBytes(encoded, []byte(dir))
		}
	}
	hash := sha256.Sum256(encoded)
	return hex.EncodeToString(hash[:]), nil
}

// ValidateExecutionContract runs before acquisition and before every tool. A
// command cannot substitute its own path sets for the approved boundary hash.
func ValidateExecutionContract(command NodeCommand, authority *ExecutionContractAuthority) error {
	var payload struct {
		Okr    *ExecutionContractRef `json:"okr"`
		Bounds *struct {
			Paths    map[string][]string `json:"paths"`
			MaxCalls Uint64String        `json:"max_calls"`
		} `json:"bounds"`
	}
	if len(command.Payload) > 0 {
		if err := json.Unmarshal(command.Payload, &payload); err != nil {
			return reject(CodeInvalidEnvelope, "invalid execution contract payload", err)
		}
	}
	if authority == nil {
		if payload.Okr != nil {
			return reject(CodeUnauthorized, "command declares an unbound OKR", nil)
		}
		return nil
	}
	if payload.Okr == nil || payload.Bounds == nil || command.Action != "assign" || command.Scope != "control" || command.Budget == nil || payload.Bounds.MaxCalls != command.Budget.Amount || payload.Okr.ID != authority.ID || payload.Okr.AgreementVersion != authority.AgreementVersion || payload.Okr.KRIndex != authority.KRIndex {
		return reject(CodeRevoked, "signed OKR cursor, agreement or budget does not match current authority", nil)
	}
	hash, err := ExecutionBoundaryHash(payload.Bounds.Paths)
	if err != nil || hash != authority.BoundaryHash {
		return reject(CodeUnauthorized, "signed paths do not match approved OKR boundary", err)
	}
	return nil
}

func (r *chainRead) contractBinding(ctx context.Context, capID string) (*moveContractBinding, error) {
	var value moveContractBinding
	pkg := r.resolver.packageID
	err := r.field(ctx, capID, structKeyTag(pkg, "remote_authority", "ExecutionContractKey"), []byte{0}, pkg+"::remote_authority::ExecutionContractKey", pkg+"::remote_authority::ExecutionContractBinding", &value)
	if errors.Is(err, ErrChainObjectNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if value.Agreement == 0 || len(value.Boundary) != 32 {
		return nil, fmt.Errorf("invalid capability contract binding")
	}
	return &value, nil
}
func (r *chainRead) okr(ctx context.Context, binding *moveContractBinding) (moveOkr, moveOkrBudget, error) {
	var okr moveOkr
	var budget moveOkrBudget
	if err := r.object(ctx, binding.Contract.String(), "okr::Okr", &okr); err != nil {
		return okr, budget, err
	}
	if okr.State > 4 || okr.Version == 0 || len(okr.Metrics) < 1 || len(okr.Metrics) > 3 || okr.NextKR > uint64(len(okr.Metrics)) || len(okr.Managed) != 1 || len(okr.Membership) != 1 || len(okr.Workspace) != 32 || len(okr.Boundary) != 32 {
		return okr, budget, fmt.Errorf("invalid OKR layout")
	}
	pkg := r.resolver.packageID
	if err := r.field(ctx, okr.ID.String(), structKeyTag(pkg, "okr", "BudgetKey"), []byte{0}, pkg+"::okr::BudgetKey", pkg+"::okr::BudgetState", &budget); err != nil {
		return okr, budget, err
	}
	if budget.Asset != okr.Asset || budget.Spent > okr.Limit || budget.Reserved > okr.Limit-budget.Spent {
		return okr, budget, fmt.Errorf("invalid global OKR budget")
	}
	return okr, budget, nil
}
func (r *chainRead) currentContract(ctx context.Context, cap moveCapability, auth moveAuthorityBinding, instance *ManagedInstanceAuthority, now uint64) (*ExecutionContractAuthority, uint64, error) {
	binding, err := r.contractBinding(ctx, cap.ID.String())
	if err != nil {
		return nil, cap.Expiry, err
	}
	if binding == nil {
		if instance != nil && instance.Runtime == "bounded-process-v1" && slices.Contains(cap.Actions, "assign") {
			return nil, 0, reject(CodeUnauthorized, "native assignments require a reviewed OKR binding", nil)
		}
		return nil, cap.Expiry, nil
	}
	okr, _, err := r.okr(ctx, binding)
	if err != nil {
		return nil, 0, err
	}
	if okr.State != 1 || okr.Agreement != binding.Agreement || okr.NextKR >= uint64(len(okr.Metrics)) {
		return nil, 0, reject(CodeRevoked, "OKR paused, completed or agreement changed", nil)
	}
	if okr.Expiry > math.MaxInt64 || now >= okr.Expiry {
		return nil, 0, reject(CodeExpired, "OKR agreement expired", nil)
	}
	if okr.Org != cap.Org || instance == nil || okr.Managed[0].String() != instance.ID || okr.ManagedVersion != uint64(instance.Version) || okr.Membership[0] != auth.Membership || okr.MembershipVersion != auth.MembershipVersion || hex.EncodeToString(okr.Workspace) != instance.WorkspaceHash || !bytes.Equal(okr.Boundary, binding.Boundary) || len(cap.Actions) != 1 || cap.Actions[0] != "assign" || cap.Scope != "control" || cap.BudgetAsset != okr.Asset || cap.MaxBudget > okr.Limit || cap.Expiry > okr.Expiry {
		return nil, 0, reject(CodeWrongTarget, "OKR instance, boundary or budget binding changed", nil)
	}
	return &ExecutionContractAuthority{ID: binding.Contract.String(), AgreementVersion: Uint64String(binding.Agreement), KRIndex: Uint64String(okr.NextKR), BoundaryHash: hex.EncodeToString(binding.Boundary)}, okr.Expiry, nil
}
func (r *chainRead) executionContract(ctx context.Context, cap moveCapability, run moveExecution, localBudget moveBoundBudgetClaim) (*ExecutionContractAuthority, error) {
	binding, err := r.contractBinding(ctx, cap.ID.String())
	if err != nil || binding == nil {
		return nil, err
	}
	pkg := r.resolver.packageID
	var command moveCommandContract
	err = r.field(ctx, cap.ID.String(), structKeyTag(pkg, "remote_authority", "CommandContractKey"), appendBCSBytes(nil, run.IntentHash), pkg+"::remote_authority::CommandContractKey", pkg+"::remote_authority::CommandContractBinding", &command)
	if err != nil {
		return nil, err
	}
	if command.Contract != binding.Contract || command.Agreement != binding.Agreement || command.KR >= 3 || !bytes.Equal(command.Boundary, binding.Boundary) {
		return nil, fmt.Errorf("invalid command contract binding")
	}
	okr, budget, err := r.okr(ctx, binding)
	if err != nil {
		return nil, err
	}
	var claim moveOkrClaim
	err = r.field(ctx, budget.Claims.ID.String(), structKeyTag("0x2", "object", "ID"), run.ID[:], "0x2::object::ID", pkg+"::okr::BudgetClaim", &claim)
	if err != nil {
		return nil, err
	}
	// Historical reads and settlement remain valid after pause, reapproval and
	// acceptance. Current tool authority is checked separately by Resolve.
	if okr.Org != run.Org || budget.Asset != run.BudgetAsset || claim.Capability != cap.ID || claim.Agreement != command.Agreement || claim.KR != command.KR || claim.Reserved != run.BudgetAmount || claim.Spent != localBudget.Spent || claim.Settled != localBudget.Settled || (!claim.Settled && budget.Reserved < claim.Reserved) || (claim.Settled && budget.Spent < claim.Spent) {
		return nil, fmt.Errorf("execution/global OKR budget mismatch")
	}
	return &ExecutionContractAuthority{ID: binding.Contract.String(), AgreementVersion: Uint64String(command.Agreement), KRIndex: Uint64String(command.KR), BoundaryHash: hex.EncodeToString(command.Boundary)}, nil
}
