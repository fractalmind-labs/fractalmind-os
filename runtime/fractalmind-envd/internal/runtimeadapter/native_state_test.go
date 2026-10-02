package runtimeadapter

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/boundedrun"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"golang.org/x/crypto/blake2b"
)

type blockingNativeAuthority struct {
	state            nodecommand.CapabilityState
	run              nodecommand.ChainExecution
	entered, release chan struct{}
	calls            atomic.Int32
}

func (p *blockingNativeAuthority) Resolve(ctx context.Context, _ nodecommand.CapabilityRef) (nodecommand.CapabilityState, error) {
	if p.calls.Add(1) == 1 && p.entered != nil {
		close(p.entered)
		select {
		case <-p.release:
		case <-ctx.Done():
			return nodecommand.CapabilityState{}, ctx.Err()
		}
	}
	return p.state, nil
}
func (p *blockingNativeAuthority) LookupExecution(context.Context, string, string) (nodecommand.ChainExecution, bool, error) {
	return p.run, true, nil
}
func (p *blockingNativeAuthority) ChainTime(context.Context) (int64, error) {
	return time.Now().UnixMilli(), nil
}

func nativeFixture(t *testing.T) (*boundedFileAgent, *blockingNativeAuthority, *fakeRunner, string, string) {
	t.Helper()
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("native kernel process continuity unsupported")
	}
	dir := t.TempDir()
	probe := &blockingNativeAuthority{}
	observer := &fakeRunner{}
	adapter, err := BoundedFileAgent(probe, map[string]string{"files": dir}, observer)
	if err != nil {
		t.Fatal(err)
	}
	a := adapter.(*boundedFileAgent)
	scan := a.NativeDiscovery()
	if scan.State != "complete" || len(scan.Instances) != 1 {
		t.Fatalf("actual native inventory unavailable: %+v", scan)
	}
	return a, probe, observer, scan.Instances[0].InstanceID, scan.Instances[0].Workspace
}
func nativeAssignment(t *testing.T, probe *blockingNativeAuthority, id, dir string, policies ...*nodecommand.ExecutionHandoverAuthority) (Request, nodecommand.NodeCommand) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(private)
	address := blake2b.Sum256(append([]byte{0}, public...))
	task := `{"kind":"ensure_text_files","files":[{"path":"actual.md","content":"attained"}]}`
	paths := map[string][]string{"file.read": {"."}, "file.write": {"."}}
	boundary, _ := nodecommand.ExecutionBoundaryHash(paths)
	contract := nodecommand.ExecutionContractAuthority{ID: "okr", AgreementVersion: 1, BoundaryHash: boundary}
	policy := nodecommand.ExecutionHandoverAuthority{ApprovalID: "0x" + strings.Repeat("f", 64), ProposalHash: strings.Repeat("c", 64), Nonce: strings.Repeat("b", 64), MaxCalls: 3, ManagedVersion: 1}
	if len(policies) > 0 {
		policy = *policies[0]
	}
	payload, err := json.Marshal(map[string]any{"task": task, "okr": nodecommand.ExecutionContractRef{ID: contract.ID, AgreementVersion: 1}, "bounds": map[string]any{"paths": paths, "max_calls": nodecommand.Uint64String(3)}, "handover_continue": nodecommand.HandoverContinuationRef{ApprovalID: policy.ApprovalID, ProposalHash: policy.ProposalHash, Nonce: policy.Nonce}})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	command := nodecommand.NodeCommand{Version: "1", CommandID: "native-" + hex.EncodeToString(public[:8]), Signer: "0x" + hex.EncodeToString(address[:]), Target: nodecommand.Target{OrganizationID: "0x2", NodeID: "0x3", AgentID: id}, Action: "assign", Scope: "control", Capability: nodecommand.CapabilityRef{ID: "0x" + hex.EncodeToString(public), RevocationVersion: 1}, IssuedAtMS: now, ExpiresAtMS: now + 300000, Nonce: "nonce", IdempotencyKey: "idem", Budget: &nodecommand.BudgetClaim{Asset: "TOOL_CALLS", Amount: 3}, Payload: payload}
	command.PayloadHash = nodecommand.HashPayload(payload)
	bytes, err := command.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	command.Signature = "ed25519:" + hex.EncodeToString(public) + ":" + hex.EncodeToString(ed25519.Sign(private, bytes))
	hash := sha256.Sum256(bytes)
	workspace, err := boundedrun.WorkspaceHash(dir)
	if err != nil {
		t.Fatal(err)
	}
	probe.state = nodecommand.CapabilityState{ID: command.Capability.ID, Target: command.Target, AuthorizedSigners: []string{command.Signer}, Actions: []string{command.Action}, Scopes: []string{command.Scope}, RevocationVersion: 1, ExpiresAtMS: command.ExpiresAtMS, AuthorityVersionHash: "current-chain-source", ManagedInstance: &nodecommand.ManagedInstanceAuthority{ID: "0x5", Runtime: "bounded-process-v1", WorkspaceHash: workspace, Version: 1}}
	probe.run = nodecommand.ChainExecution{ID: "0x6", State: 1, CapabilityID: command.Capability.ID, Target: command.Target, CapabilityVersion: 1, HostAddress: command.Target.NodeID, ManagedAgentID: "0x5", Signer: command.Signer, Action: command.Action, Scope: command.Scope, Fingerprint: hex.EncodeToString(hash[:]), AttemptID: strings.Repeat("a", 64), Budget: command.Budget, BudgetReserved: command.Budget.Amount, ExpiresAtMS: command.ExpiresAtMS}
	probe.state.ManagedInstance.Version = policy.ManagedVersion
	probe.state.Contract = &contract
	probe.state.Handover = &policy
	recorded := contract
	probe.run.Contract = &recorded
	return Request{SchemaVersion: SchemaVersion, CommandID: command.CommandID, Operation: OperationAssign, Agent: id, Params: &OperationParams{Task: task}, Bounds: &ExecutionBounds{Paths: map[string][]string{"file.read": {"."}, "file.write": {"."}}, MaxCalls: 3}}, command
}
func physicalState(t *testing.T, a *boundedFileAgent, id string) NativeState {
	t.Helper()
	request := Request{SchemaVersion: SchemaVersion, CommandID: "native-state", Operation: OperationStatus, Agent: id}
	response, err := a.run(context.Background(), request)
	if err != nil || !response.OK || response.Validate(request) != nil {
		t.Fatalf("invalid physical status: %+v %v", response, err)
	}
	var state NativeState
	if err = json.Unmarshal(response.Result, &state); err != nil {
		t.Fatal(err)
	}
	return state
}
func TestNativeStateAndConfiguredAliasShareRealExecutionSlot(t *testing.T) {
	a, probe, observer, id, dir := nativeFixture(t)
	request, command := nativeAssignment(t, probe, id, dir)
	if state := physicalState(t, a, "files"); state.InstanceID != id || state.PhysicalState != "idle" {
		t.Fatalf("wrong initial status: %+v", state)
	}
	probe.entered, probe.release = make(chan struct{}), make(chan struct{})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	type result struct {
		response Response
		err      error
	}
	done := make(chan result, 1)
	go func() {
		response, err := a.runAuthorized(ctx, request, command, &probe.run)
		done <- result{response, err}
	}()
	select {
	case <-probe.entered:
	case <-ctx.Done():
		t.Fatal("execution did not enter current authority check")
	}
	defer func() {
		select {
		case <-probe.release:
		default:
			close(probe.release)
		}
	}()
	for _, name := range []string{id, "files"} {
		state := physicalState(t, a, name)
		if state.PhysicalState != "running" || state.ActiveCommandID != command.CommandID || state.ActiveExecutionID != probe.run.ID || state.StartedAt == "" {
			t.Fatalf("missing physical execution: %+v", state)
		}
		// Distinct signed commands/checkpoints, not a duplicate of the first.
		secondAuthority := &blockingNativeAuthority{}
		second, secondCommand := nativeAssignment(t, secondAuthority, name, dir)
		response, err := a.runAuthorized(ctx, second, secondCommand, &secondAuthority.run)
		if err != nil || response.OK || response.Error == nil || response.Error.Code != "instance_busy" || response.Spend == nil || !response.Spend.Known || response.Spend.Amount != 0 || response.Validate(second) != nil {
			t.Fatalf("second task was not denied before tools: %+v %v", response, err)
		}
	}
	if probe.calls.Load() != 1 || observer.callCount() != 0 {
		t.Fatal("busy/status crossed authority or invoked observer")
	}
	if _, err := os.Stat(filepath.Join(dir, "actual.md")); !os.IsNotExist(err) {
		t.Fatal("concurrent task touched the workspace")
	}
	close(probe.release)
	select {
	case result := <-done:
		if result.err != nil || !result.response.OK || result.response.Spend.Amount != 3 {
			t.Fatalf("first bounded execution failed: %+v %v", result.response, result.err)
		}
	case <-ctx.Done():
		t.Fatal("first execution did not finish")
	}
	if value, err := os.ReadFile(filepath.Join(dir, "actual.md")); err != nil || string(value) != "attained" {
		t.Fatal("signed native alias did not write actual file")
	}
	state := physicalState(t, a, id)
	if state.PhysicalState != "idle" || state.ActiveCommandID != "" || state.ActiveExecutionID != "" || state.StartedAt != "" {
		t.Fatalf("slot was not released: %+v", state)
	}
}
func TestNativeStatusRejectsUnknownAndReplacedWorkspaceWithoutFallback(t *testing.T) {
	a, probe, observer, id, dir := nativeFixture(t)
	request, command := nativeAssignment(t, probe, id, dir)
	unknown := Request{SchemaVersion: SchemaVersion, CommandID: "unknown-native", Operation: OperationAvailability, Agent: "native-" + strings.Repeat("f", 64)}
	response, err := a.run(context.Background(), unknown)
	if err != nil || response.OK || response.Error == nil || response.Validate(unknown) != nil {
		t.Fatal("unknown native instance got status", response, err)
	}
	if err = os.Rename(dir, dir+"-old"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir + "-old") })
	if err = os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{id, "files"} {
		status := unknown
		status.Agent = name
		response, err = a.run(context.Background(), status)
		if err != nil || response.OK || response.Error == nil || response.Error.Code != "workspace_changed" {
			t.Fatal("replacement directory got physical idle", response, err)
		}
		request.Agent = name
		response, err = a.runAuthorized(context.Background(), request, command, &probe.run)
		if err != nil || response.OK || response.Error == nil || response.Error.Code != "workspace_changed" {
			t.Fatal("replacement directory accepted assignment", response, err)
		}
	}
	if observer.callCount() != 0 || probe.calls.Load() != 0 {
		t.Fatal("invalid native instance fell back or executed")
	}
	if _, err = os.Stat(filepath.Join(dir, "actual.md")); !os.IsNotExist(err) {
		t.Fatal("replacement workspace was modified")
	}
}
