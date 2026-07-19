package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-ai/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-ai/fractalmind-envd/internal/runtimeadapter"
	"github.com/fractalmind-ai/fractalmind-envd/internal/ws"
)

func TestSignedCommandWithoutStateDirExecutorFailsClosed(t *testing.T) {
	t.Setenv("FRACTALMIND_RUNTIME_STATE_DIR", "")

	executor, err := newRuntimeCommandExecutorFromEnv()
	if err != nil {
		t.Fatalf("newRuntimeCommandExecutorFromEnv: %v", err)
	}
	if executor != nil {
		t.Fatal("missing FRACTALMIND_RUNTIME_STATE_DIR must not create memory-backed executor")
	}

	result := handleSignedCommand(context.Background(), `{}`, executor)
	if result["success"] != false {
		t.Fatalf("success = %v, want false", result["success"])
	}
	if result["error_code"] != "runtime_state_dir_required" {
		t.Fatalf("error_code = %v, want runtime_state_dir_required", result["error_code"])
	}
	if !strings.Contains(fmt.Sprint(result["error"]), "FRACTALMIND_RUNTIME_STATE_DIR") {
		t.Fatalf("error = %v, want state-dir guidance", result["error"])
	}
}

func TestRuntimeCommandExecutorRejectsUnusableStateDir(t *testing.T) {
	blockingFile := t.TempDir() + "/state-file"
	if err := os.WriteFile(blockingFile, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FRACTALMIND_RUNTIME_STATE_DIR", blockingFile)

	if _, err := newRuntimeCommandExecutorFromEnv(); err == nil {
		t.Fatal("unusable FRACTALMIND_RUNTIME_STATE_DIR was accepted")
	}
}

func TestHandleCommandSignedCommandReusesPriorSuccessAfterRestart(t *testing.T) {
	stateDir := t.TempDir()
	callCount := stateDir + "/calls"
	now := fixedRuntimeNow()
	authority := nodecommand.NewMemoryAuthorityStore(validRuntimeState(now))
	command := validRuntimeCommand(now, "cmd-success", "nonce-success", "idem-success")
	rawCommand := mustJSON(t, command)

	firstExecutor := newTestPersistentRuntimeExecutor(t, stateDir, authority, "success", callCount, now)
	first := handleCommand(ws.CommandPayload{Command: "signed-command", Args: rawCommand}, nil, nil, firstExecutor)
	if first["success"] != true {
		t.Fatalf("first success = %v, result=%+v", first["success"], first)
	}
	if countRuntimeAdapterCalls(t, callCount) != 1 {
		t.Fatalf("adapter calls after first execution = %d, want 1", countRuntimeAdapterCalls(t, callCount))
	}

	restartedExecutor := newTestPersistentRuntimeExecutor(t, stateDir, authority, "unexpected-success", callCount, now)
	second := handleCommand(ws.CommandPayload{Command: "signed_command", Args: rawCommand}, nil, nil, restartedExecutor)
	if second["success"] != true {
		t.Fatalf("second success = %v, result=%+v", second["success"], second)
	}
	response, ok := second["response"].(runtimeadapter.Response)
	if !ok {
		t.Fatalf("second response type = %T", second["response"])
	}
	if !response.Duplicate {
		t.Fatalf("second response duplicate = false: %+v", response)
	}
	if countRuntimeAdapterCalls(t, callCount) != 1 {
		t.Fatalf("adapter reran after restart duplicate: calls=%d", countRuntimeAdapterCalls(t, callCount))
	}
}

func TestHandleCommandSignedCommandReusesPriorFailureAfterRestart(t *testing.T) {
	stateDir := t.TempDir()
	callCount := stateDir + "/calls"
	now := fixedRuntimeNow()
	authority := nodecommand.NewMemoryAuthorityStore(validRuntimeState(now))
	command := validRuntimeCommand(now, "cmd-failure", "nonce-failure", "idem-failure")
	rawCommand := mustJSON(t, command)

	firstExecutor := newTestPersistentRuntimeExecutor(t, stateDir, authority, "fail", callCount, now)
	first := handleCommand(ws.CommandPayload{Command: "node_command", Args: rawCommand}, nil, nil, firstExecutor)
	if first["success"] != false {
		t.Fatalf("first success = %v, want false: %+v", first["success"], first)
	}
	if first["error_code"] != "operation_failed" {
		t.Fatalf("first error_code = %v, want operation_failed", first["error_code"])
	}
	if countRuntimeAdapterCalls(t, callCount) != 1 {
		t.Fatalf("adapter calls after first failure = %d, want 1", countRuntimeAdapterCalls(t, callCount))
	}

	restartedExecutor := newTestPersistentRuntimeExecutor(t, stateDir, authority, "unexpected-success", callCount, now)
	second := handleCommand(ws.CommandPayload{Command: "signed_command", Args: rawCommand}, nil, nil, restartedExecutor)
	if second["success"] != false {
		t.Fatalf("second success = %v, want false: %+v", second["success"], second)
	}
	if second["error_code"] != "operation_failed" {
		t.Fatalf("second error_code = %v, want operation_failed", second["error_code"])
	}
	response, ok := second["response"].(runtimeadapter.Response)
	if !ok {
		t.Fatalf("second response type = %T", second["response"])
	}
	if !response.Duplicate || response.Error == nil || response.Error.Code != "operation_failed" {
		t.Fatalf("second response did not reuse failed evidence: %+v", response)
	}
	if countRuntimeAdapterCalls(t, callCount) != 1 {
		t.Fatalf("adapter reran failed restart duplicate: calls=%d", countRuntimeAdapterCalls(t, callCount))
	}
}

func newTestPersistentRuntimeExecutor(
	t *testing.T,
	stateDir string,
	authority *nodecommand.MemoryAuthorityStore,
	helperMode string,
	callCount string,
	now time.Time,
) *runtimeadapter.Executor {
	t.Helper()
	t.Setenv("ENVD_RUNTIME_ADAPTER_HELPER", "1")
	t.Setenv("ENVD_RUNTIME_ADAPTER_HELPER_MODE", helperMode)
	t.Setenv("ENVD_RUNTIME_ADAPTER_CALL_COUNT", callCount)
	adapter := runtimeadapter.AgentManager(os.Args[0], "-test.run=TestEnvdRuntimeAdapterHelperProcess", "--")
	executor, err := runtimeadapter.NewExecutorWithStateDir(testRuntimeValidator(authority, now), adapter, stateDir)
	if err != nil {
		t.Fatalf("NewExecutorWithStateDir: %v", err)
	}
	return executor
}

func TestEnvdRuntimeAdapterHelperProcess(t *testing.T) {
	if os.Getenv("ENVD_RUNTIME_ADAPTER_HELPER") != "1" {
		return
	}
	countFile := os.Getenv("ENVD_RUNTIME_ADAPTER_CALL_COUNT")
	if countFile != "" {
		f, err := os.OpenFile(countFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			fmt.Fprintf(os.Stderr, "open call count: %v", err)
			os.Exit(2)
		}
		_, _ = f.WriteString("1\n")
		_ = f.Close()
	}

	var request runtimeadapter.Request
	if err := json.NewDecoder(os.Stdin).Decode(&request); err != nil {
		fmt.Fprintf(os.Stderr, "decode request: %v", err)
		os.Exit(2)
	}
	switch os.Getenv("ENVD_RUNTIME_ADAPTER_HELPER_MODE") {
	case "success", "unexpected-success":
		response := runtimeadapter.Response{
			SchemaVersion: runtimeadapter.SchemaVersion,
			Adapter:       runtimeadapter.AdapterName,
			CommandID:     request.CommandID,
			Operation:     request.Operation,
			OK:            true,
			ObservedAt:    "2026-07-19T00:00:00Z",
			Result:        json.RawMessage(`{"status":"ok"}`),
		}
		if err := json.NewEncoder(os.Stdout).Encode(response); err != nil {
			fmt.Fprintf(os.Stderr, "encode response: %v", err)
			os.Exit(2)
		}
		os.Exit(0)
	case "fail":
		fmt.Fprint(os.Stderr, "boom")
		os.Exit(2)
	default:
		fmt.Fprintf(os.Stderr, "unknown helper mode %q", os.Getenv("ENVD_RUNTIME_ADAPTER_HELPER_MODE"))
		os.Exit(2)
	}
}

func testRuntimeValidator(authority *nodecommand.MemoryAuthorityStore, now time.Time) *nodecommand.Validator {
	return nodecommand.NewValidator(
		allowAllRuntimeVerifier{},
		authority,
		nodecommand.ValidatorOptions{
			Now:                      func() time.Time { return now },
			LocalTarget:              nodecommand.Target{OrganizationID: "org-1", NodeID: "node-1"},
			LowRiskActions:           map[string]struct{}{"status": {}},
			HighRiskActions:          map[string]struct{}{},
			BudgetedActions:          map[string]struct{}{},
			MaxClockSkew:             time.Second,
			MaxCommandTTL:            time.Minute,
			MaxLowRiskCheckpointAge:  time.Minute,
			MaxHighRiskCheckpointAge: time.Second,
		},
	)
}

func validRuntimeCommand(now time.Time, commandID, nonce, idempotencyKey string) nodecommand.NodeCommand {
	payload := []byte(`{}`)
	return nodecommand.NodeCommand{
		Version:        nodecommand.ProtocolVersion,
		CommandID:      commandID,
		Signer:         "signer-1",
		Target:         nodecommand.Target{OrganizationID: "org-1", NodeID: "node-1", AgentID: "agent-1"},
		Action:         "status",
		Scope:          "lifecycle",
		Capability:     nodecommand.CapabilityRef{ID: "cap-1", RevocationVersion: 7},
		Nonce:          nonce,
		IssuedAtMS:     now.UnixMilli(),
		ExpiresAtMS:    now.Add(time.Minute).UnixMilli(),
		IdempotencyKey: idempotencyKey,
		Payload:        payload,
		PayloadHash:    nodecommand.HashPayload(payload),
		Signature:      "signature-1",
	}
}

func validRuntimeState(now time.Time) nodecommand.CapabilityState {
	remainingUses := uint64(1)
	return nodecommand.CapabilityState{
		ID:                     "cap-1",
		Target:                 nodecommand.Target{OrganizationID: "org-1", NodeID: "node-1", AgentID: "agent-1"},
		AuthorizedSigners:      []string{"signer-1"},
		Actions:                []string{"status"},
		Scopes:                 []string{"lifecycle"},
		ExpiresAtMS:            now.Add(5 * time.Minute).UnixMilli(),
		RevocationVersion:      7,
		CheckpointObservedAtMS: now.UnixMilli(),
		ReservationScope:       nodecommand.ReservationScopeNode,
		RemainingUses:          &remainingUses,
	}
}

func fixedRuntimeNow() time.Time {
	return time.UnixMilli(1784394000000).UTC()
}

func mustJSON(t *testing.T, value interface{}) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func countRuntimeAdapterCalls(t *testing.T, path string) int {
	t.Helper()
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return 0
	}
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.TrimSpace(line) != "" {
			count++
		}
	}
	return count
}

type allowAllRuntimeVerifier struct{}

func (allowAllRuntimeVerifier) Verify(context.Context, string, []byte, string) error { return nil }
