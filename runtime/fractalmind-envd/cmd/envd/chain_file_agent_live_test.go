package main

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/block-vision/sui-go-sdk/models"
	"github.com/block-vision/sui-go-sdk/utils"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/boundedrun"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/runtimeadapter"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
)

type chainStopTrigger struct {
	*nodecommand.ChainAuthorityResolver
	count int
	stop  func(context.Context, nodecommand.ChainExecution) error
}

func (r *chainStopTrigger) LookupExecution(ctx context.Context, capability, hash string) (nodecommand.ChainExecution, bool, error) {
	r.count++
	run, found, err := r.ChainAuthorityResolver.LookupExecution(ctx, capability, hash)
	if err == nil && found && r.count == 3 {
		if err := r.stop(ctx, run); err != nil {
			return nodecommand.ChainExecution{}, false, err
		}
		return r.ChainAuthorityResolver.LookupExecution(ctx, capability, hash)
	}
	return run, found, err
}

func TestNativeChainFileAgentLive(t *testing.T) {
	raw := os.Getenv("FM_CHAIN_FILE_AGENT_CASE")
	if raw == "" {
		t.Skip("isolated localnet and generated test keys required")
	}
	var input struct {
		RPC, PackageID, Workspace string
		Command, StoppedCommand   nodecommand.NodeCommand
	}
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		t.Fatal(err)
	}
	decode := func(name string) []byte {
		value, err := hex.DecodeString(os.Getenv(name))
		if err != nil || len(value) != 32 {
			t.Fatalf("generated test key %s required", name)
		}
		t.Cleanup(func() { clear(value) })
		return value
	}
	seed := decode("FM_CHAIN_EXECUTION_TEST_SEED")
	secret := decode("FM_HOST_RESULT_ENCRYPTION_TEST_SECRET")
	deviceSeed := decode("FM_CHAIN_FILE_DEVICE_TEST_SEED")
	data := append(append([]byte("FMH1"), seed...), secret...)
	defer clear(data)
	store := &fixtureHostStore{data: data}
	cfg := chainRuntimeConfig()
	cfg.SUI.RPC = input.RPC
	cfg.SUI.ProtocolPackageID = input.PackageID
	cfg.SUI.OrgID = input.Command.Target.OrganizationID
	cfg.Runtime.AdapterKind = "native-file-agent"
	cfg.Runtime.Workspaces = map[string]string{input.Command.Target.AgentID: input.Workspace}
	t.Setenv("FRACTALMIND_RUNTIME_STATE_DIR", "")
	t.Setenv("FRACTALMIND_NODE_COMMAND_AUTHORITY_FILE", "")
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	construct := func() *chainRuntimeExecutor {
		instance, err := newRuntimeCommandExecutorWithStore(cfg, store)
		if err != nil {
			t.Fatal(err)
		}
		executor := instance.(*chainRuntimeExecutor)
		t.Cleanup(func() { executor.Close() })
		return executor
	}
	first := construct()
	response, _, err := first.Execute(ctx, input.Command)
	if err != nil {
		t.Fatal(err)
	}
	if !response.OK || response.ExecutionState != "succeeded" || response.Spend == nil || !response.Spend.Known || response.Spend.Asset != "TOOL_CALLS" || response.Spend.Amount != 6 {
		t.Fatalf("native Agent result: %+v", response)
	}
	var outcome boundedrun.Outcome
	if err := json.Unmarshal(response.Result, &outcome); err != nil {
		t.Fatal(err)
	}
	if outcome.Status != "submitted" || len(outcome.Evidence) != 2 {
		t.Fatal("native goals not submitted for review")
	}
	for _, evidence := range outcome.Evidence {
		if !evidence.Verified || evidence.ExpectedHash != evidence.ObservedHash {
			t.Fatal("unmeasured goal")
		}
	}
	readPayload := func(command nodecommand.NodeCommand) boundedrun.FileTask {
		var payload struct {
			Task string `json:"task"`
		}
		if err := json.Unmarshal(command.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		task, err := boundedrun.ParseFileTask(payload.Task)
		if err != nil {
			t.Fatal(err)
		}
		return task
	}
	task := readPayload(input.Command)
	for _, goal := range task.Files {
		value, err := os.ReadFile(filepath.Join(input.Workspace, goal.Path))
		if err != nil || string(value) != goal.Content {
			t.Fatal("real workspace did not attain goal")
		}
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	fresh := construct()
	duplicate, _, err := fresh.Execute(ctx, input.Command)
	if err != nil || !duplicate.Duplicate || duplicate.ExecutionState != "succeeded" || string(duplicate.Result) != string(response.Result) {
		t.Fatal("factory restart did not restore native result")
	}
	resolver, err := nodecommand.NewChainAuthorityResolver(fresh.rpc, input.PackageID)
	if err != nil {
		t.Fatal(err)
	}
	devicePrivate := ed25519.NewKeyFromSeed(deviceSeed)
	defer clear(devicePrivate)
	device := &sui.Keypair{Private: devicePrivate, Public: devicePrivate.Public().(ed25519.PublicKey)}
	var stopDigest string
	trigger := &chainStopTrigger{ChainAuthorityResolver: resolver}
	trigger.stop = func(ctx context.Context, run nodecommand.ChainExecution) error {
		args := []interface{}{sui.ObjectArgument(run.ID), sui.ObjectArgument(run.CapabilityID), sui.ObjectArgument(run.Target.OrganizationID), sui.ObjectArgument(run.HumanID), sui.ObjectArgument(run.GrantID), sui.ObjectArgument("0x6")}
		module, function := "node_execution", "request_stop_with_budget"
		if run.Contract != nil {
			module, function = "okr", "request_stop"
			args = append([]interface{}{sui.ObjectArgument(run.Contract.ID)}, args...)
		}
		tx, err := fresh.rpc.MoveCall(ctx, models.MoveCallRequest{Signer: device.Address(), PackageObjectId: input.PackageID, Module: module, Function: function, Arguments: args, TypeArguments: []interface{}{}, GasBudget: "100000000"})
		if err != nil {
			return err
		}
		digest, err := utils.GetTxDigest(tx.TxBytes)
		if err != nil {
			return err
		}
		result, err := fresh.rpc.SignAndExecuteTransactionBlock(ctx, models.SignAndExecuteTransactionBlockRequest{TxnMetaData: tx, PriKey: device.Private, Options: models.SuiTransactionBlockOptions{ShowEffects: true}, RequestType: "WaitForLocalExecution"})
		if err != nil {
			return err
		}
		if result.Digest != digest || result.Effects.Status.Status != "success" {
			return errors.New("stop transaction not confirmed")
		}
		stopDigest = digest
		// Wait only for the confirmed stop's ledger visibility; never resend it.
		limit, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		for {
			current, found, err := resolver.LookupExecution(limit, run.CapabilityID, run.Fingerprint)
			if err == nil && found && current.StopRequested {
				return nil
			}
			select {
			case <-limit.Done():
				return limit.Err()
			case <-time.After(50 * time.Millisecond):
			}
		}
	}
	adapter, err := runtimeadapter.BoundedFileAgent(trigger, cfg.Runtime.Workspaces, runtimeadapter.ObservationAgentManager("must-not-run"))
	if err != nil {
		t.Fatal(err)
	}
	// Only the test's stop trigger wraps reads; authority/checkpoints/results
	// and the stop transaction still use the actual local Sui network.
	stopping, err := newChainRuntimeExecutor(cfg, fresh.keys, fresh.rpc, adapter)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(stopping.signer.Private)
	stopped, _, err := stopping.Execute(ctx, input.StoppedCommand)
	if err != nil {
		t.Fatal(err)
	}
	if stopped.OK || stopped.ExecutionState != "cancelled" || stopped.Spend == nil || !stopped.Spend.Known || stopped.Spend.Amount != 1 || stopDigest == "" {
		t.Fatalf("physical native stop: %+v", stopped)
	}
	stopTask := readPayload(input.StoppedCommand)
	if _, err := os.Stat(filepath.Join(input.Workspace, stopTask.Files[1].Path)); !os.IsNotExist(err) {
		t.Fatal("a goal ran after chain stop")
	}
	resultIDs := []string{}
	for _, command := range []nodecommand.NodeCommand{input.Command, input.StoppedCommand} {
		bytes, err := command.SigningBytes()
		if err != nil {
			t.Fatal(err)
		}
		result, found, err := resolver.ReadExecutionResult(ctx, command.Capability.ID, sha256Hex(bytes))
		if err != nil || !found {
			t.Fatal("encrypted native result missing")
		}
		resultIDs = append(resultIDs, result.ID)
	}
	evidence, _ := json.Marshal(map[string]any{"recordIds": resultIDs, "successDigest": response.TransactionDigest, "stopRequestDigest": stopDigest, "cancelledResultDigest": stopped.TransactionDigest, "toolCallsSpent": []uint64{6, 1}, "actualWorkspaceWrites": true, "measurementsFromHostReader": true, "factoryRestartDuplicate": true, "physicalStopBeforeNextGoal": true, "nativeFileGoalsOnly": true, "modelPlanningVerified": false, "cloudHostVerified": false})
	t.Logf("FM_NATIVE_FILE_AGENT_EVIDENCE %s", evidence)
}

// Runs a real approved KR through the production factory. The workspace is
// retained across processes, while authority and result recovery use the chain.
func TestNativeChainSingleKrLive(t *testing.T) {
	raw := os.Getenv("FM_CHAIN_SINGLE_KR_CASE")
	if raw == "" {
		t.Skip("isolated localnet and generated test keys required")
	}
	var input struct {
		RPC, PackageID, Workspace string
		Command                   nodecommand.NodeCommand
		ExpectedToolCalls         uint64
	}
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		t.Fatal(err)
	}
	decode := func(name string) []byte {
		value, err := hex.DecodeString(os.Getenv(name))
		if err != nil || len(value) != 32 {
			t.Fatalf("generated key %s required", name)
		}
		t.Cleanup(func() { clear(value) })
		return value
	}
	seed := decode("FM_CHAIN_EXECUTION_TEST_SEED")
	secret := decode("FM_HOST_RESULT_ENCRYPTION_TEST_SECRET")
	data := append(append([]byte("FMH1"), seed...), secret...)
	defer clear(data)
	store := &fixtureHostStore{data: data}
	cfg := chainRuntimeConfig()
	cfg.SUI.RPC = input.RPC
	cfg.SUI.ProtocolPackageID = input.PackageID
	cfg.SUI.OrgID = input.Command.Target.OrganizationID
	cfg.Runtime.AdapterKind = "native-file-agent"
	cfg.Runtime.Workspaces = map[string]string{input.Command.Target.AgentID: input.Workspace}
	t.Setenv("FRACTALMIND_RUNTIME_STATE_DIR", "")
	t.Setenv("FRACTALMIND_NODE_COMMAND_AUTHORITY_FILE", "")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	construct := func() *chainRuntimeExecutor {
		instance, err := newRuntimeCommandExecutorWithStore(cfg, store)
		if err != nil {
			t.Fatal(err)
		}
		executor := instance.(*chainRuntimeExecutor)
		t.Cleanup(func() { executor.Close() })
		return executor
	}
	first := construct()
	response, _, err := first.Execute(ctx, input.Command)
	if err != nil {
		t.Fatal(err)
	}
	if !response.OK || response.ExecutionState != "succeeded" || response.Spend == nil || !response.Spend.Known || response.Spend.Asset != "TOOL_CALLS" || uint64(response.Spend.Amount) != input.ExpectedToolCalls {
		t.Fatalf("KR result: %+v", response)
	}
	var outcome boundedrun.Outcome
	if err := json.Unmarshal(response.Result, &outcome); err != nil {
		t.Fatal(err)
	}
	if outcome.Status != "submitted" || len(outcome.Evidence) != 1 || !outcome.Evidence[0].Verified || outcome.Evidence[0].ExpectedHash != outcome.Evidence[0].ObservedHash {
		t.Fatal("KR evidence is not a measured file outcome")
	}
	var payload struct {
		Task string `json:"task"`
	}
	if err := json.Unmarshal(input.Command.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	task, err := boundedrun.ParseFileTask(payload.Task)
	if err != nil || len(task.Files) != 1 {
		t.Fatal("one declared KR file required")
	}
	actual, err := os.ReadFile(filepath.Join(input.Workspace, task.Files[0].Path))
	if err != nil || string(actual) != task.Files[0].Content {
		t.Fatal("actual KR workspace outcome differs")
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	fresh := construct()
	duplicate, _, err := fresh.Execute(ctx, input.Command)
	if err != nil || !duplicate.Duplicate || string(duplicate.Result) != string(response.Result) {
		t.Fatal("fresh executor failed to restore KR result")
	}
	resolver, err := nodecommand.NewChainAuthorityResolver(fresh.rpc, input.PackageID)
	if err != nil {
		t.Fatal(err)
	}
	signing, err := input.Command.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	result, found, err := resolver.ReadExecutionResult(ctx, input.Command.Capability.ID, sha256Hex(signing))
	if err != nil || !found || result.Execution.Contract == nil {
		t.Fatal("OKR-bound encrypted KR result missing")
	}
	evidence, _ := json.Marshal(map[string]any{"recordId": result.ID, "executionId": result.Execution.ID, "contract": result.Execution.Contract, "resultDigest": response.TransactionDigest, "toolCallsSpent": input.ExpectedToolCalls, "actualFileOutcome": true, "hostReaderMeasurement": true, "factoryRestartDuplicate": true, "nativeFileGoalsOnly": true, "modelPlanningVerified": false})
	t.Logf("FM_SINGLE_KR_EVIDENCE %s", evidence)
}
