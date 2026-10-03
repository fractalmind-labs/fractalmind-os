package nodecommand

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"golang.org/x/crypto/blake2b"
)

func handoverChainFixture(t *testing.T) (*chainFixture, NodeCommand, ChainExecution, HandoverProposal, string) {
	t.Helper()
	return handoverChainFixtureWindow(t, 30000)
}

func handoverChainFixtureWindow(t *testing.T, window int64) (*chainFixture, NodeCommand, ChainExecution, HandoverProposal, string) {
	t.Helper()
	f := newChainFixture(t)
	const now = 1700000000000
	expires := now + max(int64(60000), window)
	f.coordinator.ID = addressNumber(20)
	f.member.Binding = f.coordinator.ID
	f.human.Grants = []moveAddress{f.grant.ID}
	f.human.Organizations = []moveAddress{f.org.ID}
	private := ed25519.NewKeyFromSeed([]byte(strings.Repeat("a", 32)))
	public := private.Public().(ed25519.PublicKey)
	f.grant.Device = moveAddress(blake2b.Sum256(append([]byte{0}, public...)))
	f.cap.Delegate = f.grant.Device
	f.cap.Actions = []string{"status"}
	f.cap.Scope = "observation"
	f.cap.ReservationScope = 2
	f.cap.MaxBudget = 0
	f.cap.BudgetAsset = ""
	f.cap.Expiry = uint64(expires)
	f.grant.Expiry = f.cap.Expiry
	f.member.Expiry = uint64(now + window + 90000)
	f.managed.Instance = "native-" + strings.Repeat("b", 64)
	f.cap.Agent = f.managed.Instance
	f.managed.Control = false
	f.auth.RequiredAction = 1
	f.sync(t)
	p := HandoverProposal{Version: "1", ManagedAgentID: f.managed.ID.String(), ManagedVersion: 1, OkrID: addressNumber(21).String(), OkrVersion: 1, SpecRevision: 1, WorkspaceHash: hex.EncodeToString(f.managed.Workspace), Paths: map[string][]string{"file.read": {"."}, "file.write": {"."}}, BudgetAsset: "TOOL_CALLS", BudgetLimit: 10, MaxCalls: 3, ExpiresAtMS: expires, ReviewExpiresAtMS: now + window, Nonce: strings.Repeat("c", 64)}
	okr := moveOkr{ID: addressNumber(21), Org: f.org.ID, Human: f.human.ID, State: 0, Version: 1, SpecRevision: 1, Deadline: uint64(now + window + 90000), Metrics: []moveOkrMetric{{Target: 1, Weight: 100, MaxAge: 60000}}}
	f.saveObject(t, okr.ID, "okr::Okr", okr)
	command := NodeCommand{Version: "1", CommandID: "review-1", Signer: f.grant.Device.String(), Target: Target{OrganizationID: f.org.ID.String(), NodeID: f.member.Host.String(), AgentID: f.managed.Instance}, Action: "status", Scope: "observation", Capability: CapabilityRef{ID: f.cap.ID.String(), RevocationVersion: 1}, IssuedAtMS: now, ExpiresAtMS: expires, Nonce: "review-nonce", IdempotencyKey: "review-idem"}
	command.Payload, _ = json.Marshal(map[string]any{"handover_review": p})
	command.PayloadHash = HashPayload(command.Payload)
	signing, err := command.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	command.Signature = "ed25519:" + hex.EncodeToString(public) + ":" + hex.EncodeToString(ed25519.Sign(private, signing))
	fingerprint := hashBytes(signing)
	key, _ := hex.DecodeString(fingerprint)
	run := moveExecution{ID: addressNumber(11), Org: f.org.ID, Capability: f.cap.ID, CapabilityVersion: 1, Human: f.human.ID, Grant: f.grant.ID, GrantVersion: 1, Membership: f.member.ID, Host: f.member.Host, Managed: []moveAddress{f.managed.ID}, Delegate: f.cap.Delegate, Node: f.cap.Node, Agent: f.cap.Agent, Command: command.CommandID, Nonce: command.Nonce, Idempotency: command.IdempotencyKey, IntentHash: key, Action: command.Action, Scope: command.Scope, Issued: uint64(command.IssuedAtMS), Expires: uint64(command.ExpiresAtMS), State: 1, Cursor: 1, AttemptID: []byte(strings.Repeat("d", 32))}
	pkg := f.resolver.packageID
	f.saveObject(t, run.ID, "node_execution::CommandExecution", run)
	index := moveExecutionIndex{Executions: moveTable{ID: addressNumber(12), Size: 1}}
	f.saveField(t, f.cap.ID, structKeyTag(pkg, "node_execution", "ExecutionIndexKey"), []byte{0}, pkg+"::node_execution::ExecutionIndexKey", pkg+"::node_execution::ExecutionIndex", index)
	f.saveField(t, index.Executions.ID, []byte{6, 1}, appendBCSBytes(nil, key), "vector<u8>", "0x2::object::ID", run.ID)
	f.saveField(t, f.cap.ID, structKeyTag(pkg, "remote_authority", "BoundBudgetClaimKey"), appendBCSBytes(nil, key), pkg+"::remote_authority::BoundBudgetClaimKey", pkg+"::remote_authority::BoundBudgetClaim", moveBoundBudgetClaim{})
	ledger := f.saveField(t, f.org.ID, structKeyTag(pkg, "host", "AgentExecutionIndexKey"), f.managed.ID[:], pkg+"::host::AgentExecutionIndexKey", pkg+"::host::AgentExecutionIndex", moveAgentExecutionIndex{Executions: moveTable{ID: addressNumber(13), Size: 1}, Revision: 2})
	clock := addressNumber(6)
	f.objects[clock.String()] = ChainObject{ID: clock.String(), Type: "0x2::clock::Clock", Shared: true, Version: 1, Content: binary.LittleEndian.AppendUint64(append([]byte(nil), clock[:]...), now)}
	current, found, err := f.resolver.LookupExecution(context.Background(), command.Capability.ID, fingerprint)
	if err != nil || !found {
		t.Fatalf("review Run fixture: %v %v", found, err)
	}
	return f, command, current, p, ledger
}

func TestHandoverUsesExactTypedAuthorityAndCompleteCoverage(t *testing.T) {
	f, command, run, p, _ := handoverChainFixture(t)
	got, err := f.resolver.InspectHandover(context.Background(), command, run, p)
	hash, _ := p.Hash()
	if err != nil || got.ProposalHash != hash || got.CoverageRevision != 2 || got.ClockMS != 1700000000000 {
		t.Fatalf("review %+v %v", got, err)
	}
	if f.managed.Control {
		t.Fatal("review changed control")
	}
}

func TestHandoverReviewWindowBounds(t *testing.T) {
	for _, tc := range []struct {
		name   string
		window int64
		valid  bool
	}{
		{"short original", 30000, true},
		{"old maximum", 60000, true},
		{"beyond old maximum", 60001, true},
		{"maximum", MaxHandoverReviewWindowMS, true},
		{"above maximum", MaxHandoverReviewWindowMS + 1, false},
		{"at expiry", 0, false},
		{"after expiry", -1, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f, command, run, proposal, _ := handoverChainFixtureWindow(t, tc.window)
			source, err := f.resolver.InspectHandover(context.Background(), command, run, proposal)
			if (err == nil) != tc.valid {
				t.Fatalf("window %d accepted=%v, wanted %v: %v", tc.window, err == nil, tc.valid, err)
			}
			acceptance := HandoverAcceptance{Version: "1", ExecutionID: run.ID, OrganizationID: command.Target.OrganizationID, HumanID: run.HumanID, GrantID: run.GrantID, MembershipID: run.MembershipID, BindingID: run.CoordinatorBindingID, HostAddress: run.HostAddress, InstanceID: command.Target.AgentID, Proposal: proposal, CoverageRevision: 2, ObservedAtMS: command.IssuedAtMS}
			if _, err := acceptance.SigningBytes(); (err == nil) != tc.valid {
				t.Fatalf("acceptance window %d accepted=%v, wanted %v: %v", tc.window, err == nil, tc.valid, err)
			}
			if !tc.valid {
				return
			}
			// The original fixed deadline remains authoritative after a long
			// Human review; the read proof cannot turn expiry into a renewal.
			clock := f.objects[addressNumber(6).String()]
			clock.Content = append([]byte(nil), clock.Content...)
			binary.LittleEndian.PutUint64(clock.Content[32:], uint64(proposal.ReviewExpiresAtMS-1))
			f.objects[clock.ID] = clock
			if _, err := f.resolver.RecheckHandover(context.Background(), command, run, proposal, source); err != nil {
				t.Fatalf("last millisecond rejected: %v", err)
			}
			binary.LittleEndian.PutUint64(clock.Content[32:], uint64(proposal.ReviewExpiresAtMS))
			f.objects[clock.ID] = clock
			if _, err := f.resolver.RecheckHandover(context.Background(), command, run, proposal, source); err == nil {
				t.Fatal("exact expiry renewed the original review")
			}
		})
	}
}

func TestHandoverPhysicalRecheckRejectsChangesToEverySource(t *testing.T) {
	for _, mode := range []string{"unchanged", "grant", "Human", "membership", "managed", "OKR", "ledger", "Run stop", "budget", "missing", "RPC failure", "expired", "clock rollback", "serialized proof", "wrong attempt", "wrong payload"} {
		t.Run(mode, func(t *testing.T) {
			f, command, run, proposal, ledger := handoverChainFixture(t)
			f.resolver.reader = &authorityBatchFixture{chainFixture: f}
			source, err := f.resolver.InspectHandover(context.Background(), command, run, proposal)
			if err != nil {
				t.Fatal(err)
			}
			change := func(id string) { object := f.objects[id]; object.Version++; f.objects[id] = object }
			switch mode {
			case "grant":
				change(f.grant.ID.String())
			case "Human":
				change(f.human.ID.String())
			case "membership":
				change(f.member.ID.String())
			case "managed":
				change(f.managed.ID.String())
			case "OKR":
				change(proposal.OkrID)
			case "ledger":
				change(ledger)
			case "Run stop":
				change(run.ID)
			case "budget":
				for id := range source.proof.versions {
					if strings.Contains(f.objects[id].Type, "BoundBudgetClaim>") {
						change(id)
					}
				}
			case "missing":
				delete(f.objects, run.ID)
			case "RPC failure":
				f.fail = true
			case "expired", "clock rollback":
				clock := f.objects[addressNumber(6).String()]
				clock.Content = append([]byte(nil), clock.Content...)
				timestamp := uint64(proposal.ReviewExpiresAtMS)
				if mode == "clock rollback" {
					timestamp = uint64(source.ClockMS - 1)
				}
				binary.LittleEndian.PutUint64(clock.Content[32:], timestamp)
				f.objects[clock.ID] = clock
			case "serialized proof":
				data, _ := json.Marshal(source)
				source = HandoverAuthority{}
				if err := json.Unmarshal(data, &source); err != nil {
					t.Fatal(err)
				}
			case "wrong attempt":
				run.AttemptID = strings.Repeat("e", 64)
			case "wrong payload":
				command.Payload = []byte(`{}`)
			}
			after, err := f.resolver.RecheckHandover(context.Background(), command, run, proposal, source)
			if mode == "unchanged" {
				if err != nil || after.ProposalHash != source.ProposalHash || after.CoverageRevision != source.CoverageRevision || after.proof != nil {
					t.Fatalf("unchanged physical review rejected: %+v %v", after, err)
				}
			} else if err == nil {
				t.Fatal("changed source accepted after physical exclusion")
			}
		})
	}
}

func TestHandoverRejectsUnknownCoverageAndChangedAuthority(t *testing.T) {
	for _, mode := range []string{"missing coverage", "unsettled control", "unknown revision", "wrong owner", "wrong type", "changed coverage", "RPC failure", "changed proposal", "changed payload", "wrong run Human", "wrong run Grant", "wrong run binding", "wrong attempt", "approval missing", "host management missing", "non-admin", "managed version", "OKR changed", "expired review", "forged device signature"} {
		t.Run(mode, func(t *testing.T) {
			f, command, run, p, ledger := handoverChainFixture(t)
			pkg := f.resolver.packageID
			switch mode {
			case "missing coverage":
				delete(f.objects, ledger)
			case "unsettled control", "unknown revision":
				index := moveAgentExecutionIndex{Executions: moveTable{ID: addressNumber(13), Size: 1}, Revision: 2}
				if mode == "unsettled control" {
					index.UnsettledControl = 1
				} else {
					index.Revision = 0
				}
				f.saveField(t, f.org.ID, structKeyTag(pkg, "host", "AgentExecutionIndexKey"), f.managed.ID[:], pkg+"::host::AgentExecutionIndexKey", pkg+"::host::AgentExecutionIndex", index)
			case "wrong owner":
				o := f.objects[ledger]
				o.OwnerID = f.cap.ID.String()
				f.objects[ledger] = o
			case "wrong type":
				o := f.objects[ledger]
				o.Type = strings.ReplaceAll(o.Type, "AgentExecutionIndex>", "Other>")
				f.objects[ledger] = o
			case "changed coverage":
				f.changeOnRead = ledger
			case "RPC failure":
				f.fail = true
			case "changed proposal":
				p.BudgetLimit++
			case "changed payload":
				command.Payload = []byte(`{"handover_review":null}`)
			case "wrong run Human":
				run.HumanID = f.grant.ID.String()
			case "wrong run Grant":
				run.GrantID = f.human.ID.String()
			case "wrong run binding":
				run.CoordinatorBindingID = f.managed.ID.String()
			case "wrong attempt":
				run.AttemptID = strings.Repeat("f", 64)
			case "approval missing":
				f.grant.Actions = []byte{1, 2, 4}
				f.sync(t)
			case "host management missing":
				f.grant.Actions = []byte{1, 2, 3}
				f.sync(t)
			case "non-admin":
				f.role.Admin = false
				f.sync(t)
			case "managed version":
				f.managed.Version++
				f.sync(t)
			case "OKR changed":
				o := f.objects[p.OkrID]
				o.Type = strings.ReplaceAll(o.Type, "okr::Okr", "host::ManagedAgent")
				f.objects[p.OkrID] = o
			case "expired review":
				clock := f.objects[addressNumber(6).String()]
				binary.LittleEndian.PutUint64(clock.Content[32:], uint64(p.ReviewExpiresAtMS))
				f.objects[clock.ID] = clock
			case "forged device signature":
				command.Signature = "ed25519:" + strings.Repeat("0", 64) + ":" + strings.Repeat("0", 128)
			}
			if _, err := f.resolver.InspectHandover(context.Background(), command, run, p); err == nil {
				t.Fatal("unsafe review accepted")
			}
		})
	}
}

func TestHandoverPublicCanonicalVector(t *testing.T) {
	raw, err := os.ReadFile("testdata/handover-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var vector struct {
		Acceptance HandoverAcceptance `json:"acceptance"`
		Bytes      string             `json:"bytes"`
		Hash       string             `json:"proposalHash"`
	}
	if err = json.Unmarshal(raw, &vector); err != nil {
		t.Fatal(err)
	}
	actual, err := vector.Acceptance.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	expected, err := base64.StdEncoding.DecodeString(vector.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := vector.Acceptance.Proposal.Hash()
	if err != nil || hash != vector.Hash || !bytes.Equal(actual, expected) {
		t.Fatal("canonical vector changed", err)
	}
	if err = vector.Acceptance.VerifySignature(context.Background()); err != nil {
		t.Fatal(err)
	}
	vector.Acceptance.Proposal.BudgetLimit++
	if err = vector.Acceptance.VerifySignature(context.Background()); err == nil {
		t.Fatal("changed limit kept signature valid")
	}
}
