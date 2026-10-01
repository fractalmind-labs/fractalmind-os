package runtimeadapter

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
)

type commandStoreProbe struct {
	preflightErr                error
	saves, confirms, preflights int
}

func (s *commandStoreProbe) Preflight(context.Context, nodecommand.NodeCommand) error {
	s.preflights++
	return s.preflightErr
}

func TestObservationAdapterRejectsControlBeforeAnyChainClaim(t *testing.T) {
	for _, action := range []string{"assign", "start", "stop", "direct.message"} {
		store := &commandStoreProbe{}
		executor, err := NewExecutorWithCommandStore(testValidator(), ObservationAgentManager("must-not-run"), store)
		if err != nil {
			t.Fatal(err)
		}
		_, _, err = executor.Execute(context.Background(), runtimeCommand(action, "lifecycle", `{"task":"must not execute"}`))
		if nodecommand.CodeOf(err) != nodecommand.CodeRuntimeUnsupported || store.preflights != 0 || store.confirms != 0 || store.saves != 0 {
			t.Fatalf("unsupported action reached authority/runtime: action=%s err=%v store=%+v", action, err, store)
		}
	}
}
func TestConcurrentObservationControlRejectionsNeverReserve(t *testing.T) {
	store := &commandStoreProbe{}
	executor, err := NewExecutorWithCommandStore(testValidator(), ObservationAgentManager("must-not-run"), store)
	if err != nil {
		t.Fatal(err)
	}
	command := runtimeCommand("assign", "lifecycle", `{"task":"never execute"}`)
	var group sync.WaitGroup
	for range 32 {
		group.Add(1)
		go func() {
			defer group.Done()
			_, _, err := executor.Execute(context.Background(), command)
			if nodecommand.CodeOf(err) != nodecommand.CodeRuntimeUnsupported {
				t.Errorf("concurrent request acquired execution: %v", err)
			}
		}()
	}
	group.Wait()
	if store.preflights != 0 || store.saves != 0 || store.confirms != 0 {
		t.Fatal("unsupported concurrency reached chain state")
	}
}
func (s *commandStoreProbe) ConfirmStart(context.Context, nodecommand.NodeCommand, *nodecommand.ChainExecution) error {
	s.confirms++
	return nil
}
func (s *commandStoreProbe) LoadCommand(context.Context, nodecommand.NodeCommand) (ExecutionRecord, bool, error) {
	return ExecutionRecord{}, false, nil
}
func (s *commandStoreProbe) SaveCommand(_ context.Context, _ nodecommand.NodeCommand, _ *nodecommand.ChainExecution, record ExecutionRecord) (ExecutionRecord, error) {
	s.saves++
	return record, nil
}

func TestChainResultExecutorCannotFallbackToLocalAuthority(t *testing.T) {
	store := &commandStoreProbe{}
	runner := &fakeRunner{}
	executor, err := NewExecutorWithCommandStore(testValidator(), runner, store)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = executor.Execute(context.Background(), runtimeCommand("status", "lifecycle", `{}`))
	if nodecommand.CodeOf(err) != nodecommand.CodeUnauthorized || runner.calls != 0 || store.saves != 0 || store.confirms != 0 {
		t.Fatalf("local authority allowed chain execution: err=%v runner=%d store=%+v", err, runner.calls, store)
	}
}

func TestMissingResultKeyStopsBeforeAdapterAndReservation(t *testing.T) {
	store := &commandStoreProbe{preflightErr: errors.New("result key unavailable")}
	runner := &fakeRunner{}
	validator := testValidator()
	executor, err := NewExecutorWithCommandStore(validator, runner, store)
	if err != nil {
		t.Fatal(err)
	}
	command := runtimeCommand("status", "lifecycle", `{}`)
	if _, _, err = executor.Execute(context.Background(), command); err == nil || runner.calls != 0 {
		t.Fatalf("missing key invoked adapter: %v", err)
	}
	// Preflight did not consume the authorization: a normal executor can still
	// validate this exact command once after the local key problem is corrected.
	runner.response = Response{SchemaVersion: SchemaVersion, Adapter: AdapterName, CommandID: command.CommandID, Operation: OperationStatus, OK: true, ObservedAt: "2026-09-30T00:00:00Z"}
	if _, _, err = NewExecutor(validator, runner).Execute(context.Background(), command); err != nil || runner.calls != 1 {
		t.Fatalf("preflight consumed reservation: %v", err)
	}
}

func TestExecutionKeysSeparateIntentsWithTheSameDisplayID(t *testing.T) {
	a := runtimeCommand("status", "lifecycle", `{}`)
	b := a
	b.Nonce = "different-nonce"
	b.IdempotencyKey = "different-idempotency"
	if executionKey(a) == executionKey(b) {
		t.Fatal("distinct signed intents share an in-flight/result key")
	}
}
