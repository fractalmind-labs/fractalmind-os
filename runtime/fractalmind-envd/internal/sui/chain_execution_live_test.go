package sui

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/productcrypto"
)

func TestChainExecutionLive(t *testing.T) {
	raw := os.Getenv("FM_CHAIN_EXECUTION_CASE")
	if raw == "" {
		t.Skip("requires isolated localnet device-prepared command")
	}
	var input struct {
		RPC, PackageID    string
		Command           nodecommand.NodeCommand
		ExpectedDuplicate bool
		ExpectedCode      string
	}
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		t.Fatal(err)
	}
	seed, err := hex.DecodeString(os.Getenv("FM_CHAIN_EXECUTION_TEST_SEED"))
	if err != nil || len(seed) != 32 {
		t.Fatal("missing generated localnet test Host key")
	}
	private := ed25519.NewKeyFromSeed(seed)
	defer func() { clear(private); clear(seed) }()
	keypair := &Keypair{Private: private, Public: private.Public().(ed25519.PublicKey)}
	client, err := NewGRPCClient(input.RPC, "")
	if err != nil {
		t.Fatalf("%v (cause: %v)", err, errors.Unwrap(err))
	}
	defer client.Close()
	resolver, err := nodecommand.NewChainAuthorityResolver(client, input.PackageID)
	if err != nil {
		t.Fatal(err)
	}
	backend, err := NewChainReservations(resolver, client, keypair, input.PackageID)
	if err != nil {
		t.Fatal(err)
	}
	store, err := nodecommand.NewChainAuthorityStore(resolver, backend)
	if err != nil {
		t.Fatal(err)
	}
	validator := nodecommand.NewValidator(nodecommand.Ed25519Verifier{}, store, nodecommand.ValidatorOptions{LocalTarget: input.Command.Target, HighRiskActions: map[string]struct{}{"assign": {}}, BudgetedActions: map[string]struct{}{"assign": {}}})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	result, err := validator.Validate(ctx, input.Command)
	if input.ExpectedCode != "" {
		if string(nodecommand.CodeOf(err)) != input.ExpectedCode {
			t.Fatalf("expected %s, got %v", input.ExpectedCode, err)
		}
		encoded, _ := json.Marshal(map[string]any{"commandId": input.Command.CommandID, "code": input.ExpectedCode})
		t.Logf("FM_EXECUTION_EVIDENCE %s", encoded)
		return
	}
	if err != nil {
		t.Fatalf("%v (cause: %v)", err, errors.Unwrap(err))
	}
	if result.Duplicate != input.ExpectedDuplicate {
		t.Fatalf("expected duplicate %t, got %t", input.ExpectedDuplicate, result.Duplicate)
	}
	t.Logf("real chain command preflight: duplicate=%t", result.Duplicate)
	encoded, _ := json.Marshal(map[string]any{"commandId": input.Command.CommandID, "duplicate": result.Duplicate, "transactionDigest": result.TransactionDigest, "execution": result.Execution})
	t.Logf("FM_EXECUTION_EVIDENCE %s", encoded)
}

// Read-only diagnosis also works after a test wallet has been discarded. It
// never turns a visible RUNNING checkpoint into permission to run an adapter.
func TestChainExecutionReadLive(t *testing.T) {
	raw := os.Getenv("FM_CHAIN_EXECUTION_PUBLIC")
	if raw == "" {
		t.Skip("requires public isolated-localnet execution IDs")
	}
	var input struct{ RPC, PackageID, CapabilityID, Fingerprint string }
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		t.Fatal(err)
	}
	client, err := NewGRPCClient(input.RPC, "")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	resolver, err := nodecommand.NewChainAuthorityResolver(client, input.PackageID)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	run, found, err := resolver.LookupExecution(ctx, input.CapabilityID, input.Fingerprint)
	if err != nil || !found {
		t.Fatalf("execution read: found=%t error=%v", found, err)
	}
	t.Logf("execution=%s state=%d cursor=%d", run.ID, run.State, run.Cursor)
}

func TestChainExecutionResultReadLive(t *testing.T) {
	raw := os.Getenv("FM_CHAIN_RESULT_PUBLIC")
	if raw == "" {
		t.Skip("requires public isolated-localnet terminal checkpoint")
	}
	var input struct{ RPC, PackageID, CapabilityID, Fingerprint, ExpectedRecordID string }
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		t.Fatal(err)
	}
	client, err := NewGRPCClient(input.RPC, "")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	resolver, err := nodecommand.NewChainAuthorityResolver(client, input.PackageID)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result, found, err := resolver.ReadExecutionResult(ctx, input.CapabilityID, input.Fingerprint)
	if err != nil || !found {
		t.Fatalf("result read: found=%v error=%v", found, err)
	}
	if result.ID != input.ExpectedRecordID {
		t.Fatalf("result pointer mismatch: %s", result.ID)
	}
	encoded, _ := json.Marshal(map[string]any{"recordId": result.ID, "state": result.Execution.State, "keyVersion": result.KeyVersion, "revision": result.Revision, "size": len(result.EncryptedBody), "resultHash": result.Execution.ResultHash})
	t.Logf("FM_CHAIN_RESULT_EVIDENCE %s", encoded)
}

func TestChainCommandResultKeyLive(t *testing.T) {
	raw := os.Getenv("FM_CHAIN_RESULT_KEY_CASE")
	if raw == "" {
		t.Skip("requires generated localnet Host encryption secret")
	}
	var input struct {
		RPC, PackageID, CapabilityID, Fingerprint, ExpectedKeyHash string
		KeyVersion                                                 uint64
	}
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		t.Fatal(err)
	}
	secret, err := hex.DecodeString(os.Getenv("FM_HOST_RESULT_ENCRYPTION_TEST_SECRET"))
	if err != nil || len(secret) != 32 {
		t.Fatal("missing generated Host encryption secret")
	}
	defer clear(secret)
	client, err := NewGRPCClient(input.RPC, "")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	resolver, err := nodecommand.NewChainAuthorityResolver(client, input.PackageID)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	grant, err := resolver.ReadResultKey(ctx, input.CapabilityID, input.Fingerprint, input.KeyVersion)
	if err != nil {
		t.Fatal(err)
	}
	context, err := productcrypto.CommandResultWrapContext(grant.OrganizationID, input.CapabilityID, grant.MembershipID, input.Fingerprint, input.KeyVersion)
	if err != nil {
		t.Fatal(err)
	}
	key, err := productcrypto.UnwrapResultKey(grant.WrappedKey, secret, context)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(key)
	hash := sha256.Sum256(key)
	if hex.EncodeToString(hash[:]) != input.ExpectedKeyHash {
		t.Fatal("Host result key does not match device derivative")
	}
	encoded, _ := json.Marshal(map[string]any{"capabilityId": input.CapabilityID, "fingerprint": input.Fingerprint, "keyVersion": input.KeyVersion, "hostAddress": grant.HostAddress, "wrappedSize": len(grant.WrappedKey), "unwrapped": true})
	t.Logf("FM_RESULT_KEY_EVIDENCE %s", encoded)
}
