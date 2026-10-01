package boundedrun

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"slices"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
)

type ExecutionAuthority interface {
	Resolve(context.Context, nodecommand.CapabilityRef) (nodecommand.CapabilityState, error)
	LookupExecution(context.Context, string, string) (nodecommand.ChainExecution, bool, error)
	ChainTime(context.Context) (int64, error)
}
type Guard struct {
	reader                                                  ExecutionAuthority
	command                                                 nodecommand.NodeCommand
	runID, attemptID, fingerprint, workspaceHash, managedID string
}

func WorkspaceHash(directory string) (string, error) {
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256([]byte(filepath.Clean(absolute)))
	return hex.EncodeToString(hash[:]), nil
}

// NewGuard is used after the executor confirms its own chain start. It never
// acquires another use, reservation or run; only the current attempt may act.
func NewGuard(ctx context.Context, reader ExecutionAuthority, command nodecommand.NodeCommand, run nodecommand.ChainExecution, workspace string) (*Guard, error) {
	if reader == nil || ctx == nil || run.ID == "" || run.ManagedAgentID == "" || run.State != 1 || len(run.AttemptID) != 64 || command.Target.AgentID == "" || nodecommand.HashPayload(command.Payload) != command.PayloadHash {
		return nil, ErrBoundary
	}
	if _, err := hex.DecodeString(run.AttemptID); err != nil {
		return nil, ErrBoundary
	}
	bytes, err := command.SigningBytes()
	if err != nil {
		return nil, err
	}
	if err := (nodecommand.Ed25519Verifier{}).Verify(ctx, command.Signer, bytes, command.Signature); err != nil {
		return nil, err
	}
	hash := sha256.Sum256(bytes)
	fingerprint := hex.EncodeToString(hash[:])
	if run.Fingerprint != fingerprint || run.CapabilityID != command.Capability.ID || run.Target != command.Target || run.HostAddress != command.Target.NodeID || run.Signer != command.Signer {
		return nil, ErrBoundary
	}
	workspaceHash, err := WorkspaceHash(workspace)
	if err != nil {
		return nil, err
	}
	command.Payload = append([]byte(nil), command.Payload...)
	if command.Budget != nil {
		budget := *command.Budget
		command.Budget = &budget
	}
	guard := &Guard{reader: reader, command: command, runID: run.ID, attemptID: run.AttemptID, fingerprint: fingerprint, workspaceHash: workspaceHash, managedID: run.ManagedAgentID}
	if err := guard.Check(ctx); err != nil {
		return nil, err
	}
	return guard, nil
}
func (g *Guard) Check(ctx context.Context) error {
	state, err := g.reader.Resolve(ctx, g.command.Capability)
	if err != nil {
		return fmt.Errorf("current execution authority: %w", err)
	}
	if state.ID != g.command.Capability.ID || state.Revoked || state.Target != g.command.Target || state.RevocationVersion != uint64(g.command.Capability.RevocationVersion) || !slices.Contains(state.AuthorizedSigners, g.command.Signer) || !slices.Contains(state.Actions, g.command.Action) || !slices.Contains(state.Scopes, g.command.Scope) || state.ManagedInstance == nil || state.ManagedInstance.ID != g.managedID || state.ManagedInstance.Runtime != "bounded-process-v1" || state.ManagedInstance.WorkspaceHash != g.workspaceHash || state.AuthorityVersionHash == "" {
		return ErrBoundary
	}
	run, found, err := g.reader.LookupExecution(ctx, g.command.Capability.ID, g.fingerprint)
	if err != nil {
		return fmt.Errorf("current execution checkpoint: %w", err)
	}
	if !found || run.State != 1 || run.StopRequested {
		return ErrStopped
	}
	if run.ID != g.runID || run.AttemptID != g.attemptID || run.Fingerprint != g.fingerprint || run.Target != g.command.Target || run.CapabilityID != state.ID || run.CapabilityVersion != state.RevocationVersion || run.ManagedAgentID != g.managedID || run.HostAddress != g.command.Target.NodeID || run.Signer != g.command.Signer || run.Action != g.command.Action || run.Scope != g.command.Scope || run.ExpiresAtMS != g.command.ExpiresAtMS {
		return ErrBoundary
	}
	if g.command.Budget != nil {
		if run.Budget == nil || *run.Budget != *g.command.Budget || run.BudgetSettled || run.BudgetSpent != 0 || run.BudgetReserved != g.command.Budget.Amount {
			return ErrBoundary
		}
	} else if run.Budget != nil {
		return ErrBoundary
	}
	now, err := g.reader.ChainTime(ctx)
	if err != nil {
		return fmt.Errorf("execution Clock unavailable: %w", err)
	}
	if now <= 0 || now >= run.ExpiresAtMS || now >= state.ExpiresAtMS {
		return ErrStopped
	}
	return nil
}
