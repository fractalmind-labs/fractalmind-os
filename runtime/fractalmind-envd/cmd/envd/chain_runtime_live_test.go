package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/runtimeadapter"
)

func sha256Hex(data []byte) string { hash := sha256.Sum256(data); return hex.EncodeToString(hash[:]) }
func TestProductionObservationFixture(t *testing.T) {
	args := os.Args
	if len(args) < 3 || args[len(args)-1] != "adapter" {
		t.Skip("fixture subprocess only")
	}
	counter := args[len(args)-2]
	var request runtimeadapter.Request
	if err := json.NewDecoder(os.Stdin).Decode(&request); err != nil {
		os.Exit(2)
	}
	if request.Operation != runtimeadapter.OperationStatus {
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
	response := runtimeadapter.Response{SchemaVersion: runtimeadapter.SchemaVersion, Adapter: runtimeadapter.AdapterName, CommandID: request.CommandID, Operation: request.Operation, OK: true, ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), Result: json.RawMessage(`{"fixture":"production observation transport only"}`)}
	if err := json.NewEncoder(os.Stdout).Encode(response); err != nil {
		os.Exit(2)
	}
	os.Exit(0)
}
func TestProductionChainRuntimeLive(t *testing.T) {
	raw := os.Getenv("FM_PRODUCTION_CHAIN_RUNTIME_CASE")
	if raw == "" {
		t.Skip("requires isolated localnet generated Host keys and prepared commands")
	}
	var input struct {
		RPC, PackageID            string
		Command, ForbiddenCommand nodecommand.NodeCommand
	}
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		t.Fatal(err)
	}
	seed, err := hex.DecodeString(os.Getenv("FM_CHAIN_EXECUTION_TEST_SEED"))
	if err != nil || len(seed) != 32 {
		t.Fatal("generated Host seed required")
	}
	secret, err := hex.DecodeString(os.Getenv("FM_HOST_RESULT_ENCRYPTION_TEST_SECRET"))
	if err != nil || len(secret) != 32 {
		t.Fatal("generated Host encryption key required")
	}
	data := append([]byte("FMH1"), seed...)
	data = append(data, secret...)
	defer func() { clear(seed); clear(secret); clear(data) }()
	store := &fixtureHostStore{data: data}
	cfg := chainRuntimeConfig()
	cfg.SUI.RPC = input.RPC
	cfg.SUI.ProtocolPackageID = input.PackageID
	cfg.SUI.OrgID = input.Command.Target.OrganizationID
	counter := filepath.Join(t.TempDir(), "adapter-calls")
	cfg.Runtime.AdapterCommand = os.Args[0]
	cfg.Runtime.AdapterArgs = []string{"-test.run=^TestProductionObservationFixture$", "--", counter}
	t.Setenv("FRACTALMIND_RUNTIME_STATE_DIR", "")
	t.Setenv("FRACTALMIND_NODE_COMMAND_AUTHORITY_FILE", "")
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	construct := func() *chainRuntimeExecutor {
		instance, err := newRuntimeCommandExecutorWithStore(cfg, store)
		if err != nil {
			t.Fatal(err)
		}
		executor, ok := instance.(*chainRuntimeExecutor)
		if !ok {
			t.Fatal("production did not choose chain runtime")
		}
		t.Cleanup(func() { executor.Close() })
		return executor
	}
	first := construct()
	if _, _, err := first.Execute(ctx, input.ForbiddenCommand); nodecommand.CodeOf(err) != nodecommand.CodeRuntimeUnsupported {
		t.Fatalf("unbounded adapter acquired control: %v", err)
	}
	response, _, err := first.Execute(ctx, input.Command)
	if err != nil {
		t.Fatal(err)
	}
	if !response.OK || response.ExecutionState != "succeeded" || response.TransactionDigest == "" {
		t.Fatal("production result not persisted")
	}
	address := first.signer.Address()
	control, err := first.controlKeypair()
	if err != nil {
		t.Fatal(err)
	}
	if control.Address() != address {
		t.Fatal("control and execution identities differ")
	}
	clear(control.Private)
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	second := construct()
	duplicate, _, err := second.Execute(ctx, input.Command)
	if err != nil {
		t.Fatal(err)
	}
	calls, err := os.ReadFile(counter)
	if err != nil {
		t.Fatal(err)
	}
	if string(calls) != input.Command.CommandID+"\n" || !duplicate.Duplicate || duplicate.ExecutionState != "succeeded" || string(duplicate.Result) != string(response.Result) || store.creates != 0 || second.signer.Address() != address {
		t.Fatal("factory restart invoked adapter or replaced Host identity")
	}
	resolver, err := nodecommand.NewChainAuthorityResolver(second.rpc, input.PackageID)
	if err != nil {
		t.Fatal(err)
	}
	commandBytes, err := input.Command.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	fingerprint := sha256Hex(commandBytes)
	result, found, err := resolver.ReadExecutionResult(ctx, input.Command.Capability.ID, fingerprint)
	if err != nil || !found {
		t.Fatalf("read result: %v", err)
	}
	forbiddenBytes, err := input.ForbiddenCommand.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	forbidden, found, err := resolver.LookupExecution(ctx, input.ForbiddenCommand.Capability.ID, sha256Hex(forbiddenBytes))
	if err != nil || !found || forbidden.State != 0 || forbidden.AttemptID != "" {
		t.Fatal("unsupported control changed queued checkpoint")
	}
	evidence, _ := json.Marshal(map[string]any{"recordId": result.ID, "executionId": result.Execution.ID, "transactionDigest": response.TransactionDigest, "adapterInvocations": 1, "factoryRestartDuplicate": true, "identityStable": true, "controlIdentityMatches": true, "forbiddenControlRemainsQueued": true, "fileAuthoritySelected": false, "localResultsCreated": false, "observationFixtureOnly": true, "secureStoreInjectedForIsolatedTest": true})
	t.Logf("FM_PRODUCTION_FACTORY_EVIDENCE %s", evidence)
}
