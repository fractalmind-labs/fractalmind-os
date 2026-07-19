package runtimeadapter

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/fractalmind-ai/fractalmind-envd/internal/nodecommand"
)

type stateDirFakeRunner struct {
	response Response
	err      error
	calls    int
}

func (f *stateDirFakeRunner) run(_ context.Context, request Request) (Response, error) {
	f.calls++
	if f.err != nil {
		return Response{}, f.err
	}
	response := f.response
	response.CommandID = request.CommandID
	response.Operation = request.Operation
	return response, nil
}

func TestNewExecutorWithStateDirPersistsRestartedDuplicate(t *testing.T) {
	dir := t.TempDir()
	validator := testStateDirValidator()
	executor, err := NewExecutorWithStateDir(validator, &stateDirFakeRunner{
		response: Response{
			SchemaVersion: SchemaVersion,
			Adapter:       AdapterName,
			OK:            true,
			ObservedAt:    "2026-07-19T00:00:00Z",
			Result:        json.RawMessage(`{"ok":true}`),
		},
	}, dir)
	if err != nil {
		t.Fatalf("NewExecutorWithStateDir: %v", err)
	}
	executor.now = testNow

	command := runtimeCommand("status", "lifecycle", `{}`)
	firstResponse, firstEvent, err := executor.Execute(context.Background(), command)
	if err != nil || !firstResponse.OK {
		t.Fatalf("first Execute: response=%+v err=%v", firstResponse, err)
	}

	// Recreate the executor to simulate an envd restart.
	restoredExecutor, err := NewExecutorWithStateDir(validator, &stateDirFakeRunner{}, dir)
	if err != nil {
		t.Fatalf("restore executor: %v", err)
	}
	restoredExecutor.now = testNow

	secondResponse, secondEvent, err := restoredExecutor.Execute(context.Background(), command)
	if err != nil {
		t.Fatalf("restart duplicate Execute: %v", err)
	}
	if !secondResponse.Duplicate {
		t.Fatalf("restart duplicate response missing duplicate flag: %+v", secondResponse)
	}
	if secondEvent != firstEvent {
		t.Fatalf("persisted event changed: first=%+v second=%+v", firstEvent, secondEvent)
	}
}

func TestNewExecutorWithStateDirCreatesDirectory(t *testing.T) {
	dir := t.TempDir()
	stateDir := dir + "/nested/runtime-state"
	executor, err := NewExecutorWithStateDir(testStateDirValidator(), &stateDirFakeRunner{}, stateDir)
	if err != nil {
		t.Fatalf("NewExecutorWithStateDir: %v", err)
	}
	if executor == nil {
		t.Fatal("executor is nil")
	}
	if _, err := os.Stat(stateDir); err != nil {
		t.Fatalf("state dir not created: %v", err)
	}
}

func testStateDirValidator() *nodecommand.Validator {
	now := testNow()
	state := nodecommand.CapabilityState{
		ID:                     "cap-1",
		Target:                 nodecommand.Target{OrganizationID: "org-1", NodeID: "node-1"},
		AuthorizedSigners:      []string{"signer-1"},
		Actions:                []string{"status"},
		Scopes:                 []string{"lifecycle"},
		ExpiresAtMS:            now.Add(time.Minute).UnixMilli(),
		RevocationVersion:      7,
		ReservationScope:       nodecommand.ReservationScopeNode,
		RemainingUses:          uint64Ptr(1),
		CheckpointObservedAtMS: now.UnixMilli(),
	}
	validator := nodecommand.NewValidator(
		&allowAllStateDirVerifier{},
		nodecommand.NewMemoryAuthorityStore(state),
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
	return validator
}

type allowAllStateDirVerifier struct{}

func (allowAllStateDirVerifier) Verify(context.Context, string, []byte, string) error { return nil }

func uint64Ptr(v uint64) *uint64 { return &v }
