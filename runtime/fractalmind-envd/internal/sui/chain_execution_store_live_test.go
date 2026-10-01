package sui

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/runtimeadapter"
)

// This subprocess exercises the real sealed adapter interface, with synthetic
// output and spend. It is not a bounded Agent runtime or actual cost meter.
func TestChainRuntimeFixtureProcess(t *testing.T) {
	args := os.Args
	if len(args) < 4 || args[len(args)-1] != "adapter" {
		t.Skip("fixture child process only")
	}
	counter, mode := args[len(args)-3], args[len(args)-2]
	var request runtimeadapter.Request
	if err := json.NewDecoder(os.Stdin).Decode(&request); err != nil {
		os.Exit(2)
	}
	file, err := os.OpenFile(counter, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		os.Exit(2)
	}
	if _, err = file.WriteString(request.CommandID + "\n"); err != nil {
		os.Exit(2)
	}
	if err = file.Close(); err != nil {
		os.Exit(2)
	}
	result, _ := json.Marshal(map[string]string{"fixture": "chain result transport only", "payload": strings.Repeat("x", 32000)})
	response := runtimeadapter.Response{SchemaVersion: runtimeadapter.SchemaVersion, Adapter: runtimeadapter.AdapterName, CommandID: request.CommandID, Operation: request.Operation, OK: true, ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), Result: result}
	if mode == "known" {
		response.Spend = &runtimeadapter.Spend{Asset: "MIST", Amount: 3, Known: true}
	}
	if err := json.NewEncoder(os.Stdout).Encode(response); err != nil {
		os.Exit(2)
	}
	os.Exit(0)
}

func TestChainRuntimeResultStoreLive(t *testing.T) {
	raw := os.Getenv("FM_CHAIN_RUNTIME_STORE_CASE")
	if raw == "" {
		t.Skip("requires isolated localnet prepared command and generated Host keys")
	}
	var input struct {
		RPC, PackageID string
		Command        nodecommand.NodeCommand
		KnownSpend     bool
	}
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		t.Fatal(err)
	}
	seed, err := hex.DecodeString(os.Getenv("FM_CHAIN_EXECUTION_TEST_SEED"))
	if err != nil || len(seed) != 32 {
		t.Fatal("missing generated Host signing seed")
	}
	secret, err := hex.DecodeString(os.Getenv("FM_HOST_RESULT_ENCRYPTION_TEST_SECRET"))
	if err != nil || len(secret) != 32 {
		t.Fatal("missing generated Host encryption secret")
	}
	private := ed25519.NewKeyFromSeed(seed)
	defer func() { clear(seed); clear(secret); clear(private) }()
	signer := &Keypair{Private: private, Public: private.Public().(ed25519.PublicKey)}
	client, err := NewGRPCClient(input.RPC, "")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	counter := filepath.Join(t.TempDir(), "adapter-calls")
	mode := "unknown"
	if input.KnownSpend {
		mode = "known"
	}
	adapter := runtimeadapter.AgentManager(os.Args[0], "-test.run=^TestChainRuntimeFixtureProcess$", "--", counter, mode)
	makeExecutor := func() *runtimeadapter.Executor {
		resolver, err := nodecommand.NewChainAuthorityResolver(client, input.PackageID)
		if err != nil {
			t.Fatal(err)
		}
		backend, err := NewChainReservations(resolver, client, signer, input.PackageID)
		if err != nil {
			t.Fatal(err)
		}
		authority, err := nodecommand.NewChainAuthorityStore(resolver, backend)
		if err != nil {
			t.Fatal(err)
		}
		validator := nodecommand.NewValidator(nodecommand.Ed25519Verifier{}, authority, nodecommand.ValidatorOptions{LocalTarget: input.Command.Target, HighRiskActions: map[string]struct{}{"assign": {}}, BudgetedActions: map[string]struct{}{"assign": {}}})
		results, err := NewChainExecutionStore(resolver, client, signer, input.PackageID, func(context.Context) ([]byte, error) { return append([]byte(nil), secret...), nil })
		if err != nil {
			t.Fatal(err)
		}
		executor, err := runtimeadapter.NewExecutorWithCommandStore(validator, adapter, results)
		if err != nil {
			t.Fatal(err)
		}
		return executor
	}
	response, _, err := makeExecutor().Execute(ctx, input.Command)
	if err != nil {
		var rejection *nodecommand.RejectionError
		if errors.As(err, &rejection) {
			t.Logf("chain rejection cause: %v", rejection.Cause)
		}
		t.Fatalf("execute: %v", err)
	}
	expected := "needs_confirmation"
	if input.KnownSpend {
		expected = "succeeded"
	}
	if !response.OK || response.Duplicate || response.ExecutionState != expected || response.TransactionDigest == "" || response.RequiresConfirmation == input.KnownSpend {
		t.Fatalf("response=%+v", response)
	}
	duplicate, _, err := makeExecutor().Execute(ctx, input.Command)
	if err != nil {
		t.Fatal(err)
	}
	calls, err := os.ReadFile(counter)
	if err != nil {
		t.Fatal(err)
	}
	if string(calls) != input.Command.CommandID+"\n" || !duplicate.Duplicate || duplicate.ExecutionState != expected || string(duplicate.Result) != string(response.Result) {
		t.Fatal("fresh executor failed to restore exact chain result without invoking adapter")
	}
	resolver, err := nodecommand.NewChainAuthorityResolver(client, input.PackageID)
	if err != nil {
		t.Fatal(err)
	}
	reservation, err := commandReservation(input.Command)
	if err != nil {
		t.Fatal(err)
	}
	result, found, err := resolver.ReadExecutionResult(ctx, input.Command.Capability.ID, reservation.Fingerprint)
	if err != nil || !found {
		t.Fatalf("read result: found=%t err=%v", found, err)
	}
	if input.Command.Budget == nil {
		t.Fatal("fixture command budget required")
	}
	spent, reserved := nodecommand.Uint64String(0), input.Command.Budget.Amount
	if input.KnownSpend {
		spent, reserved = 3, 0
	}
	if result.Execution.BudgetSpent != spent || result.Execution.BudgetReserved != reserved || len(result.EncryptedBody) < 32000 {
		t.Fatal("chain budget or large ciphertext mismatch")
	}
	evidence, _ := json.Marshal(map[string]any{"commandId": input.Command.CommandID, "executionId": result.Execution.ID, "recordId": result.ID, "transactionDigest": response.TransactionDigest, "state": expected, "spent": spent, "reserved": reserved, "ciphertextSize": len(result.EncryptedBody), "adapterInvocations": 1, "freshExecutorDuplicate": true, "fixtureOnly": true})
	t.Logf("FM_RUNTIME_STORE_EVIDENCE %s", evidence)
}
