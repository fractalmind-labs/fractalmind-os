package sui

import (
	"context"
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"

	"github.com/block-vision/sui-go-sdk/models"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/productcrypto"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/runtimeadapter"
	"golang.org/x/crypto/hkdf"
)

type resultReaderFixture struct {
	run           nodecommand.ChainExecution
	grant         nodecommand.ChainResultKeyGrant
	result        nodecommand.ChainExecutionResult
	missingKey    bool
	clockOverride int64
}

func (r *resultReaderFixture) LookupExecution(context.Context, string, string) (nodecommand.ChainExecution, bool, error) {
	return r.run, true, nil
}
func (r *resultReaderFixture) ReadExecutionResult(context.Context, string, string) (nodecommand.ChainExecutionResult, bool, error) {
	result := r.result
	result.Execution = r.run
	return result, r.run.ResultRecordID != "", nil
}
func (r *resultReaderFixture) ReadResultKey(context.Context, string, string, uint64) (nodecommand.ChainResultKeyGrant, error) {
	if r.missingKey {
		return nodecommand.ChainResultKeyGrant{}, errors.New("missing key")
	}
	return r.grant, nil
}
func (r *resultReaderFixture) CurrentRecordKeyVersion(context.Context, string) (uint64, error) {
	return 1, nil
}

func TestConfirmStartRejectsStopRequestedBeforeAdapter(t *testing.T) {
	store, reader, _, command, _, _ := chainStoreFixture(t)
	started := reader.run
	reader.run.StopRequested = true
	if nodecommand.CodeOf(store.ConfirmStart(context.Background(), command, &started)) != nodecommand.CodeExecutionUnknown {
		t.Fatal("stopped running attempt authorized physical execution")
	}
}

func chainStoreFixture(t *testing.T, direct ...bool) (*ChainExecutionStore, *resultReaderFixture, *reservationRPC, nodecommand.NodeCommand, runtimeadapter.ExecutionRecord, []byte) {
	t.Helper()
	id := func(n string) string { return "0x" + strings.Repeat(n, 64) }
	private := ed25519.NewKeyFromSeed(bytesRepeated(9, 32))
	signer := &Keypair{Private: private, Public: private.Public().(ed25519.PublicKey)}
	t.Cleanup(func() { clear(private) })
	cmd := nodecommand.NodeCommand{Version: nodecommand.ProtocolVersion, Signer: id("1"), Capability: nodecommand.CapabilityRef{ID: id("3"), RevocationVersion: 1}, CommandID: "cmd", Nonce: "nonce", IdempotencyKey: "idem", Action: "assign", Scope: "control", Target: nodecommand.Target{OrganizationID: id("2"), NodeID: signer.Address(), AgentID: "worker"}, Budget: &nodecommand.BudgetClaim{Asset: "MIST", Amount: 20}, PayloadHash: strings.Repeat("ab", 32), IssuedAtMS: 1, ExpiresAtMS: 100}
	if len(direct) == 1 && direct[0] {
		cmd.Action, cmd.Scope, cmd.Budget.Asset = "direct.message", "direct", "TOOL_CALLS"
	}
	reservation, err := commandReservation(cmd)
	if err != nil {
		t.Fatal(err)
	}
	reader := &resultReaderFixture{run: nodecommand.ChainExecution{ID: id("5"), CapabilityID: cmd.Capability.ID, Signer: cmd.Signer, CommandID: cmd.CommandID, Nonce: cmd.Nonce, IdempotencyKey: cmd.IdempotencyKey, Fingerprint: reservation.Fingerprint, Action: cmd.Action, Scope: cmd.Scope, Target: cmd.Target, Budget: cmd.Budget, IssuedAtMS: cmd.IssuedAtMS, ExpiresAtMS: cmd.ExpiresAtMS, CapabilityVersion: 1, MembershipID: id("4"), HostAddress: signer.Address(), State: 1, Cursor: 2, AttemptID: strings.Repeat("bc", 32)}}
	secret := bytesRepeated(7, 32)
	host, err := ecdh.X25519().NewPrivateKey(secret)
	if err != nil {
		t.Fatal(err)
	}
	ephemeral, err := ecdh.X25519().NewPrivateKey(bytesRepeated(8, 32))
	if err != nil {
		t.Fatal(err)
	}
	shared, err := ephemeral.ECDH(host.PublicKey())
	if err != nil {
		t.Fatal(err)
	}
	defer clear(shared)
	contextString, err := productcrypto.CommandResultWrapContext(cmd.Target.OrganizationID, cmd.Capability.ID, reader.run.MembershipID, reader.run.Fingerprint, 1)
	if err != nil {
		t.Fatal(err)
	}
	salt := bytesRepeated(1, 32)
	wrapping := make([]byte, 32)
	if _, err = io.ReadFull(hkdf.New(sha256.New, shared, salt, []byte("fractalmind.key-wrap.v1:"+contextString)), wrapping); err != nil {
		t.Fatal(err)
	}
	defer clear(wrapping)
	key := bytesRepeated(6, 32)
	wrapped, err := productcrypto.Encrypt(key, wrapping, contextString)
	if err != nil {
		t.Fatal(err)
	}
	envelope := append([]byte("FMW1"), ephemeral.PublicKey().Bytes()...)
	envelope = append(envelope, salt...)
	envelope = append(envelope, wrapped...)
	reader.grant = nodecommand.ChainResultKeyGrant{OrganizationID: cmd.Target.OrganizationID, MembershipID: reader.run.MembershipID, HostAddress: signer.Address(), KeyVersion: 1, WrappedKey: envelope}
	rpc := &reservationRPC{}
	store, err := NewChainExecutionStore(reader, rpc, signer, id("a"), func(context.Context) ([]byte, error) { return append([]byte(nil), secret...), nil })
	if err != nil {
		t.Fatal(err)
	}
	record := runtimeadapter.ExecutionRecord{Version: "1", Response: runtimeadapter.Response{SchemaVersion: runtimeadapter.SchemaVersion, Adapter: runtimeadapter.AdapterName, CommandID: cmd.CommandID, Operation: runtimeadapter.Operation(cmd.Action), OK: true, ObservedAt: "2026-09-30T00:00:00Z", Spend: &runtimeadapter.Spend{Asset: cmd.Budget.Asset, Amount: 3, Known: true}}, Event: nodecommand.NodeEvent{Version: nodecommand.ProtocolVersion, CommandID: cmd.CommandID, Target: cmd.Target, Type: "runtime_result", ResultCode: "runtime_ok", OccurredAtMS: 2}}
	return store, reader, rpc, cmd, record, key
}
func bytesRepeated(value byte, count int) []byte {
	b := make([]byte, count)
	for i := range b {
		b[i] = value
	}
	return b
}

func TestDirectResultUsesCoreCiphertextHelperAndRestoresOriginalLedger(t *testing.T) {
	for _, known := range []bool{true, false} {
		t.Run(fmt.Sprintf("known=%v", known), func(t *testing.T) {
			store, reader, rpc, cmd, record, key := chainStoreFixture(t, true)
			pkg := "0x" + strings.Repeat("b", 64)
			store.directPackageID = pkg
			reader.run.Direct = &nodecommand.DirectExecutionAuthority{PermissionID: "0x" + strings.Repeat("c", 64), PermissionVersion: 2}
			if !known {
				record.Response.Spend = nil
			}
			var call models.MoveCallRequest
			sends := 0
			rpc.build = func(req models.MoveCallRequest) (models.TxnMetaData, error) {
				call = req
				return models.TxnMetaData{TxBytes: base64.StdEncoding.EncodeToString([]byte("direct result transaction"))}, nil
			}
			rpc.send = func(req models.SignAndExecuteTransactionBlockRequest) (models.SuiTransactionBlockResponse, error) {
				sends++
				if call.PackageObjectId != pkg || call.Module != "direct_agent" || call.Function != "finish_message" || len(call.Arguments) != 10 || call.Arguments[0] != ObjectArgument(reader.run.Direct.PermissionID) {
					t.Fatalf("wrong direct result route: %+v", call)
				}
				chunk, ok := call.Arguments[8].(PackageChunkedBytes)
				if !ok || chunk.PackageID != store.packageID {
					t.Fatal("ciphertext helper did not use core")
				}
				if _, err := productcrypto.DecryptCommandResult(chunk.Bytes, key, resultContext(reader.run, 1)); err != nil {
					t.Fatal(err)
				}
				reader.run.State = call.Arguments[4].(uint8)
				reader.run.BudgetSettled = known
				if known {
					reader.run.BudgetSpent = 3
				} else {
					reader.run.BudgetReserved = 20
				}
				reader.run.ResultRecordID = "record"
				hash := sha256.Sum256(chunk.Bytes)
				reader.run.ResultHash = hex.EncodeToString(hash[:])
				receipt := txResponse(t, req.TxnMetaData, "success")
				reader.result = nodecommand.ChainExecutionResult{EncryptedBody: chunk.Bytes, KeyVersion: 1, TransactionDigest: receipt.Digest}
				return receipt, nil
			}
			started := reader.run
			saved, err := store.SaveCommand(context.Background(), cmd, &started, record)
			if err != nil {
				t.Fatal(err)
			}
			state := uint8(2)
			spent := "3"
			if !known {
				state = 4
				spent = "0"
			}
			if reader.run.State != state || call.Arguments[6] != spent || saved.Response.RequiresConfirmation == known || sends != 1 {
				t.Fatal("wrong direct settlement", saved, call.Arguments)
			}
			fresh, err := NewChainExecutionStore(reader, rpc, store.signer, store.packageID, store.secret, ChainExecutionStoreOptions{DirectPackageID: pkg})
			if err != nil {
				t.Fatal(err)
			}
			loaded, found, err := fresh.LoadCommand(context.Background(), cmd)
			if err != nil || !found || loaded.Response.TransactionDigest != saved.Response.TransactionDigest || loaded.Response.RequiresConfirmation != saved.Response.RequiresConfirmation || sends != 1 {
				t.Fatal("fresh direct reader did not reuse original", err)
			}
		})
	}
}

func TestChainResultStorePersistsAndLoadsWithoutCache(t *testing.T) {
	for _, known := range []bool{true, false} {
		t.Run(map[bool]string{true: "known cost", false: "unknown cost"}[known], func(t *testing.T) {
			store, reader, rpc, cmd, record, key := chainStoreFixture(t)
			if !known {
				record.Response.Spend = nil
			}
			// A runtime-provided value cannot claim the eventual creation digest.
			record.Response.TransactionDigest = "untrusted-runtime-digest"
			if err := store.Preflight(context.Background(), cmd); err != nil {
				t.Fatal(err)
			}
			started := reader.run
			if err := store.ConfirmStart(context.Background(), cmd, &started); err != nil {
				t.Fatal(err)
			}
			sends := 0
			var call models.MoveCallRequest
			rpc.build = func(req models.MoveCallRequest) (models.TxnMetaData, error) {
				call = req
				return models.TxnMetaData{TxBytes: base64.StdEncoding.EncodeToString([]byte("fixture transaction"))}, nil
			}
			rpc.send = func(req models.SignAndExecuteTransactionBlockRequest) (models.SuiTransactionBlockResponse, error) {
				sends++
				if call.Function != "finish_command_with_budget" {
					t.Fatalf("wrong entry %s", call.Function)
				}
				ciphertext := []byte(call.Arguments[7].(ChunkedBytes))
				if _, err := productcrypto.DecryptCommandResult(ciphertext, key, resultContext(reader.run, 1)); err != nil {
					t.Fatal(err)
				}
				reader.run.State = call.Arguments[3].(uint8)
				if known {
					reader.run.BudgetSpent = 3
					reader.run.BudgetSettled = true
				} else {
					reader.run.BudgetReserved = 20
				}
				reader.run.ResultRecordID = "record"
				hash := sha256.Sum256(ciphertext)
				reader.run.ResultHash = hex.EncodeToString(hash[:])
				receipt := txResponse(t, req.TxnMetaData, "success")
				reader.result = nodecommand.ChainExecutionResult{EncryptedBody: ciphertext, KeyVersion: 1, TransactionDigest: receipt.Digest}
				return receipt, nil
			}
			saved, err := store.SaveCommand(context.Background(), cmd, &started, record)
			if err != nil {
				t.Fatal(err)
			}
			expectedState, expectedSpend := uint8(2), "3"
			if !known {
				expectedState, expectedSpend = 4, "0"
			}
			if reader.run.State != expectedState || call.Arguments[5] != expectedSpend || sends != 1 || saved.Response.TransactionDigest == "" || saved.Response.RequiresConfirmation == known {
				t.Fatalf("state=%d spend=%v sends=%d response=%+v", reader.run.State, call.Arguments[5], sends, saved.Response)
			}
			fresh, err := NewChainExecutionStore(reader, rpc, store.signer, store.packageID, store.secret)
			if err != nil {
				t.Fatal(err)
			}
			loaded, found, err := fresh.LoadCommand(context.Background(), cmd)
			if err != nil || !found || loaded.Response.ExecutionState != saved.Response.ExecutionState || loaded.Response.TransactionDigest != saved.Response.TransactionDigest || sends != 1 {
				t.Fatalf("loaded=%+v found=%t sends=%d err=%v", loaded, found, sends, err)
			}
		})
	}
}

func TestChainResultStoreLostReceiptNeverResends(t *testing.T) {
	store, reader, rpc, cmd, record, _ := chainStoreFixture(t)
	started := reader.run
	sends := 0
	rpc.build = func(models.MoveCallRequest) (models.TxnMetaData, error) {
		return models.TxnMetaData{TxBytes: base64.StdEncoding.EncodeToString([]byte("fixture transaction"))}, nil
	}
	rpc.send = func(models.SignAndExecuteTransactionBlockRequest) (models.SuiTransactionBlockResponse, error) {
		sends++
		return models.SuiTransactionBlockResponse{}, errors.New("receipt lost")
	}
	_, err := store.SaveCommand(context.Background(), cmd, &started, record)
	var rejection *nodecommand.RejectionError
	if !errors.As(err, &rejection) || rejection.Code != nodecommand.CodeExecutionUnknown || rejection.TransactionDigest == "" || sends != 1 {
		t.Fatalf("sends=%d err=%v", sends, err)
	}
	_, found, err := store.LoadCommand(context.Background(), cmd)
	if err != nil || found || sends != 1 {
		t.Fatalf("found=%t sends=%d err=%v", found, sends, err)
	}
}

func TestChainResultStoreRejectsBeforeWriting(t *testing.T) {
	for _, mode := range []string{"attempt", "overspend", "asset", "key", "target"} {
		t.Run(mode, func(t *testing.T) {
			store, reader, _, cmd, record, _ := chainStoreFixture(t)
			started := reader.run
			switch mode {
			case "attempt":
				started.AttemptID = strings.Repeat("cd", 32)
			case "overspend":
				record.Response.Spend.Amount = 21
			case "asset":
				record.Response.Spend.Asset = "USD"
			case "key":
				reader.missingKey = true
			case "target":
				record.Event.Target.AgentID = "other"
			}
			_, err := store.SaveCommand(context.Background(), cmd, &started, record)
			var rejection *nodecommand.RejectionError
			if !errors.As(err, &rejection) || rejection.Code != nodecommand.CodeExecutionUnknown {
				t.Fatalf("err=%v", err)
			}
		})
	}
}

func TestChainResultGasPrerequisiteDoesNotGateHistoricalReads(t *testing.T) {
	store, reader, rpc, cmd, _, _ := chainStoreFixture(t)
	checks := 0
	rpc.coins = func(models.SuiXGetCoinsRequest) (models.PaginatedCoinsResponse, error) {
		checks++
		return models.PaginatedCoinsResponse{Data: []models.CoinData{{Balance: "100000000"}}}, nil
	}
	if nodecommand.CodeOf(store.Preflight(context.Background(), cmd)) != nodecommand.CodeHostGasInsufficient || checks != 1 {
		t.Fatal("insufficient result publication gas allowed work")
	}
	reader.run.State = 2
	reader.run.ResultRecordID = "historical"
	reader.result.KeyVersion = 1
	if err := store.Preflight(context.Background(), cmd); err != nil || checks != 1 {
		t.Fatalf("historical result unnecessarily requires gas: %v", err)
	}
	reader.run.State = 0
	reader.run.ResultRecordID = ""
	rpc.coins = func(req models.SuiXGetCoinsRequest) (models.PaginatedCoinsResponse, error) {
		if req.Cursor == "" {
			return models.PaginatedCoinsResponse{Data: []models.CoinData{{Balance: "2000000000"}}, HasNextPage: true, NextCursor: "next"}, nil
		}
		return models.PaginatedCoinsResponse{Data: []models.CoinData{{Balance: "100000000"}}}, nil
	}
	if err := store.Preflight(context.Background(), cmd); err != nil {
		t.Fatal(err)
	}
	rpc.coins = func(models.SuiXGetCoinsRequest) (models.PaginatedCoinsResponse, error) {
		return models.PaginatedCoinsResponse{}, errors.New("RPC offline")
	}
	if nodecommand.CodeOf(store.Preflight(context.Background(), cmd)) != nodecommand.CodeHostGasUnavailable {
		t.Fatal("RPC outage allowed execution")
	}
}

func TestChainResultStoreRejectsContradictoryBody(t *testing.T) {
	for _, mode := range []string{"valid", "state", "cost", "execution", "confirmation"} {
		t.Run(mode, func(t *testing.T) {
			store, reader, _, cmd, record, key := chainStoreFixture(t)
			reader.run.State, reader.run.BudgetSpent, reader.run.ResultRecordID = 2, 3, "record"
			record.Response.ExecutionID, record.Response.ExecutionState = reader.run.ID, "succeeded"
			switch mode {
			case "state":
				record.Response.ExecutionState = "failed"
			case "cost":
				record.Response.Spend.Amount = 4
			case "execution":
				record.Response.ExecutionID = "other"
			case "confirmation":
				record.Response.RequiresConfirmation = true
			}
			plaintext, err := json.Marshal(record)
			if err != nil {
				t.Fatal(err)
			}
			ciphertext, err := productcrypto.EncryptCommandResult(plaintext, key, resultContext(reader.run, 1))
			if err != nil {
				t.Fatal(err)
			}
			reader.result = nodecommand.ChainExecutionResult{EncryptedBody: ciphertext, KeyVersion: 1}
			_, found, err := store.LoadCommand(context.Background(), cmd)
			if mode == "valid" {
				if err != nil || !found {
					t.Fatalf("valid record: %v", err)
				}
			} else if err == nil || found {
				t.Fatal("contradictory authenticated record accepted")
			}
		})
	}
}

func TestChainResultStoreLostCommittedReceiptCanBeQueried(t *testing.T) {
	store, reader, rpc, cmd, record, _ := chainStoreFixture(t)
	started := reader.run
	writes := 0
	var call models.MoveCallRequest
	rpc.build = func(req models.MoveCallRequest) (models.TxnMetaData, error) {
		call = req
		return models.TxnMetaData{TxBytes: base64.StdEncoding.EncodeToString([]byte("committed fixture"))}, nil
	}
	rpc.send = func(models.SignAndExecuteTransactionBlockRequest) (models.SuiTransactionBlockResponse, error) {
		writes++
		reader.run.State, reader.run.BudgetSpent, reader.run.ResultRecordID = 2, 3, "record"
		reader.result = nodecommand.ChainExecutionResult{EncryptedBody: []byte(call.Arguments[7].(ChunkedBytes)), KeyVersion: 1}
		return models.SuiTransactionBlockResponse{}, errors.New("committed but receipt lost")
	}
	if _, err := store.SaveCommand(context.Background(), cmd, &started, record); nodecommand.CodeOf(err) != nodecommand.CodeExecutionUnknown {
		t.Fatalf("expected unknown receipt: %v", err)
	}
	loaded, found, err := store.LoadCommand(context.Background(), cmd)
	if err != nil || !found || loaded.Response.ExecutionState != "succeeded" || writes != 1 {
		t.Fatalf("found=%t writes=%d err=%v", found, writes, err)
	}
}
