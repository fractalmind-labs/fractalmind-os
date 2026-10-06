package sui

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/block-vision/sui-go-sdk/models"
	"github.com/block-vision/sui-go-sdk/utils"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/productcrypto"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/runtimeadapter"
)

func TestStoppedExpiredReviewPublishesOnlyEncryptedCancellationAndRecoversOriginal(t *testing.T) {
	store, reader, rpc, command, _, key := handoverStoreFixture(t)
	reader.run.StopRequested = true
	reader.clockOverride = command.ExpiresAtMS
	var call models.MoveCallRequest
	sends := 0
	rpc.build = func(req models.MoveCallRequest) (models.TxnMetaData, error) {
		call = req
		if req.Module != "node_execution" || req.Function != "finish_command_with_budget" || req.Arguments[3] != uint8(5) || req.Arguments[5] != "0" {
			t.Fatal("cancellation must settle only the original observation with zero spend")
		}
		return models.TxnMetaData{TxBytes: base64.StdEncoding.EncodeToString([]byte("stopped review cancellation fixture"))}, nil
	}
	rpc.send = func(req models.SignAndExecuteTransactionBlockRequest) (models.SuiTransactionBlockResponse, error) {
		sends++
		cipher := []byte(call.Arguments[7].(ChunkedBytes))
		plain, err := productcrypto.DecryptCommandResult(cipher, key, resultContext(reader.run, 1))
		if err != nil {
			t.Fatal(err)
		}
		var record runtimeadapter.ExecutionRecord
		if err = json.Unmarshal(plain, &record); err != nil {
			t.Fatal(err)
		}
		if record.Response.OK || record.Response.HandoverReview != nil || record.Response.Spend != nil || record.Response.Error.Code != "cancelled" || record.ErrorMessage != "" || record.Event.Type != "runtime_cancelled" {
			t.Fatal("cancellation fabricated an acceptance, tool effect, or ambiguous settlement")
		}
		reader.run.State, reader.run.BudgetSettled, reader.run.ResultRecordID = 5, true, "record"
		hash := sha256.Sum256(cipher)
		reader.run.ResultHash = hex.EncodeToString(hash[:])
		receipt := txResponse(t, req.TxnMetaData, "success")
		reader.result = nodecommand.ChainExecutionResult{EncryptedBody: cipher, KeyVersion: 1, TransactionDigest: receipt.Digest}
		return receipt, nil
	}
	first, err := store.SettleStoppedHandoverReview(context.Background(), reader.run.ID, command)
	if err != nil || first.Response.ExecutionState != "cancelled" || first.Response.TransactionDigest == "" || sends != 1 {
		t.Fatalf("original cancellation failed: %+v %v", first, err)
	}
	fresh, err := NewChainExecutionStore(reader, rpc, store.signer, store.packageID, store.secret)
	if err != nil {
		t.Fatal(err)
	}
	second, err := fresh.SettleStoppedHandoverReview(context.Background(), reader.run.ID, command)
	if err != nil || second.Response.TransactionDigest != first.Response.TransactionDigest || sends != 1 {
		t.Fatalf("recovery replayed or lost original result: %v", err)
	}
}

func TestStoppedReviewRejectsUnprovedOrMutatingExecutionsWithoutBroadcast(t *testing.T) {
	for _, mode := range []string{"no stop", "unexpired", "wrong Run", "signature", "hash", "budget", "contract", "direct", "reserved", "spent", "settled", "wrong managed", "missing attempt", "queued", "unknown state", "has result", "hidden payload", "hidden proposal", "trailing payload", "backward Clock", "missing Clock"} {
		t.Run(mode, func(t *testing.T) {
			store, reader, rpc, command, _, _ := handoverStoreFixture(t)
			reader.run.StopRequested, reader.clockOverride = true, command.ExpiresAtMS
			executionID := reader.run.ID
			switch mode {
			case "no stop":
				reader.run.StopRequested = false
			case "unexpired":
				reader.clockOverride--
			case "wrong Run":
				executionID = "different"
			case "signature":
				command.Signature = "invalid"
			case "hash":
				command.PayloadHash = strings.Repeat("0", 64)
			case "budget":
				command.Budget = &nodecommand.BudgetClaim{Asset: "TOOL_CALLS", Amount: 1}
			case "contract":
				reader.run.Contract = &nodecommand.ExecutionContractAuthority{}
			case "direct":
				reader.run.Direct = &nodecommand.DirectExecutionAuthority{}
			case "reserved":
				reader.run.BudgetReserved = 1
			case "spent":
				reader.run.BudgetSpent = 1
			case "settled":
				reader.run.BudgetSettled = true
			case "wrong managed":
				reader.run.ManagedAgentID = "different"
			case "missing attempt":
				reader.run.AttemptID = ""
			case "queued":
				reader.run.State = 0
			case "unknown state":
				reader.run.State = 4
			case "has result":
				reader.run.ResultRecordID = "result"
			case "hidden payload":
				command.Payload = []byte(strings.TrimSuffix(string(command.Payload), "}") + `,"params":{"task":"write"}}`)
			case "hidden proposal":
				command.Payload = []byte(strings.Replace(string(command.Payload), `"version":"1"`, `"hidden":true,"version":"1"`, 1))
			case "trailing payload":
				command.Payload = append(command.Payload, []byte(` {}`)...)
			case "backward Clock":
				reader.run.UpdatedAtMS = reader.clockOverride + 1
			case "missing Clock":
				store.reader = &reviewReaderWithoutClock{reader}
			}
			rpc.build = func(models.MoveCallRequest) (models.TxnMetaData, error) {
				t.Fatal("rejected input reached transaction construction")
				return models.TxnMetaData{}, nil
			}
			if _, err := store.SettleStoppedHandoverReview(context.Background(), executionID, command); err == nil {
				t.Fatal("unsafe cancellation accepted")
			}
		})
	}
}

func TestStoppedReviewUnknownPublicationRetainsExactDigestWithoutRetry(t *testing.T) {
	store, reader, rpc, command, _, _ := handoverStoreFixture(t)
	reader.run.StopRequested, reader.clockOverride = true, command.ExpiresAtMS
	tx := models.TxnMetaData{TxBytes: base64.StdEncoding.EncodeToString([]byte("original unconfirmed cancellation"))}
	digest, err := utils.GetTxDigest(tx.TxBytes)
	if err != nil {
		t.Fatal(err)
	}
	sends := 0
	rpc.build = func(models.MoveCallRequest) (models.TxnMetaData, error) { return tx, nil }
	rpc.send = func(models.SignAndExecuteTransactionBlockRequest) (models.SuiTransactionBlockResponse, error) {
		sends++
		return models.SuiTransactionBlockResponse{}, errors.New("transport timed out after submission")
	}
	_, err = store.SettleStoppedHandoverReview(context.Background(), reader.run.ID, command)
	var rejection *nodecommand.RejectionError
	if !errors.As(err, &rejection) || rejection.TransactionDigest != digest || rejection.ExecutionID != reader.run.ID || sends != 1 || reader.run.State != 1 {
		t.Fatalf("unknown publication replayed or fabricated terminal state: %v", err)
	}
}
