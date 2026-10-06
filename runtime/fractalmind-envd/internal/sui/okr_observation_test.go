package sui

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/block-vision/sui-go-sdk/models"
	"github.com/block-vision/sui-go-sdk/utils"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/boundedrun"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/runtimeadapter"
)

type nativeObservationFixture struct {
	*resultReaderFixture
	state nodecommand.OkrObservationState
	clock func() (int64, error)
}

func (f *nativeObservationFixture) ChainTime(context.Context) (int64, error) {
	if f.clock != nil {
		return f.clock()
	}
	return 1700000000100, nil
}

func (f *nativeObservationFixture) ReadOkrObservationState(context.Context, nodecommand.ChainExecution) (nodecommand.OkrObservationState, error) {
	return f.state, nil
}
func autoObservationFixture(t *testing.T) (*ChainExecutionStore, *nativeObservationFixture, *reservationRPC, nodecommand.NodeCommand, runtimeadapter.ExecutionRecord) {
	t.Helper()
	s, reader, rpc, cmd, record, _ := chainStoreFixture(t)
	cmd.Budget = &nodecommand.BudgetClaim{Asset: "TOOL_CALLS", Amount: 3}
	task := boundedrun.FileTask{Kind: "ensure_text_files", Files: []boundedrun.FileGoal{{Path: "READY.txt", Content: "ready"}}}
	raw, _ := json.Marshal(task)
	cmd.Payload, _ = json.Marshal(map[string]any{"task": string(raw), "measurement": map[string]string{"kind": "verified_text_file_count"}})
	hash := sha256.Sum256(cmd.Payload)
	cmd.PayloadHash = hex.EncodeToString(hash[:])
	reservation, err := commandReservation(cmd)
	if err != nil {
		t.Fatal(err)
	}
	reader.run.Fingerprint = reservation.Fingerprint
	reader.run.Budget = cmd.Budget
	reader.run.State = 2
	reader.run.Contract = &nodecommand.ExecutionContractAuthority{ID: cmd.Target.OrganizationID, AgreementVersion: 1, KRIndex: 0}
	reader.run.ManagedAgentID = cmd.Capability.ID
	reader.run.CoordinatorBindingID = reader.run.MembershipID
	reader.run.ResultRecordID = cmd.Capability.ID
	hash = sha256.Sum256([]byte("ready"))
	outcome := boundedrun.Outcome{Status: "submitted", Used: 3, Evidence: []boundedrun.FileEvidence{{Path: "READY.txt", ExpectedHash: hex.EncodeToString(hash[:]), ObservedHash: hex.EncodeToString(hash[:]), Verified: true, ObservedAt: time.UnixMilli(1700000000000)}}}
	record.Response.Result, _ = json.Marshal(outcome)
	record.Response.Spend = &runtimeadapter.Spend{Asset: "TOOL_CALLS", Amount: 3, Known: true}
	f := &nativeObservationFixture{resultReaderFixture: reader, state: nodecommand.OkrObservationState{ID: reader.run.Contract.ID, OrganizationID: cmd.Target.OrganizationID, State: 1, Version: 2, AgreementVersion: 1, KRIndex: 0, Baseline: 0, Target: 1, MembershipID: reader.run.MembershipID, BindingID: reader.run.CoordinatorBindingID, ManagedAgentID: reader.run.ManagedAgentID}}
	s.reader = f
	return s, f, rpc, cmd, record
}

func TestAutomaticNativeObservationConfirmsLostReceiptWithoutResend(t *testing.T) {
	s, f, rpc, cmd, record := autoObservationFixture(t)
	var call models.MoveCallRequest
	sends := 0
	rpc.build = func(req models.MoveCallRequest) (models.TxnMetaData, error) {
		call = req
		return models.TxnMetaData{TxBytes: base64.StdEncoding.EncodeToString([]byte("observation fixture"))}, nil
	}
	rpc.send = func(req models.SignAndExecuteTransactionBlockRequest) (models.SuiTransactionBlockResponse, error) {
		sends++
		if call.Module != "okr" || call.Function != "observe" || call.Arguments[8] != "2" || call.Arguments[11] != "1" || call.Arguments[12] != "1700000000000" {
			t.Fatalf("wrong observation binding: %+v", call)
		}
		value := uint64(1)
		f.state.Current = &value
		f.state.RunID = f.run.ID
		f.state.EvidenceID = f.run.ResultRecordID
		f.state.SampledAtMS = 1700000000000
		return models.SuiTransactionBlockResponse{}, errors.New("receipt lost after committed observation")
	}
	s.observeNativeResult(context.Background(), cmd, &record, true)
	if record.Response.OkrObservation.Status != "submitted" || record.Response.OkrObservation.TransactionDigest == "" || sends != 1 {
		t.Fatalf("not confirmed once: %+v sends=%d", record.Response.OkrObservation, sends)
	}
	f.state.Verified = true // A duplicate query must preserve human verification.
	s.observeNativeResult(context.Background(), cmd, &record, false)
	if record.Response.OkrObservation.Status != "submitted" || record.Response.OkrObservation.TransactionDigest != "" || sends != 1 || !f.state.Verified {
		t.Fatal("duplicate query republished or invalidated verification")
	}
}

func TestAutomaticNativeObservationRejectsFalseOrSupersededEvidence(t *testing.T) {
	for _, name := range []string{"wrong hash", "missing evidence", "unmeasured file", "unknown cost", "changed agreement", "changed assignment", "human verified", "wrong metric"} {
		t.Run(name, func(t *testing.T) {
			s, f, rpc, cmd, record := autoObservationFixture(t)
			var outcome boundedrun.Outcome
			json.Unmarshal(record.Response.Result, &outcome)
			switch name {
			case "wrong hash":
				outcome.Evidence[0].ObservedHash = "untrusted"
			case "missing evidence":
				outcome.Evidence = nil
			case "unmeasured file":
				outcome.Evidence[0].Path = "OTHER.txt"
			case "unknown cost":
				record.Response.Spend.Known = false
			case "changed agreement":
				f.state.AgreementVersion++
			case "changed assignment":
				f.state.ManagedAgentID = "replacement"
			case "human verified":
				f.state.Verified = true
			case "wrong metric":
				f.state.Target = 2
			}
			record.Response.Result, _ = json.Marshal(outcome)
			rpc.build = func(models.MoveCallRequest) (models.TxnMetaData, error) {
				t.Fatal("untrusted observation reached transaction build")
				return models.TxnMetaData{}, nil
			}
			s.observeNativeResult(context.Background(), cmd, &record, true)
			if record.Response.OkrObservation == nil || (record.Response.OkrObservation.Status != "rejected" && record.Response.OkrObservation.Status != "superseded") {
				t.Fatalf("untrusted measurement accepted: %+v", record.Response.OkrObservation)
			}
		})
	}
}

func TestAutomaticNativeObservationUnknownPublicationRemainsReadOnly(t *testing.T) {
	s, _, rpc, cmd, record := autoObservationFixture(t)
	sends := 0
	rpc.build = func(models.MoveCallRequest) (models.TxnMetaData, error) {
		return models.TxnMetaData{TxBytes: base64.StdEncoding.EncodeToString([]byte("unknown observation"))}, nil
	}
	rpc.send = func(req models.SignAndExecuteTransactionBlockRequest) (models.SuiTransactionBlockResponse, error) {
		sends++
		digest, _ := utils.GetTxDigest(req.TxnMetaData.TxBytes)
		return models.SuiTransactionBlockResponse{Digest: digest}, errors.New("unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	s.observeNativeResult(ctx, cmd, &record, true)
	if record.Response.OkrObservation.Status != "pending" || record.Response.OkrObservation.TransactionDigest == "" || sends != 1 {
		t.Fatalf("unknown publication: %+v", record.Response.OkrObservation)
	}
	s.observeNativeResult(context.Background(), cmd, &record, false)
	if record.Response.OkrObservation.Status != "pending" || sends != 1 {
		t.Fatal("read-only duplicate resubmitted unknown observation")
	}
}

func TestAutomaticObservationWaitsForRealSampleClockAndChecksGas(t *testing.T) {
	s, f, rpc, cmd, record := autoObservationFixture(t)
	clockReads := 0
	f.clock = func() (int64, error) {
		clockReads++
		if clockReads == 1 {
			return 1699999999999, nil
		}
		return 1700000000100, nil
	}
	rpc.build = func(req models.MoveCallRequest) (models.TxnMetaData, error) {
		if clockReads < 2 || req.Arguments[12] != "1700000000000" {
			t.Fatal("changed sample time or built before Clock reached it")
		}
		return models.TxnMetaData{}, errors.New("known pre-send build failure")
	}
	s.observeNativeResult(context.Background(), cmd, &record, true)
	if record.Response.OkrObservation.Reason != "observation_build_failed" {
		t.Fatal("unexpected Clock wait outcome")
	}
	rpc.coins = func(models.SuiXGetCoinsRequest) (models.PaginatedCoinsResponse, error) {
		return models.PaginatedCoinsResponse{Data: []models.CoinData{{Balance: "2100000000"}}}, nil
	}
	if err := s.checkResultGas(context.Background(), true, false); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(s.checkResultGas(context.Background(), true, true), errHostGasInsufficient) {
		t.Fatal("observation publication Gas omitted from preflight")
	}
}
