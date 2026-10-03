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
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/boundedrun"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"golang.org/x/crypto/blake2b"
)

type directNativeAuthority struct {
	*blockingNativeAuthority
	checks int
	stopAt int
}

func (p *directNativeAuthority) ValidateDirectCommand(ctx context.Context, c nodecommand.NodeCommand, s nodecommand.CapabilityState) error {
	p.checks++
	if p.stopAt == p.checks {
		p.run.StopRequested = true
	}
	request, err := nodecommand.ParseDirectRequest(c, s.Direct)
	if err != nil {
		return err
	}
	hash, err := nodecommand.DirectRequestHash(request)
	if err != nil || hash != p.run.Direct.RequestHash {
		return boundedrun.ErrBoundary
	}
	return nil
}
func directNativeFixture(t *testing.T, action, task string, budget uint64) (*boundedFileAgent, *directNativeAuthority, *fakeRunner, Request, nodecommand.NodeCommand, string) {
	t.Helper()
	a, base, observer, id, dir := nativeFixture(t)
	p := &directNativeAuthority{blockingNativeAuthority: base}
	a.reader = p
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(private)
	address := blake2b.Sum256(append([]byte{0}, public...))
	paths := map[string][]string{"file.read": {"."}, "file.write": {"."}}
	boundary, _ := nodecommand.ExecutionBoundaryHash(paths)
	ref := nodecommand.DirectMessageRef{Version: "1", PermissionID: "0x" + strings.Repeat("a", 64), PermissionVersion: 1, MessageID: "0x" + strings.Repeat("b", 64), MessageRecordID: "0x" + strings.Repeat("c", 64), ConversationID: "conversation", MessageToken: "message", Action: action}
	raw, err := json.Marshal(map[string]any{"message": "Signed native request", "task": task, "bounds": &ExecutionBounds{Paths: paths, MaxCalls: nodecommand.Uint64String(budget)}, "direct": ref})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	c := nodecommand.NodeCommand{Version: "1", CommandID: "direct-" + hex.EncodeToString(public[:8]), Signer: "0x" + hex.EncodeToString(address[:]), Target: nodecommand.Target{OrganizationID: "0x2", NodeID: "0x3", AgentID: id}, Action: "direct.message", Scope: "direct", Capability: nodecommand.CapabilityRef{ID: "0x" + hex.EncodeToString(public), RevocationVersion: 1}, IssuedAtMS: now, ExpiresAtMS: now + 300000, Nonce: "nonce", IdempotencyKey: "idem", Payload: raw, PayloadHash: nodecommand.HashPayload(raw)}
	if budget > 0 {
		c.Budget = &nodecommand.BudgetClaim{Asset: "TOOL_CALLS", Amount: nodecommand.Uint64String(budget)}
	}
	bytes, err := c.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	c.Signature = "ed25519:" + hex.EncodeToString(public) + ":" + hex.EncodeToString(ed25519.Sign(private, bytes))
	hash := sha256.Sum256(bytes)
	workspace, _ := boundedrun.WorkspaceHash(dir)
	p.state = nodecommand.CapabilityState{ID: c.Capability.ID, Target: c.Target, AuthorizedSigners: []string{c.Signer}, Actions: []string{c.Action}, Scopes: []string{c.Scope}, RevocationVersion: 1, ExpiresAtMS: c.ExpiresAtMS, AuthorityVersionHash: "direct-source", ManagedInstance: &nodecommand.ManagedInstanceAuthority{ID: "0x5", Runtime: "bounded-process-v1", WorkspaceHash: workspace, Version: 1}, Direct: &nodecommand.DirectPermissionAuthority{ID: ref.PermissionID, Version: 1, BoundaryHash: boundary, MaxCalls: nodecommand.Uint64String(budget), Actions: []string{action}}}
	request, err := nodecommand.ParseDirectRequest(c, p.state.Direct)
	if err != nil {
		t.Fatal(err)
	}
	content, _ := nodecommand.DirectRequestHash(request)
	p.run = nodecommand.ChainExecution{ID: "0x6", State: 1, CapabilityID: c.Capability.ID, Target: c.Target, CapabilityVersion: 1, HostAddress: c.Target.NodeID, ManagedAgentID: "0x5", Signer: c.Signer, Action: c.Action, Scope: c.Scope, Fingerprint: hex.EncodeToString(hash[:]), AttemptID: strings.Repeat("d", 64), Budget: c.Budget, BudgetReserved: nodecommand.Uint64String(budget), ExpiresAtMS: c.ExpiresAtMS, Direct: &nodecommand.DirectExecutionAuthority{PermissionID: ref.PermissionID, PermissionVersion: 1, MessageID: ref.MessageID, MessageRecordID: ref.MessageRecordID, Action: action, BoundaryHash: boundary, RequestHash: content}}
	r := Request{SchemaVersion: SchemaVersion, CommandID: c.CommandID, Operation: OperationDirect, Agent: id, Message: request.Message, Direct: request.Direct, Params: &OperationParams{Task: task}, Bounds: &ExecutionBounds{Paths: paths, MaxCalls: nodecommand.Uint64String(budget)}}
	return a, p, observer, r, c, dir
}
func TestDirectNativeWriteReadAndZeroToolStatus(t *testing.T) {
	t.Run("write rechecks and measures actual file", func(t *testing.T) {
		a, p, observer, r, c, dir := directNativeFixture(t, "file.write", `{"kind":"ensure_text_files","files":[{"path":"direct.md","content":"actual direct output"}]}`, 3)
		response, err := a.runAuthorized(context.Background(), r, c, &p.run)
		if err != nil || !response.OK || response.Validate(r) != nil || response.Spend == nil || response.Spend.Amount != 3 || p.checks < 4 || observer.callCount() != 0 {
			t.Fatalf("direct failed: %+v %v checks=%d", response, err, p.checks)
		}
		value, err := os.ReadFile(filepath.Join(dir, "direct.md"))
		if err != nil || string(value) != "actual direct output" {
			t.Fatal("actual direct file not attained", err)
		}
		if physicalState(t, a, r.Agent).PhysicalState != "idle" {
			t.Fatal("physical slot not released")
		}
	})
	t.Run("read uses only read tools", func(t *testing.T) {
		a, p, observer, r, c, dir := directNativeFixture(t, "file.read", `{"kind":"inspect_text_files","paths":["direct.md"]}`, 1)
		if err := os.WriteFile(filepath.Join(dir, "direct.md"), []byte("existing"), 0600); err != nil {
			t.Fatal(err)
		}
		response, err := a.runAuthorized(context.Background(), r, c, &p.run)
		var out boundedrun.ReadOutcome
		if err != nil || !response.OK || response.Validate(r) != nil || response.Spend.Amount != 1 || json.Unmarshal(response.Result, &out) != nil || len(out.Results) != 1 || out.Results[0].Content != "existing" || observer.callCount() != 0 {
			t.Fatalf("read failed: %+v %v", response, err)
		}
		value, _ := os.ReadFile(filepath.Join(dir, "direct.md"))
		if string(value) != "existing" {
			t.Fatal("read modified file")
		}
	})
	t.Run("status remains available while physical slot is busy", func(t *testing.T) {
		a, p, observer, r, c, _ := directNativeFixture(t, "status", "", 0)
		release, ok := a.beginNative("files", "other", "other-run")
		if !ok {
			t.Fatal("could not reserve slot")
		}
		defer release()
		response, err := a.runAuthorized(context.Background(), r, c, &p.run)
		var state NativeState
		if err != nil || !response.OK || response.Spend != nil || response.Validate(r) != nil || json.Unmarshal(response.Result, &state) != nil || state.PhysicalState != "running" || state.ActiveCommandID != "other" || observer.callCount() != 0 {
			t.Fatalf("status failed: %+v %v", response, err)
		}
	})
}
func TestDirectNativeStopsBeforeEffectsAndKeepsKnownSpend(t *testing.T) {
	task := `{"kind":"ensure_text_files","files":[{"path":"direct.md","content":"blocked"}]}`
	for _, mode := range []string{"chain stop before write", "busy alias", "request substitution", "replaced workspace", "read action with write task", "unsigned call"} {
		t.Run(mode, func(t *testing.T) {
			action := "file.write"
			if mode == "read action with write task" {
				action = "file.read"
			}
			a, p, observer, r, c, dir := directNativeFixture(t, action, task, 3)
			switch mode {
			case "chain stop before write":
				p.stopAt = 3
			case "busy alias":
				release, ok := a.beginNative("files", "other", "other-run")
				if !ok {
					t.Fatal("slot")
				}
				defer release()
			case "request substitution":
				r.Params.Task = `{"kind":"ensure_text_files","files":[{"path":"direct.md","content":"substituted"}]}`
			case "replaced workspace":
				if err := os.Rename(dir, dir+"-old"); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { os.RemoveAll(dir + "-old") })
				if err := os.Mkdir(dir, 0700); err != nil {
					t.Fatal(err)
				}
			}
			var response Response
			var err error
			if mode == "unsigned call" {
				response, err = a.run(context.Background(), r)
			} else {
				response, err = a.runAuthorized(context.Background(), r, c, &p.run)
			}
			if mode == "unsigned call" {
				if err == nil {
					t.Fatal("unsigned execution accepted")
				}
			} else {
				want := nodecommand.Uint64String(0)
				if mode == "chain stop before write" {
					want = 1
				}
				if err != nil || response.OK || response.Error == nil || response.Spend == nil || !response.Spend.Known || response.Spend.Amount != want || response.Validate(r) != nil {
					t.Fatalf("denial failed: %+v %v", response, err)
				}
			}
			if _, err := os.Stat(filepath.Join(dir, "direct.md")); !os.IsNotExist(err) {
				t.Fatal("denied request wrote a file")
			}
			if observer.callCount() != 0 {
				t.Fatal("direct fell back to observer")
			}
		})
	}
}
