package runtimeadapter

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"golang.org/x/crypto/blake2b"
)

type reviewAuthorityFixture struct {
	*blockingNativeAuthority
	inspections        int
	changeAfterReserve bool
	onSecond           func()
}

func (p *reviewAuthorityFixture) InspectHandover(_ context.Context, _ nodecommand.NodeCommand, _ nodecommand.ChainExecution, proposal nodecommand.HandoverProposal) (nodecommand.HandoverAuthority, error) {
	p.inspections++
	if p.inspections == 2 && p.onSecond != nil {
		p.onSecond()
	}
	if p.changeAfterReserve && p.inspections > 1 {
		return nodecommand.HandoverAuthority{}, errors.New("authority changed")
	}
	hash, err := proposal.Hash()
	return nodecommand.HandoverAuthority{ProposalHash: hash, CoverageRevision: 2, ClockMS: time.Now().UnixMilli()}, err
}
func nativeReviewFixture(t *testing.T) (*boundedFileAgent, *reviewAuthorityFixture, *fakeRunner, Request, nodecommand.NodeCommand, nodecommand.ChainExecution, string) {
	t.Helper()
	a, probe, observer, id, dir := nativeFixture(t)
	reader := &reviewAuthorityFixture{blockingNativeAuthority: probe}
	a.reader = reader
	full := func(value string) string { return "0x" + strings.Repeat(value, 64) }
	private := ed25519.NewKeyFromSeed([]byte(strings.Repeat("a", 32)))
	public := private.Public().(ed25519.PublicKey)
	address := blake2b.Sum256(append([]byte{0}, public...))
	now := time.Now().UnixMilli()
	workspace := a.NativeDiscovery().Instances[0].WorkspaceHash
	p := nodecommand.HandoverProposal{Version: "1", ManagedAgentID: full("5"), ManagedVersion: 1, OkrID: full("6"), OkrVersion: 1, SpecRevision: 1, WorkspaceHash: workspace, Paths: map[string][]string{"file.read": {"."}, "file.write": {"."}}, BudgetAsset: "TOOL_CALLS", BudgetLimit: 10, MaxCalls: 3, ExpiresAtMS: now + 60000, ReviewExpiresAtMS: now + 30000, Nonce: strings.Repeat("b", 64)}
	command := nodecommand.NodeCommand{Version: "1", CommandID: "review-native", Signer: "0x" + hex.EncodeToString(address[:]), Target: nodecommand.Target{OrganizationID: full("2"), NodeID: full("3"), AgentID: id}, Capability: nodecommand.CapabilityRef{ID: full("1"), RevocationVersion: 1}, Action: "status", Scope: "observation", IssuedAtMS: now, ExpiresAtMS: now + 60000, Nonce: "nonce", IdempotencyKey: "idem"}
	command.Payload, _ = json.Marshal(map[string]any{"handover_review": p})
	command.PayloadHash = nodecommand.HashPayload(command.Payload)
	data, err := command.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	command.Signature = "ed25519:" + hex.EncodeToString(public) + ":" + hex.EncodeToString(ed25519.Sign(private, data))
	fingerprint := sha256.Sum256(data)
	run := nodecommand.ChainExecution{ID: full("7"), CapabilityID: command.Capability.ID, HumanID: full("8"), GrantID: full("9"), MembershipID: full("a"), CoordinatorBindingID: full("b"), ManagedAgentID: p.ManagedAgentID, HostAddress: command.Target.NodeID, Signer: command.Signer, Target: command.Target, Action: command.Action, Scope: command.Scope, State: 1, Fingerprint: hex.EncodeToString(fingerprint[:]), ExpiresAtMS: command.ExpiresAtMS}
	request := Request{SchemaVersion: SchemaVersion, CommandID: command.CommandID, Operation: OperationStatus, Agent: id, Handover: &p}
	return a, reader, observer, request, command, run, dir
}
func TestNativeReviewHoldsBothAliasesWithoutExecutingTools(t *testing.T) {
	a, reader, observer, request, command, run, dir := nativeReviewFixture(t)
	response, err := a.runAuthorized(context.Background(), request, command, &run)
	if err != nil || !response.OK || response.HandoverReview == nil || response.Validate(request) != nil {
		t.Fatalf("review %+v %v", response, err)
	}
	if response.HandoverReview.Signature != "" {
		t.Fatal("runtime held a signing key")
	}
	if err := response.HandoverReview.ValidateCommand(command, run); err != nil {
		t.Fatal(err)
	}
	if reader.inspections != 2 || observer.callCount() != 0 {
		t.Fatal("review did not recheck or invoked an observer")
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 0 {
		t.Fatal("review touched files", entries, err)
	}
	for _, name := range []string{request.Agent, "files"} {
		if state := physicalState(t, a, name); state.PhysicalState != "idle" || !state.ReviewPending || state.ReviewExpiresAtMS != request.Handover.ReviewExpiresAtMS {
			t.Fatalf("review status %+v", state)
		}
		_, ok := a.beginNative(name, "new-command", "new-execution")
		if ok {
			t.Fatal("review allowed execution", name)
		}
	}
	// Reading the same proof must not grant control or replace a live review.
	again, err := a.runAuthorized(context.Background(), request, command, &run)
	if err != nil || again.OK || again.Error.Code != "instance_busy" {
		t.Fatal("duplicate refreshed review", again, err)
	}
	a.mu.Lock()
	lease := a.reviews[request.Agent]
	lease.deadline = time.Now().Add(-time.Second)
	a.reviews[request.Agent] = lease
	a.mu.Unlock()
	if state := physicalState(t, a, request.Agent); state.ReviewPending {
		t.Fatal("expired lease advertised as live")
	}
	release, ok := a.beginNative("files", "new-command", "new-execution")
	if !ok {
		t.Fatal("expired lease kept physical slot blocked")
	}
	release()
}
func TestNativeReviewRejectsUnsafePathsAndReleasesChangedSources(t *testing.T) {
	for _, mode := range []string{"source change", "unsafe scope", "missing scope", "symlink scope", "busy", "unsigned entry", "unsupported authority", "replaced workspace", "wrong proposal"} {
		t.Run(mode, func(t *testing.T) {
			a, reader, observer, request, command, run, dir := nativeReviewFixture(t)
			switch mode {
			case "source change":
				reader.changeAfterReserve = true
			case "unsafe scope":
				request.Handover.Paths["file.write"] = []string{"../escape"}
			case "missing scope":
				request.Handover.Paths["file.write"] = []string{"missing"}
			case "symlink scope":
				if err := os.Symlink(t.TempDir(), filepath.Join(dir, "link")); err != nil {
					t.Fatal(err)
				}
				request.Handover.Paths["file.write"] = []string{"link"}
			case "busy":
				release, ok := a.beginNative(request.Agent, "old", "old-run")
				if !ok {
					t.Fatal("could not hold physical slot")
				}
				defer release()
			case "unsupported authority":
				a.reader = reader.blockingNativeAuthority
			case "replaced workspace":
				if err := os.Rename(dir, dir+"-old"); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { os.RemoveAll(dir + "-old") })
				if err := os.Mkdir(dir, 0700); err != nil {
					t.Fatal(err)
				}
			case "wrong proposal":
				request.Handover.BudgetLimit++
			}
			var response Response
			var err error
			if mode == "unsigned entry" {
				response, err = a.run(context.Background(), request)
			} else {
				response, err = a.runAuthorized(context.Background(), request, command, &run)
			}
			if response.OK || response.HandoverReview != nil {
				t.Fatalf("unsafe review accepted %+v %v", response, err)
			}
			if observer.callCount() != 0 || len(a.reviews) != 0 {
				t.Fatal("denied review executed or retained a lease")
			}
		})
	}
}

// A late failed review cannot release a different physical reservation that
// replaced its expired lease, even when both requests proposed the same hash.
func TestLateReviewFailureDoesNotReleaseNewReservation(t *testing.T) {
	a, reader, _, request, command, run, _ := nativeReviewFixture(t)
	var replacement *nativeReviewLease
	reader.changeAfterReserve = true
	reader.onSecond = func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		old := a.reviews[request.Agent]
		replacement = &nativeReviewLease{hash: old.hash, deadline: time.Now().Add(time.Minute), expiresAtMS: old.expiresAtMS}
		a.reviews[request.Agent] = replacement
	}
	response, err := a.runAuthorized(context.Background(), request, command, &run)
	if err != nil || response.OK || response.Error.Code != "handover_changed" {
		t.Fatal("late source failure not rejected", response, err)
	}
	a.mu.Lock()
	held := a.reviews[request.Agent]
	a.mu.Unlock()
	if replacement == nil || held != replacement {
		t.Fatal("failed review released another reservation")
	}
}
