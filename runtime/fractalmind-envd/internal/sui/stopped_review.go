package sui

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/runtimeadapter"
)

// SettleStoppedHandoverReview acknowledges an explicit on-chain stop of an
// expired, zero-tool observation. It does not run the adapter, adopt an unknown
// mutating execution, grant control, or create a replacement acceptance lease.
// A publication error retains the original digest; callers must query it rather
// than publish again while its outcome is unknown.
func (s *ChainExecutionStore) SettleStoppedHandoverReview(ctx context.Context, executionID string, command nodecommand.NodeCommand) (runtimeadapter.ExecutionRecord, error) {
	if command.Version != nodecommand.ProtocolVersion || command.Budget != nil {
		return runtimeadapter.ExecutionRecord{}, fmt.Errorf("only a zero-budget handover observation can be settled")
	}
	// Strict decoding excludes hidden operation parameters, direct messages and
	// future payload extensions from this deliberately narrow reconciliation.
	var payload struct {
		Review *nodecommand.HandoverProposal `json:"handover_review"`
	}
	decoder := json.NewDecoder(bytes.NewReader(command.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return runtimeadapter.ExecutionRecord{}, fmt.Errorf("invalid handover-only payload")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return runtimeadapter.ExecutionRecord{}, fmt.Errorf("trailing handover payload")
	}
	proposal, err := nodecommand.ProposalForCommand(command)
	if err != nil {
		return runtimeadapter.ExecutionRecord{}, err
	}
	signing, err := command.SigningBytes()
	if err != nil {
		return runtimeadapter.ExecutionRecord{}, err
	}
	if err := (nodecommand.Ed25519Verifier{}).Verify(ctx, command.Signer, signing, command.Signature); err != nil {
		return runtimeadapter.ExecutionRecord{}, fmt.Errorf("original device signature is required: %w", err)
	}
	run, _, err := s.lookup(ctx, command)
	if err != nil {
		return runtimeadapter.ExecutionRecord{}, err
	}
	if run.ID != executionID || run.ManagedAgentID != proposal.ManagedAgentID || run.Contract != nil || run.Direct != nil || run.Budget != nil || run.BudgetReserved != 0 || run.BudgetSpent != 0 {
		return runtimeadapter.ExecutionRecord{}, fmt.Errorf("exact original zero-tool review Run is required")
	}
	if run.State == 2 || run.State == 3 || run.State == 5 {
		record, found, err := s.LoadCommand(ctx, command)
		if err != nil || !found {
			return record, unknownResult(run, "", fmt.Errorf("original terminal result unavailable: %v", err))
		}
		return record, nil
	}
	if run.State != 1 || !run.StopRequested || run.AttemptID == "" || run.ResultRecordID != "" || run.BudgetSettled {
		return runtimeadapter.ExecutionRecord{}, fmt.Errorf("original running review must first have an explicit on-chain stop")
	}
	clock, ok := s.reader.(interface {
		ChainTime(context.Context) (int64, error)
	})
	if !ok {
		return runtimeadapter.ExecutionRecord{}, fmt.Errorf("chain Clock is required")
	}
	now, err := clock.ChainTime(ctx)
	if err != nil {
		return runtimeadapter.ExecutionRecord{}, err
	}
	if command.ExpiresAtMS <= command.IssuedAtMS || now < command.ExpiresAtMS || now < proposal.ReviewExpiresAtMS || now < run.UpdatedAtMS {
		return runtimeadapter.ExecutionRecord{}, fmt.Errorf("original command and review lease must both have expired")
	}
	// ErrorMessage represents unknown runtime effects and would deliberately
	// retain state NEEDS_CONFIRMATION. This observation has no tool execution;
	// the stable cancelled response is the acknowledgement, not an unknown error.
	record := runtimeadapter.ExecutionRecord{
		Version: "1",
		Response: runtimeadapter.Response{
			SchemaVersion: runtimeadapter.SchemaVersion, Adapter: runtimeadapter.AdapterName,
			CommandID: command.CommandID, Operation: runtimeadapter.OperationStatus,
			ObservedAt: time.UnixMilli(now).UTC().Format(time.RFC3339Nano),
			Error:      &runtimeadapter.Error{Code: "cancelled", Message: "Host acknowledged the on-chain stop after the original observation and handover lease expired; no acceptance or tool execution was issued."},
		},
		Event: nodecommand.NodeEvent{Version: nodecommand.ProtocolVersion, CommandID: command.CommandID, Target: command.Target, Type: "runtime_cancelled", ResultCode: "runtime_cancelled", OccurredAtMS: now},
	}
	return s.SaveCommand(ctx, command, &run, record)
}
