package sui

import (
	"context"
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"strings"
	"testing"

	"github.com/block-vision/sui-go-sdk/models"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/productcrypto"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/runtimeadapter"
	"golang.org/x/crypto/hkdf"
)

func (r *resultReaderFixture) ChainTime(context.Context) (int64, error) {
	if r.clockOverride != 0 {
		return r.clockOverride, nil
	}
	return 1700000000000, nil
}

func handoverStoreFixture(t *testing.T) (*ChainExecutionStore, *resultReaderFixture, *reservationRPC, nodecommand.NodeCommand, runtimeadapter.ExecutionRecord, []byte) {
	t.Helper()
	store, reader, rpc, command, record, key := chainStoreFixture(t)
	full := func(value string) string { return "0x" + strings.Repeat(value, 64) }
	const now = 1700000000000
	private := ed25519.NewKeyFromSeed(bytesRepeated(4, 32))
	device := &Keypair{Private: private, Public: private.Public().(ed25519.PublicKey)}
	command.Action = "status"
	command.Scope = "observation"
	command.Budget = nil
	command.Signer = device.Address()
	command.Target.AgentID = "native-" + strings.Repeat("d", 64)
	command.IssuedAtMS = now
	command.ExpiresAtMS = now + 60000
	p := nodecommand.HandoverProposal{Version: "1", ManagedAgentID: full("6"), ManagedVersion: 1, OkrID: full("7"), OkrVersion: 1, SpecRevision: 1, WorkspaceHash: strings.Repeat("e", 64), Paths: map[string][]string{"file.read": {"."}, "file.write": {"."}}, BudgetAsset: "TOOL_CALLS", BudgetLimit: 10, MaxCalls: 3, ExpiresAtMS: now + 60000, ReviewExpiresAtMS: now + 30000, Nonce: strings.Repeat("f", 64)}
	command.Payload, _ = json.Marshal(map[string]any{"handover_review": p})
	command.PayloadHash = nodecommand.HashPayload(command.Payload)
	data, err := command.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	command.Signature = "ed25519:" + hex.EncodeToString(device.Public) + ":" + hex.EncodeToString(device.Sign(data))
	reservation, err := commandReservation(command)
	if err != nil {
		t.Fatal(err)
	}
	reader.run.Fingerprint = reservation.Fingerprint
	reader.run.Action = command.Action
	reader.run.Scope = command.Scope
	reader.run.Signer = command.Signer
	reader.run.Target = command.Target
	reader.run.Budget = nil
	reader.run.IssuedAtMS = command.IssuedAtMS
	reader.run.ExpiresAtMS = command.ExpiresAtMS
	reader.run.HumanID = full("8")
	reader.run.GrantID = full("9")
	reader.run.CoordinatorBindingID = full("a")
	reader.run.ManagedAgentID = p.ManagedAgentID
	host, err := ecdh.X25519().NewPrivateKey(bytesRepeated(7, 32))
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
	contextString, err := productcrypto.CommandResultWrapContext(command.Target.OrganizationID, command.Capability.ID, reader.run.MembershipID, reader.run.Fingerprint, 1)
	if err != nil {
		t.Fatal(err)
	}
	salt := bytesRepeated(1, 32)
	wrapping := make([]byte, 32)
	if _, err = io.ReadFull(hkdf.New(sha256.New, shared, salt, []byte("fractalmind.key-wrap.v1:"+contextString)), wrapping); err != nil {
		t.Fatal(err)
	}
	defer clear(wrapping)
	wrapped, err := productcrypto.Encrypt(key, wrapping, contextString)
	if err != nil {
		t.Fatal(err)
	}
	envelope := append([]byte("FMW1"), ephemeral.PublicKey().Bytes()...)
	envelope = append(envelope, salt...)
	envelope = append(envelope, wrapped...)
	reader.grant.WrappedKey = envelope
	record.Response.Operation = runtimeadapter.OperationStatus
	record.Response.Spend = nil
	record.Event.Target = command.Target
	record.Response.HandoverReview = &nodecommand.HandoverAcceptance{Version: "1", ExecutionID: reader.run.ID, OrganizationID: command.Target.OrganizationID, HumanID: reader.run.HumanID, GrantID: reader.run.GrantID, MembershipID: reader.run.MembershipID, BindingID: reader.run.CoordinatorBindingID, HostAddress: reader.run.HostAddress, InstanceID: command.Target.AgentID, Proposal: p, CoverageRevision: 2, ObservedAtMS: now}
	return store, reader, rpc, command, record, key
}
func TestHandoverAcceptanceIsHostSignedEncryptedAndRecoveredUnchanged(t *testing.T) {
	store, reader, rpc, command, record, key := handoverStoreFixture(t)
	started := reader.run
	var call models.MoveCallRequest
	sends := 0
	rpc.build = func(req models.MoveCallRequest) (models.TxnMetaData, error) {
		call = req
		return models.TxnMetaData{TxBytes: base64.StdEncoding.EncodeToString([]byte("handover review fixture transaction"))}, nil
	}
	rpc.send = func(req models.SignAndExecuteTransactionBlockRequest) (models.SuiTransactionBlockResponse, error) {
		sends++
		ciphertext := []byte(call.Arguments[7].(ChunkedBytes))
		plaintext, err := productcrypto.DecryptCommandResult(ciphertext, key, resultContext(reader.run, 1))
		if err != nil {
			t.Fatal(err)
		}
		var persisted runtimeadapter.ExecutionRecord
		if err = json.Unmarshal(plaintext, &persisted); err != nil {
			t.Fatal(err)
		}
		if persisted.Response.HandoverReview == nil || persisted.Response.HandoverReview.VerifySignature(context.Background()) != nil {
			t.Fatal("acceptance was not independently Host signed before encryption")
		}
		reader.run.State = call.Arguments[3].(uint8)
		reader.run.BudgetSettled = true
		reader.run.ResultRecordID = "record"
		hash := sha256.Sum256(ciphertext)
		reader.run.ResultHash = hex.EncodeToString(hash[:])
		receipt := txResponse(t, req.TxnMetaData, "success")
		reader.result = nodecommand.ChainExecutionResult{EncryptedBody: ciphertext, KeyVersion: 1, TransactionDigest: receipt.Digest}
		return receipt, nil
	}
	saved, err := store.SaveCommand(context.Background(), command, &started, record)
	if err != nil {
		t.Fatal(err)
	}
	acceptance := saved.Response.HandoverReview
	if reader.run.State != 2 || sends != 1 || acceptance == nil || acceptance.Signature == "" || record.Response.HandoverReview.Signature != "" {
		t.Fatal("publication changed caller proof or failed")
	}
	// Rebuilding the store has no runtime lease or local business cache.
	fresh, err := NewChainExecutionStore(reader, rpc, store.signer, store.packageID, store.secret)
	if err != nil {
		t.Fatal(err)
	}
	reader.clockOverride = 1700000100000 // Expired history remains historical; its deadline is never refreshed.
	recovered, found, err := fresh.LoadCommand(context.Background(), command)
	if err != nil || !found || recovered.Response.HandoverReview.Signature != acceptance.Signature || recovered.Response.HandoverReview.Proposal.ReviewExpiresAtMS != acceptance.Proposal.ReviewExpiresAtMS || sends != 1 {
		t.Fatalf("recovery refreshed or lost acceptance: %v %v", found, err)
	}
	// A holder of the encrypted record key cannot forge the independent Host proof.
	plaintext, err := productcrypto.DecryptCommandResult(reader.result.EncryptedBody, key, resultContext(reader.run, 1))
	if err != nil {
		t.Fatal(err)
	}
	var tampered runtimeadapter.ExecutionRecord
	json.Unmarshal(plaintext, &tampered)
	tampered.Response.HandoverReview.ObservedAtMS++
	plaintext, _ = json.Marshal(tampered)
	reader.result.EncryptedBody, err = productcrypto.EncryptCommandResult(plaintext, key, resultContext(reader.run, 1))
	if err != nil {
		t.Fatal(err)
	}
	if _, found, err := fresh.LoadCommand(context.Background(), command); err == nil || found || sends != 1 {
		t.Fatal("forged stored Host acceptance accepted")
	}
}
func TestHandoverStoreRejectsAlteredOrExpiredAcceptanceBeforeSigning(t *testing.T) {
	for _, mode := range []string{"proposal", "Host", "Human", "binding", "instance", "signature", "unsigned device", "expired", "missing acceptance", "failed result", "expired chain Clock", "future observation", "missing Clock"} {
		t.Run(mode, func(t *testing.T) {
			store, reader, rpc, command, record, _ := handoverStoreFixture(t)
			started := reader.run
			switch mode {
			case "proposal":
				record.Response.HandoverReview.Proposal.MaxCalls++
			case "Host":
				record.Response.HandoverReview.HostAddress = command.Signer
			case "Human":
				record.Response.HandoverReview.HumanID = command.Capability.ID
			case "binding":
				record.Response.HandoverReview.BindingID = command.Capability.ID
			case "instance":
				record.Response.HandoverReview.InstanceID = "native-" + strings.Repeat("a", 64)
			case "signature":
				record.Response.HandoverReview.Signature = "untrusted"
			case "unsigned device":
				command.Signature = ""
			case "expired chain Clock":
				reader.clockOverride = record.Response.HandoverReview.Proposal.ReviewExpiresAtMS
			case "future observation":
				reader.clockOverride = record.Response.HandoverReview.ObservedAtMS - 1
			case "missing Clock":
				store.reader = &reviewReaderWithoutClock{reader}
			case "expired":
				record.Response.HandoverReview.ObservedAtMS = 1699999999000
				record.Response.HandoverReview.Proposal.ReviewExpiresAtMS = 1700000000000
			case "missing acceptance":
				record.Response.HandoverReview = nil
			case "failed result":
				record.Response.OK = false
				record.Response.Error = &runtimeadapter.Error{Code: "handover_changed", Message: "changed"}
			}
			builds := 0
			rpc.build = func(models.MoveCallRequest) (models.TxnMetaData, error) {
				builds++
				t.Fatal("invalid acceptance reached publication")
				return models.TxnMetaData{}, nil
			}
			if _, err := store.SaveCommand(context.Background(), command, &started, record); err == nil || builds != 0 {
				t.Fatal("invalid acceptance signed", err)
			}
		})
	}
}

// An ExecutionResultReader does not implicitly supply a trusted chain Clock.
type reviewReaderWithoutClock struct{ ExecutionResultReader }
