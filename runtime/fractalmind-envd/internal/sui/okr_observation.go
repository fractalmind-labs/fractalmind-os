package sui

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"strconv"
	"time"

	"github.com/block-vision/sui-go-sdk/models"
	"github.com/block-vision/sui-go-sdk/utils"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/boundedrun"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/runtimeadapter"
)

type okrObservationReader interface {
	ReadOkrObservationState(context.Context, nodecommand.ChainExecution) (nodecommand.OkrObservationState, error)
	ChainTime(context.Context) (int64, error)
}

const observationGasBudget = uint64(100000000)

func nativeMeasurementTask(command nodecommand.NodeCommand) (*boundedrun.FileTask, error) {
	if len(command.Payload) == 0 {
		return nil, nil
	}
	var payload struct {
		Task        string `json:"task"`
		Measurement *struct {
			Kind string `json:"kind"`
		} `json:"measurement"`
	}
	if err := json.Unmarshal(command.Payload, &payload); err != nil {
		return nil, err
	}
	if payload.Measurement == nil {
		return nil, nil
	}
	if payload.Measurement.Kind != "verified_text_file_count" || command.Action != "assign" || command.Scope != "control" || command.Budget == nil || command.Budget.Asset != "TOOL_CALLS" {
		return nil, fmt.Errorf("unsupported signed measurement profile")
	}
	task, err := boundedrun.ParseFileTask(payload.Task)
	if err != nil {
		return nil, err
	}
	return &task, nil
}

func measuredFileCount(task boundedrun.FileTask, record runtimeadapter.ExecutionRecord) (uint64, uint64, error) {
	var outcome boundedrun.Outcome
	decoder := json.NewDecoder(bytes.NewReader(record.Response.Result))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&outcome); err != nil {
		return 0, 0, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return 0, 0, fmt.Errorf("trailing file measurement data")
	}
	if outcome.Status != "submitted" || len(outcome.Evidence) != len(task.Files) || record.Response.Spend == nil || !record.Response.Spend.Known || outcome.Used != uint64(record.Response.Spend.Amount) {
		return 0, 0, fmt.Errorf("native measurement is not a complete known result")
	}
	var sampled uint64
	for i, evidence := range outcome.Evidence {
		hash := sha256.Sum256([]byte(task.Files[i].Content))
		expected := hex.EncodeToString(hash[:])
		timestamp := evidence.ObservedAt.UnixMilli()
		if evidence.Path != task.Files[i].Path || !evidence.Verified || evidence.ExpectedHash != expected || evidence.ObservedHash != expected || timestamp <= 0 {
			return 0, 0, fmt.Errorf("file measurement differs from the signed goal")
		}
		// All counted artifacts must be fresh: use the oldest reader sample.
		if sampled == 0 || uint64(timestamp) < sampled {
			sampled = uint64(timestamp)
		}
	}
	return uint64(len(outcome.Evidence)), sampled, nil
}

func observationMatches(state nodecommand.OkrObservationState, run nodecommand.ChainExecution, current, sampled uint64) bool {
	return state.AgreementVersion == uint64(run.Contract.AgreementVersion) && state.Current != nil && *state.Current == current && state.SampledAtMS == sampled && state.RunID == run.ID && state.EvidenceID == run.ResultRecordID
}

// Publish at most once, after the encrypted successful result is confirmed.
// Duplicate loads only inspect the chain; a missing/unknown observation never
// replays the Agent or automatically resends the publication transaction.
func (s *ChainExecutionStore) observeNativeResult(ctx context.Context, command nodecommand.NodeCommand, record *runtimeadapter.ExecutionRecord, publish bool) {
	task, err := nativeMeasurementTask(command)
	if task == nil && err == nil {
		return
	}
	receipt := &runtimeadapter.OkrObservationReceipt{Status: "pending"}
	record.Response.OkrObservation = receipt
	if err != nil {
		receipt.Status, receipt.Reason = "rejected", "invalid_measurement_profile"
		return
	}
	run, _, err := s.lookup(ctx, command)
	if err != nil {
		receipt.Reason = "checkpoint_unavailable"
		return
	}
	if run.Contract == nil || run.State != 2 || !record.Response.OK {
		receipt.Status, receipt.Reason = "skipped", "execution_not_successful"
		return
	}
	current, sampled, err := measuredFileCount(*task, *record)
	if err != nil {
		receipt.Status, receipt.Reason = "rejected", "measurement_evidence_mismatch"
		return
	}
	receipt.Current, receipt.SampledAtMS = nodecommand.Uint64String(current), nodecommand.Uint64String(sampled)
	reader, ok := s.reader.(okrObservationReader)
	if !ok {
		receipt.Reason = "observation_reader_unavailable"
		return
	}
	state, err := reader.ReadOkrObservationState(ctx, run)
	if err != nil {
		receipt.Reason = "observation_state_unavailable"
		return
	}
	if observationMatches(state, run, current, sampled) {
		receipt.Status = "submitted"
		return
	}
	if state.State != 1 || state.AgreementVersion != uint64(run.Contract.AgreementVersion) || state.KRIndex != uint64(run.Contract.KRIndex) || state.MembershipID != run.MembershipID || state.BindingID != run.CoordinatorBindingID || state.ManagedAgentID != run.ManagedAgentID || state.Verified || state.SampledAtMS > sampled {
		receipt.Status, receipt.Reason = "superseded", "agreement_or_metric_changed"
		return
	}
	if state.Baseline != 0 || state.Target != current {
		receipt.Status, receipt.Reason = "rejected", "metric_does_not_match_file_count"
		return
	}
	if !publish {
		receipt.Reason = "publication_not_confirmed"
		return
	}
	// Host samples use the reader's wall clock. Sui Clock may trail it by a
	// checkpoint; wait for Clock to reach the actual sample instead of changing
	// the sample time or submitting a future observation. Large skew fails closed.
	clockCtx, clockCancel := context.WithTimeout(ctx, 5*time.Second)
	defer clockCancel()
	for {
		now, clockErr := reader.ChainTime(clockCtx)
		if clockErr != nil {
			receipt.Reason = "chain_clock_unavailable"
			return
		}
		if now > 0 && uint64(now) >= sampled {
			break
		}
		select {
		case <-clockCtx.Done():
			receipt.Reason = "sample_clock_ahead"
			return
		case <-time.After(100 * time.Millisecond):
		}
	}
	args := []interface{}{ObjectArgument(run.Contract.ID), ObjectArgument(run.Target.OrganizationID), ObjectArgument(run.MembershipID), ObjectArgument(run.CoordinatorBindingID), ObjectArgument(run.ManagedAgentID), ObjectArgument(run.CapabilityID), ObjectArgument(run.ID), ObjectArgument(run.ResultRecordID), strconv.FormatUint(state.Version, 10), strconv.FormatUint(uint64(run.Contract.AgreementVersion), 10), strconv.FormatUint(uint64(run.Contract.KRIndex), 10), strconv.FormatUint(current, 10), strconv.FormatUint(sampled, 10), ObjectArgument("0x6")}
	tx, err := s.rpc.MoveCall(ctx, models.MoveCallRequest{Signer: s.signer.Address(), PackageObjectId: s.packageID, Module: "okr", Function: "observe", Arguments: args, TypeArguments: []interface{}{}, GasBudget: strconv.FormatUint(observationGasBudget, 10)})
	if err != nil {
		log.Printf("[okr] observation build failed for Run %s: %v", run.ID, err)
		receipt.Reason = "observation_build_failed"
		return
	}
	digest, err := utils.GetTxDigest(tx.TxBytes)
	if err != nil {
		receipt.Reason = "observation_digest_unavailable"
		return
	}
	receipt.TransactionDigest = digest
	result, sendErr := s.rpc.SignAndExecuteTransactionBlock(ctx, models.SignAndExecuteTransactionBlockRequest{TxnMetaData: tx, PriKey: s.signer.Private, Options: models.SuiTransactionBlockOptions{ShowEffects: true}, RequestType: "WaitForLocalExecution"})
	if sendErr == nil && result.Digest == digest && result.Effects.Status.Status != "success" {
		receipt.Status, receipt.Reason = "rejected", "observation_transaction_rejected"
		return
	}
	queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	for {
		state, readErr := reader.ReadOkrObservationState(queryCtx, run)
		if readErr == nil && observationMatches(state, run, current, sampled) {
			receipt.Status, receipt.Reason = "submitted", ""
			return
		}
		select {
		case <-queryCtx.Done():
			receipt.Reason = "observation_confirmation_unknown"
			return
		case <-time.After(100 * time.Millisecond):
		}
	}
}
