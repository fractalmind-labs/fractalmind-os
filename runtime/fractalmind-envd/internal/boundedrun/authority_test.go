package boundedrun

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"golang.org/x/crypto/blake2b"
)

type authorityProbe struct {
	state  nodecommand.CapabilityState
	run    nodecommand.ChainExecution
	now    int64
	fail   bool
	checks int
}

func (p *authorityProbe) Resolve(context.Context, nodecommand.CapabilityRef) (nodecommand.CapabilityState, error) {
	p.checks++
	if p.fail {
		return nodecommand.CapabilityState{}, errors.New("RPC unavailable")
	}
	return p.state, nil
}
func (p *authorityProbe) LookupExecution(context.Context, string, string) (nodecommand.ChainExecution, bool, error) {
	return p.run, true, nil
}
func (p *authorityProbe) ChainTime(context.Context) (int64, error) { return p.now, nil }
func guardFixture(t *testing.T) (nodecommand.NodeCommand, *authorityProbe, string) {
	t.Helper()
	dir := t.TempDir()
	workspace, err := WorkspaceHash(dir)
	if err != nil {
		t.Fatal(err)
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	address := blake2b.Sum256(append([]byte{0}, public...))
	now := time.Now().UnixMilli()
	command := nodecommand.NodeCommand{Version: "1", CommandID: "bounded-test", Signer: "0x" + hex.EncodeToString(address[:]), Target: nodecommand.Target{OrganizationID: "0x2", NodeID: "0x3", AgentID: "bounded"}, Action: "assign", Scope: "control", Capability: nodecommand.CapabilityRef{ID: "0x4", RevocationVersion: 1}, IssuedAtMS: now, ExpiresAtMS: now + 300000, Nonce: "nonce", IdempotencyKey: "idem", Budget: &nodecommand.BudgetClaim{Asset: "TOOL_CALLS", Amount: 4}, Payload: json.RawMessage(`{"task":"verify real files"}`)}
	command.PayloadHash = nodecommand.HashPayload(command.Payload)
	bytes, err := command.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	command.Signature = "ed25519:" + hex.EncodeToString(public) + ":" + hex.EncodeToString(ed25519.Sign(private, bytes))
	hash := sha256.Sum256(bytes)
	probe := &authorityProbe{now: now,
		state: nodecommand.CapabilityState{ID: command.Capability.ID, Target: command.Target, AuthorizedSigners: []string{command.Signer}, Actions: []string{command.Action}, Scopes: []string{command.Scope}, RevocationVersion: 1, ExpiresAtMS: command.ExpiresAtMS, AuthorityVersionHash: "source-and-version-proof", ManagedInstance: &nodecommand.ManagedInstanceAuthority{ID: "0x5", Runtime: "bounded-process-v1", WorkspaceHash: workspace, Version: 1}},
		run:   nodecommand.ChainExecution{ID: "0x6", State: 1, CapabilityID: command.Capability.ID, Target: command.Target, CapabilityVersion: 1, HostAddress: command.Target.NodeID, ManagedAgentID: "0x5", Signer: command.Signer, Action: command.Action, Scope: command.Scope, Fingerprint: hex.EncodeToString(hash[:]), AttemptID: strings.Repeat("a", 64), Budget: command.Budget, BudgetReserved: command.Budget.Amount, ExpiresAtMS: command.ExpiresAtMS},
	}
	return command, probe, dir
}
func TestGuardChecksCurrentChainBeforeEveryToolCall(t *testing.T) {
	command, probe, dir := guardFixture(t)
	guard, err := NewGuard(context.Background(), probe, command, probe.run, dir)
	if err != nil {
		t.Fatal(err)
	}
	tools := openTestTools(t, dir, 4, guard.Check)
	if _, err := tools.Call(context.Background(), Call{ID: "write", Action: Write, Path: "result", Content: "actual"}); err != nil {
		t.Fatal(err)
	}
	if probe.checks != 3 {
		t.Fatalf("not rechecking before publishing: %d", probe.checks)
	}
	probe.run.StopRequested = true
	if _, err := tools.Call(context.Background(), Call{ID: "later", Action: Write, Path: "after-stop", Content: "no"}); !errors.Is(err, ErrStopped) {
		t.Fatal("chain stop ignored")
	}
	if tools.Used() != 1 {
		t.Fatal("stopped tool charged")
	}
}
func TestGuardRefusesChangedAuthorityAttemptBudgetAndClock(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*authorityProbe)
	}{
		{"RPC", func(p *authorityProbe) { p.fail = true }},
		{"revoked", func(p *authorityProbe) { p.state.Revoked = true }},
		{"workspace", func(p *authorityProbe) { p.state.ManagedInstance.WorkspaceHash = strings.Repeat("b", 64) }},
		{"runtime label", func(p *authorityProbe) { p.state.ManagedInstance.Runtime = "tmux-observe" }},
		{"target", func(p *authorityProbe) { p.state.Target.AgentID = "other" }},
		{"signer", func(p *authorityProbe) { p.state.AuthorizedSigners = nil }},
		{"action", func(p *authorityProbe) { p.state.Actions = nil }},
		{"scope", func(p *authorityProbe) { p.state.Scopes = nil }},
		{"version", func(p *authorityProbe) { p.state.RevocationVersion++ }},
		{"attempt", func(p *authorityProbe) { p.run.AttemptID = strings.Repeat("b", 64) }},
		{"run ID", func(p *authorityProbe) { p.run.ID = "other" }},
		{"queued", func(p *authorityProbe) { p.run.State = 0 }},
		{"terminal", func(p *authorityProbe) { p.run.State = 2 }},
		{"settled", func(p *authorityProbe) { p.run.BudgetSettled = true }},
		{"budget", func(p *authorityProbe) { p.run.BudgetReserved++ }},
		{"clock boundary", func(p *authorityProbe) { p.now = p.run.ExpiresAtMS }},
		{"clock missing", func(p *authorityProbe) { p.now = 0 }},
	} {
		t.Run(test.name, func(t *testing.T) {
			command, probe, dir := guardFixture(t)
			guard, err := NewGuard(context.Background(), probe, command, probe.run, dir)
			if err != nil {
				t.Fatal(err)
			}
			test.mutate(probe)
			if err := guard.Check(context.Background()); err == nil {
				t.Fatal("changed chain state authorized a new tool")
			}
		})
	}
}
func TestGuardRequiresValidSignatureAndOwnStartedAttempt(t *testing.T) {
	command, probe, dir := guardFixture(t)
	command.Payload = json.RawMessage(`{"task":"changed"}`)
	if _, err := NewGuard(context.Background(), probe, command, probe.run, dir); err == nil {
		t.Fatal("tampered payload accepted")
	}
	command, probe, dir = guardFixture(t)
	command.Signature = "bad"
	if _, err := NewGuard(context.Background(), probe, command, probe.run, dir); err == nil {
		t.Fatal("bad signature accepted")
	}
	command, probe, dir = guardFixture(t)
	probe.run.AttemptID = ""
	if _, err := NewGuard(context.Background(), probe, command, probe.run, dir); err == nil {
		t.Fatal("missing attempt accepted")
	}
}

func TestGuardRechecksOkrAgreementAndCursorBeforeEffects(t *testing.T) {
	for _, change := range []string{"agreement", "cursor", "boundary", "binding removed", "historical cursor"} {
		t.Run(change, func(t *testing.T) {
			command, probe, dir := guardFixture(t)
			public, private, err := ed25519.GenerateKey(rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			defer clear(private)
			address := blake2b.Sum256(append([]byte{0}, public...))
			command.Signer = "0x" + hex.EncodeToString(address[:])
			paths := map[string][]string{"file.read": {"."}, "file.write": {"."}}
			hash, err := nodecommand.ExecutionBoundaryHash(paths)
			if err != nil {
				t.Fatal(err)
			}
			contract := nodecommand.ExecutionContractAuthority{ID: "okr", AgreementVersion: 1, KRIndex: 0, BoundaryHash: hash}
			probe.state.Contract = &contract
			recorded := contract
			probe.run.Contract = &recorded
			probe.state.AuthorizedSigners = []string{command.Signer}
			probe.run.Signer = command.Signer
			command.Payload, err = json.Marshal(map[string]any{"okr": nodecommand.ExecutionContractRef{ID: contract.ID, AgreementVersion: 1, KRIndex: 0}, "bounds": map[string]any{"paths": paths, "max_calls": command.Budget.Amount}})
			if err != nil {
				t.Fatal(err)
			}
			command.PayloadHash = nodecommand.HashPayload(command.Payload)
			signing, err := command.SigningBytes()
			if err != nil {
				t.Fatal(err)
			}
			command.Signature = "ed25519:" + hex.EncodeToString(public) + ":" + hex.EncodeToString(ed25519.Sign(private, signing))
			fingerprint := sha256.Sum256(signing)
			probe.run.Fingerprint = hex.EncodeToString(fingerprint[:])
			guard, err := NewGuard(context.Background(), probe, command, probe.run, dir)
			if err != nil {
				t.Fatal(err)
			}
			tools := openTestTools(t, dir, 4, guard.Check)
			switch change {
			case "agreement":
				probe.state.Contract.AgreementVersion++
			case "cursor":
				probe.state.Contract.KRIndex++
			case "boundary":
				probe.state.Contract.BoundaryHash = strings.Repeat("0", 64)
			case "binding removed":
				probe.state.Contract = nil
			case "historical cursor":
				probe.run.Contract.KRIndex++
			}
			if _, err := tools.Call(context.Background(), Call{ID: "must-refuse", Action: Write, Path: "after-change", Content: "no"}); err == nil {
				t.Fatal("changed OKR produced a tool effect")
			}
			if tools.Used() != 0 {
				t.Fatal("denied tool charged budget")
			}
		})
	}
}
