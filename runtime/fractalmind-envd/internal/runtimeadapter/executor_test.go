package runtimeadapter

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/fractalmind-ai/fractalmind-envd/internal/nodecommand"
)

type fakeRunner struct {
	mu       sync.Mutex
	calls    int
	response Response
	err      error
	started  chan struct{}
	release  chan struct{}
}

func (f *fakeRunner) run(_ context.Context, request Request) (Response, error) {
	f.mu.Lock()
	f.calls++
	started := f.started
	release := f.release
	f.mu.Unlock()
	if started != nil {
		select {
		case started <- struct{}{}:
		default:
		}
	}
	if release != nil {
		<-release
	}
	if f.err != nil {
		return Response{}, f.err
	}
	response := f.response
	response.CommandID = request.CommandID
	response.Operation = request.Operation
	return response, nil
}

func (f *fakeRunner) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func TestExecutorMapsAuthorizedCommandAndCachesDuplicate(t *testing.T) {
	runner := &fakeRunner{response: Response{
		SchemaVersion: SchemaVersion,
		Adapter:       AdapterName,
		OK:            true,
		ObservedAt:    "2026-07-19T00:00:00Z",
		Result:        json.RawMessage(`{"availability":"available"}`),
	}}
	executor := NewExecutor(testValidator(), runner)
	executor.now = func() time.Time { return time.UnixMilli(1234) }
	command := runtimeCommand("status", "lifecycle", `{}`)

	response, event, err := executor.Execute(context.Background(), command)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !response.OK || event.ResultCode != "runtime_ok" || event.OccurredAtMS != 1234 {
		t.Fatalf("unexpected result: response=%+v event=%+v", response, event)
	}
	duplicate, duplicateEvent, err := executor.Execute(context.Background(), command)
	if err != nil {
		t.Fatalf("duplicate Execute: %v", err)
	}
	if runner.callCount() != 1 || !duplicate.Duplicate || duplicateEvent.ResultHash != event.ResultHash {
		t.Fatalf("duplicate executed again: calls=%d response=%+v event=%+v", runner.callCount(), duplicate, duplicateEvent)
	}
}

func TestExecutorValidatesBeforeRunning(t *testing.T) {
	runner := &fakeRunner{}
	executor := NewExecutor(testValidator(), runner)
	command := runtimeCommand("status", "lifecycle", `{}`)
	command.Signer = "unauthorized-signer"

	if _, _, err := executor.Execute(context.Background(), command); nodecommand.CodeOf(err) != nodecommand.CodeUnauthorized {
		t.Fatalf("code=%q err=%v", nodecommand.CodeOf(err), err)
	}
	if runner.callCount() != 0 {
		t.Fatalf("unauthorized command reached runner: %d", runner.callCount())
	}
}

func TestExecutorSingleflightsConcurrentDuplicate(t *testing.T) {
	runner := &fakeRunner{
		response: Response{
			SchemaVersion: SchemaVersion,
			Adapter:       AdapterName,
			OK:            true,
			ObservedAt:    "2026-07-19T00:00:00Z",
			Result:        json.RawMessage(`{"ok":true}`),
		},
		started: make(chan struct{}, 1),
		release: make(chan struct{}),
	}
	executor := NewExecutor(testValidator(), runner)
	command := runtimeCommand("start", "lifecycle", `{"restore":true}`)

	const callers = 16
	results := make(chan Response, callers)
	errs := make(chan error, callers)
	for range callers {
		go func() {
			response, _, err := executor.Execute(context.Background(), command)
			results <- response
			errs <- err
		}()
	}
	select {
	case <-runner.started:
	case <-time.After(time.Second):
		t.Fatal("runner did not start")
	}
	close(runner.release)

	duplicates := 0
	for range callers {
		if err := <-errs; err != nil {
			t.Fatalf("concurrent Execute: %v", err)
		}
		if (<-results).Duplicate {
			duplicates++
		}
	}
	if runner.callCount() != 1 {
		t.Fatalf("runner calls=%d, want 1", runner.callCount())
	}
	if duplicates != callers-1 {
		t.Fatalf("duplicate responses=%d, want %d", duplicates, callers-1)
	}
}

func TestExecutorCacheIsNamespacedBySignerAndCapability(t *testing.T) {
	runner := &fakeRunner{response: Response{
		SchemaVersion: SchemaVersion,
		Adapter:       AdapterName,
		OK:            true,
		ObservedAt:    "2026-07-19T00:00:00Z",
		Result:        json.RawMessage(`{"ok":true}`),
	}}
	executor := NewExecutor(testValidator(), runner)
	first := runtimeCommand("status", "lifecycle", `{}`)
	first.Signer = "signer-1"
	first.Capability.ID = "cap-1"
	second := first
	second.Signer = "signer-2"
	second.Capability.ID = "cap-2"

	if _, _, err := executor.Execute(context.Background(), first); err != nil {
		t.Fatal(err)
	}
	if _, _, err := executor.Execute(context.Background(), second); err != nil {
		t.Fatal(err)
	}
	if _, _, err := executor.Execute(context.Background(), first); err != nil {
		t.Fatal(err)
	}
	if runner.callCount() != 2 {
		t.Fatalf("runner calls = %d, want 2", runner.callCount())
	}
}

func TestEventHashIgnoresReplayMetadata(t *testing.T) {
	executor := NewExecutor(nil, &fakeRunner{})
	executor.now = func() time.Time { return time.UnixMilli(1234) }
	command := runtimeCommand("status", "lifecycle", `{}`)
	base := Response{
		SchemaVersion: SchemaVersion,
		Adapter:       AdapterName,
		CommandID:     command.CommandID,
		Operation:     OperationStatus,
		OK:            true,
		ObservedAt:    "2026-07-19T00:00:00Z",
		Result:        json.RawMessage(`{"ok":true}`),
	}
	first, err := executor.event(command, base)
	if err != nil {
		t.Fatal(err)
	}
	base.Duplicate = true
	base.ObservedAt = "2026-07-19T01:00:00Z"
	second, err := executor.event(command, base)
	if err != nil {
		t.Fatal(err)
	}
	if first.ResultHash != second.ResultHash {
		t.Fatalf("result hash drifted: %s != %s", first.ResultHash, second.ResultHash)
	}
}

func TestExecutorDoesNotWidenScopeOrAction(t *testing.T) {
	commands := []nodecommand.NodeCommand{
		runtimeCommand("start", "lifecycle", `{"working_dir":"/tmp"}`),
		runtimeCommand("assign", "lifecycle", `{"task_file":"/etc/passwd"}`),
		runtimeCommand("shell", "lifecycle", `{}`),
		runtimeCommand("status", "lifecycle", `{}`),
		runtimeCommand("health", "lifecycle", `{}`),
	}
	commands[3].Target.AgentID = ""
	commands[4].Target.AgentID = "agent-1"
	for _, command := range commands {
		runner := &fakeRunner{}
		_, _, err := NewExecutor(testValidator(), runner).Execute(context.Background(), command)
		if err == nil {
			t.Fatalf("command %+v was accepted", command)
		}
		if runner.callCount() != 0 {
			t.Fatalf("adapter called for rejected command: %d", runner.callCount())
		}
	}
}

type requestCapturingRunner struct {
	request Request
}

func (r *requestCapturingRunner) run(_ context.Context, request Request) (Response, error) {
	r.request = request
	return Response{
		SchemaVersion: SchemaVersion,
		Adapter:       AdapterName,
		CommandID:     request.CommandID,
		Operation:     request.Operation,
		OK:            true,
		ObservedAt:    "2026-07-19T00:00:00Z",
		Result:        json.RawMessage(`{"ok":true}`),
	}, nil
}

func TestExecutorBuildsTypedRequests(t *testing.T) {
	commands := []nodecommand.NodeCommand{
		runtimeCommand("start", "lifecycle", `{"restore":false}`),
		runtimeCommand("assign", "lifecycle", `{"task":"inspect status"}`),
		runtimeCommand("logs", "observe", `{"lines":25}`),
	}
	for _, command := range commands {
		t.Run(command.Action, func(t *testing.T) {
			runner := &requestCapturingRunner{}
			response, _, err := NewExecutor(testValidator(), runner).Execute(context.Background(), command)
			if err != nil || !response.OK {
				t.Fatalf("Execute: response=%+v err=%v", response, err)
			}
			switch command.Action {
			case "start":
				if runner.request.Params == nil || runner.request.Params.Restore == nil || *runner.request.Params.Restore {
					t.Fatalf("unexpected start params: %+v", runner.request.Params)
				}
			case "assign":
				if runner.request.Params == nil || runner.request.Params.Task != "inspect status" {
					t.Fatalf("unexpected assign params: %+v", runner.request.Params)
				}
			case "logs":
				if runner.request.Params == nil || runner.request.Params.Lines == nil || *runner.request.Params.Lines != 25 || runner.request.Params.Follow == nil || *runner.request.Params.Follow {
					t.Fatalf("unexpected logs params: %+v", runner.request.Params)
				}
			}
		})
	}
}

func TestResultCodeMapsAdapterError(t *testing.T) {
	got := ResultCode(Response{Error: &Error{Code: "timeout"}})
	if got != "runtime_timeout" {
		t.Fatalf("ResultCode = %q", got)
	}
}

func TestExecutorEmitsStableEventForTransportFailure(t *testing.T) {
	runner := &fakeRunner{err: runError("timeout", context.DeadlineExceeded)}
	response, event, err := NewExecutor(testValidator(), runner).Execute(context.Background(), runtimeCommand("status", "lifecycle", `{}`))
	if err == nil {
		t.Fatal("Execute returned nil error")
	}
	if response.Error == nil || response.Error.Code != "timeout" || event.ResultCode != "runtime_timeout" {
		t.Fatalf("unexpected failure evidence: response=%+v event=%+v", response, event)
	}
}

func runtimeCommand(action, scope, rawPayload string) nodecommand.NodeCommand {
	payload := json.RawMessage(rawPayload)
	now := testNow()
	return nodecommand.NodeCommand{
		Version:        nodecommand.ProtocolVersion,
		CommandID:      "cmd-1",
		Signer:         "signer-1",
		Target:         nodecommand.Target{OrganizationID: "org-1", NodeID: "node-1", AgentID: "agent-1"},
		Action:         action,
		Scope:          scope,
		IdempotencyKey: "idem-1",
		Capability:     nodecommand.CapabilityRef{ID: "cap-1", RevocationVersion: 7},
		Nonce:          "nonce-1",
		IssuedAtMS:     now.UnixMilli(),
		ExpiresAtMS:    now.Add(time.Minute).UnixMilli(),
		Payload:        payload,
		PayloadHash:    nodecommand.HashPayload(payload),
		Signature:      "signature-1",
	}
}

type signatureVerifierFunc func(context.Context, string, []byte, string) error

func (f signatureVerifierFunc) Verify(ctx context.Context, signer string, payload []byte, signature string) error {
	return f(ctx, signer, payload, signature)
}

func testValidator() *nodecommand.Validator {
	now := testNow()
	remaining := uint64(1000)
	actions := make([]string, 0, len(actionOperations))
	lowRisk := make(map[string]struct{}, len(actionOperations))
	for action := range actionOperations {
		actions = append(actions, action)
		lowRisk[action] = struct{}{}
	}
	state := nodecommand.CapabilityState{
		ID:                     "cap-1",
		Target:                 nodecommand.Target{OrganizationID: "org-1", NodeID: "node-1"},
		AuthorizedSigners:      []string{"signer-1", "signer-2"},
		Actions:                actions,
		Scopes:                 []string{"lifecycle", "observe"},
		ExpiresAtMS:            now.Add(5 * time.Minute).UnixMilli(),
		RevocationVersion:      7,
		CheckpointObservedAtMS: now.UnixMilli(),
		ReservationScope:       nodecommand.ReservationScopeNode,
		RemainingUses:          &remaining,
	}
	secondState := state
	secondRemaining := uint64(1000)
	secondState.ID = "cap-2"
	secondState.RemainingUses = &secondRemaining
	return nodecommand.NewValidator(
		signatureVerifierFunc(func(_ context.Context, _ string, payload []byte, signature string) error {
			if len(payload) == 0 || signature != "signature-1" {
				return errors.New("invalid signature")
			}
			return nil
		}),
		nodecommand.NewMemoryAuthorityStore(state, secondState),
		nodecommand.ValidatorOptions{
			Now:                     func() time.Time { return now },
			LocalTarget:             nodecommand.Target{OrganizationID: "org-1", NodeID: "node-1"},
			LowRiskActions:          lowRisk,
			MaxCommandTTL:           5 * time.Minute,
			MaxLowRiskCheckpointAge: 24 * time.Hour,
		},
	)
}

func testNow() time.Time {
	return time.UnixMilli(1784394000000).UTC()
}
