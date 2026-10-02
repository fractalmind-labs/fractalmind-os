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
	f := newChainFixture(t)
	const now = 1700000000000
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
	f.managed.Instance = "native-" + strings.Repeat("b", 64)
	f.cap.Agent = f.managed.Instance
	f.managed.Control = false
	f.auth.RequiredAction = 1
	f.sync(t)
	p := HandoverProposal{Version: "1", ManagedAgentID: f.managed.ID.String(), ManagedVersion: 1, OkrID: addressNumber(21).String(), OkrVersion: 1, SpecRevision: 1, WorkspaceHash: hex.EncodeToString(f.managed.Workspace), Paths: map[string][]string{"file.read": {"."}, "file.write": {"."}}, BudgetAsset: "TOOL_CALLS", BudgetLimit: 10, MaxCalls: 3, ExpiresAtMS: now + 60000, ReviewExpiresAtMS: now + 30000, Nonce: strings.Repeat("c", 64)}
	okr := moveOkr{ID: addressNumber(21), Org: f.org.ID, Human: f.human.ID, State: 0, Version: 1, SpecRevision: 1, Deadline: now + 120000, Metrics: []moveOkrMetric{{Target: 1, Weight: 100, MaxAge: 60000}}}
	f.saveObject(t, okr.ID, "okr::Okr", okr)
	command := NodeCommand{Version: "1", CommandID: "review-1", Signer: f.grant.Device.String(), Target: Target{OrganizationID: f.org.ID.String(), NodeID: f.member.Host.String(), AgentID: f.managed.Instance}, Action: "status", Scope: "observation", Capability: CapabilityRef{ID: f.cap.ID.String(), RevocationVersion: 1}, IssuedAtMS: now, ExpiresAtMS: now + 60000, Nonce: "review-nonce", IdempotencyKey: "review-idem"}
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
