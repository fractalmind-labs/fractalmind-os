package nodecommand

import (
	"context"
	"crypto/sha256"
	"testing"

	"github.com/block-vision/sui-go-sdk/mystenbcs"
)

func resultFixture(t *testing.T) (*chainFixture, string, moveEncryptedRecord) {
	t.Helper()
	f, fingerprint, _ := executionFixture(t, 2, moveBoundBudgetClaim{Reserved: 20, Spent: 7, Settled: true})
	var run moveExecution
	if err := decodeChainBCS(f.objects[addressNumber(11).String()].Content, &run); err != nil {
		t.Fatal(err)
	}
	run.Result = []moveAddress{addressNumber(13)}
	run.Updated = 1700000001000
	body := append([]byte("FME1"), make([]byte, 40)...)
	hash := sha256.Sum256(body)
	run.ResultHash = hash[:]
	f.saveObject(t, run.ID, "node_execution::CommandExecution", run)
	record := moveEncryptedRecord{ID: run.Result[0], Org: run.Org, Kind: 5, LogicalID: "command-" + fingerprint,
		Revision: 1, KeyVersion: 2, Human: run.Human, Device: run.Host, Grant: run.Grant,
		GrantVersion: run.GrantVersion, CreatedMS: run.Updated, Body: body}
	saveResult(t, f, record)
	return f, fingerprint, record
}

func saveResult(t *testing.T, f *chainFixture, record moveEncryptedRecord) {
	t.Helper()
	f.saveObject(t, record.ID, "product_record::EncryptedRecord", record)
	object := f.objects[record.ID.String()]
	object.Shared, object.Immutable = false, true
	f.objects[object.ID] = object
}

func TestChainExecutionResultAuthenticatesRecordBinding(t *testing.T) {
	f, fingerprint, record := resultFixture(t)
	object := f.objects[record.ID.String()]
	object.PreviousTransaction = "original-chain-creation-digest"
	f.objects[object.ID] = object
	got, found, err := f.resolver.ReadExecutionResult(context.Background(), f.cap.ID.String(), fingerprint)
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	if got.ID != record.ID.String() || got.KeyVersion != 2 || got.LogicalID != record.LogicalID || string(got.EncryptedBody) != string(record.Body) || got.TransactionDigest != object.PreviousTransaction {
		t.Fatalf("wrong result %+v", got)
	}
	// The historical key version remains readable independently of current
	// device/grant validity; this read does not authorize a new command.
	f.grant.Revoked = true
	f.sync(t)
	_, found, err = f.resolver.ReadExecutionResult(context.Background(), f.cap.ID.String(), fingerprint)
	if err != nil || !found {
		t.Fatalf("historical read found=%v err=%v", found, err)
	}
}

func TestChainExecutionResultRejectsMismatchedEvidence(t *testing.T) {
	for _, mode := range []string{"UID", "organization", "kind", "logical ID", "revision", "key version", "previous", "Human", "Host", "grant", "grant version", "time", "body", "header", "oversize", "trailing BCS", "not immutable", "owned", "wrong package", "missing", "RPC failure"} {
		t.Run(mode, func(t *testing.T) {
			f, fingerprint, record := resultFixture(t)
			switch mode {
			case "organization":
				record.Org = addressNumber(99)
			case "kind":
				record.Kind = 1
			case "logical ID":
				record.LogicalID = "another-command"
			case "revision":
				record.Revision = 2
			case "key version":
				record.KeyVersion = 0
			case "previous":
				record.Previous = []moveAddress{addressNumber(99)}
			case "Human":
				record.Human = addressNumber(99)
			case "Host":
				record.Device = addressNumber(99)
			case "grant":
				record.Grant = addressNumber(99)
			case "grant version":
				record.GrantVersion++
			case "time":
				record.CreatedMS++
			case "body":
				record.Body[20] = 1
			case "header":
				record.Body[0] = 0
			case "oversize":
				record.Body = make([]byte, 65537)
			}
			saveResult(t, f, record)
			object := f.objects[record.ID.String()]
			switch mode {
			case "UID":
				object.Content[0] = 1
			case "trailing BCS":
				object.Content = append(object.Content, 0)
			case "not immutable":
				object.Immutable, object.Shared = false, true
			case "owned":
				object.OwnerID = f.member.ID.String()
			case "wrong package":
				object.Type = "0x99::product_record::EncryptedRecord"
			case "RPC failure":
				f.fail = true
			}
			f.objects[object.ID] = object
			if mode == "missing" {
				delete(f.objects, object.ID)
			}
			_, found, err := f.resolver.ReadExecutionResult(context.Background(), f.cap.ID.String(), fingerprint)
			if err == nil || found {
				t.Fatalf("untrusted result accepted found=%v err=%v", found, err)
			}
		})
	}
}

func TestChainExecutionResultAbsenceIsNotSuccess(t *testing.T) {
	for _, state := range []uint8{0, 1, 2, 3, 4, 5} {
		settled := state == 2 || state == 3 || state == 5
		f, fingerprint, _ := executionFixture(t, state, moveBoundBudgetClaim{Reserved: 20, Settled: settled})
		_, found, err := f.resolver.ReadExecutionResult(context.Background(), f.cap.ID.String(), fingerprint)
		if found || ((state == 2 || state == 3 || state == 4) != (err != nil)) {
			t.Fatalf("state=%d found=%v err=%v", state, found, err)
		}
	}
	f, fingerprint, record := resultFixture(t)
	var run moveExecution
	if err := decodeChainBCS(f.objects[addressNumber(11).String()].Content, &run); err != nil {
		t.Fatal(err)
	}
	run.State = 1
	f.saveObject(t, run.ID, "node_execution::CommandExecution", run)
	// Make the budget itself a valid running ledger, isolating the result guard.
	hash := run.IntentHash
	pkg := f.resolver.packageID
	f.saveField(t, f.cap.ID, structKeyTag(pkg, "remote_authority", "BoundBudgetClaimKey"), appendBCSBytes(nil, hash), pkg+"::remote_authority::BoundBudgetClaimKey", pkg+"::remote_authority::BoundBudgetClaim", moveBoundBudgetClaim{Reserved: 20})
	if _, found, err := f.resolver.ReadExecutionResult(context.Background(), f.cap.ID.String(), fingerprint); err == nil || found {
		t.Fatal("running checkpoint with result accepted")
	}
	// Decode fixture directly once to ensure raw immutable record schema is lossless.
	encoded, err := mystenbcs.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	var decoded moveEncryptedRecord
	if err := decodeChainBCS(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
}
