package nodecommand

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

func TestOriginalCheckpointRecheckReadsStopAndRejectsSplicedOrUnprovenSources(t *testing.T) {
	for _, mode := range []string{"stopped", "serialized", "wrong ID", "wrong fingerprint", "wrong membership", "wrong Host", "budget missing", "changed during read"} {
		t.Run(mode, func(t *testing.T) {
			f, fingerprint, claim := executionFixture(t, 1, moveBoundBudgetClaim{Reserved: 20})
			f.resolver.reader = &authorityBatchFixture{chainFixture: f}
			known, found, err := f.resolver.LookupExecution(context.Background(), f.cap.ID.String(), fingerprint)
			if err != nil || !found {
				t.Fatal(err)
			}
			var current moveExecution
			if err := decodeChainBCS(f.objects[known.ID].Content, &current); err != nil {
				t.Fatal(err)
			}
			current.StopRequested = true
			current.Cursor++
			f.saveObject(t, current.ID, "node_execution::CommandExecution", current)
			switch mode {
			case "serialized":
				data, _ := json.Marshal(known)
				known = ChainExecution{}
				if err := json.Unmarshal(data, &known); err != nil {
					t.Fatal(err)
				}
			case "wrong ID":
				known.ID = addressNumber(99).String()
			case "wrong fingerprint":
				known.Fingerprint = strings.Repeat("cd", 32)
			case "wrong membership":
				known.MembershipID = addressNumber(99).String()
			case "wrong Host":
				known.HostAddress = addressNumber(99).String()
			case "budget missing":
				delete(f.objects, claim)
			case "changed during read":
				f.reads = make(map[string]int)
				f.changeOnRead = known.ID
			}
			got, found, err := f.resolver.RecheckExecution(context.Background(), known)
			if mode == "stopped" {
				if err != nil || !found || !got.StopRequested || got.Cursor != current.Cursor {
					t.Fatalf("stale checkpoint reused: %+v %v", got, err)
				}
			} else if err == nil || found {
				t.Fatalf("unproven or changed checkpoint admitted: %+v %v", got, err)
			}
		})
	}
}

func executionFixture(t *testing.T, state uint8, claim moveBoundBudgetClaim) (*chainFixture, string, string) {
	t.Helper()
	f := newChainFixture(t)
	pkg := f.resolver.packageID
	fingerprint := strings.Repeat("ab", 32)
	hash, _ := hex.DecodeString(fingerprint)
	run := moveExecution{ID: addressNumber(11), Org: f.cap.Org, Capability: f.cap.ID, CapabilityVersion: 1,
		Human: f.human.ID, Grant: f.grant.ID, GrantVersion: 1, Membership: f.member.ID, Host: f.member.Host,
		Managed: []moveAddress{f.managed.ID}, Delegate: f.cap.Delegate, Node: f.cap.Node, Agent: f.cap.Agent,
		Command: "command-1", Nonce: "nonce-1", Idempotency: "idem-1", IntentHash: hash,
		Action: "start", Scope: "control", BudgetAsset: "MIST", BudgetAmount: 20,
		Issued: 1700000000000, Expires: 1700000060000, State: state, Cursor: 2}
	f.saveObject(t, run.ID, "node_execution::CommandExecution", run)
	index := moveExecutionIndex{Executions: moveTable{ID: addressNumber(12), Size: 1}}
	f.saveField(t, f.cap.ID, structKeyTag(pkg, "node_execution", "ExecutionIndexKey"), []byte{0}, pkg+"::node_execution::ExecutionIndexKey", pkg+"::node_execution::ExecutionIndex", index)
	f.saveField(t, index.Executions.ID, []byte{6, 1}, appendBCSBytes(nil, hash), "vector<u8>", "0x2::object::ID", run.ID)
	claimID := f.saveField(t, f.cap.ID, structKeyTag(pkg, "remote_authority", "BoundBudgetClaimKey"), appendBCSBytes(nil, hash), pkg+"::remote_authority::BoundBudgetClaimKey", pkg+"::remote_authority::BoundBudgetClaim", claim)
	return f, fingerprint, claimID
}

func TestChainExecutionBudgetProjection(t *testing.T) {
	for _, test := range []struct {
		name            string
		state           uint8
		settled         bool
		spent, reserved uint64
	}{
		{"queued reserves", 0, false, 0, 20},
		{"running reserves", 1, false, 0, 20},
		{"success settles actual", 2, true, 7, 0},
		{"failure settles actual", 3, true, 7, 0},
		{"unknown retains reservation", 4, false, 0, 20},
		{"cancelled settles zero", 5, true, 0, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			f, fingerprint, _ := executionFixture(t, test.state, moveBoundBudgetClaim{Reserved: 20, Spent: test.spent, Settled: test.settled})
			got, found, err := f.resolver.LookupExecution(context.Background(), f.cap.ID.String(), fingerprint)
			if err != nil || !found {
				t.Fatalf("lookup found=%v err=%v", found, err)
			}
			if uint64(got.BudgetSpent) != test.spent || uint64(got.BudgetReserved) != test.reserved || got.BudgetSettled != test.settled || got.Budget.Amount != 20 {
				t.Fatalf("bad budget projection %+v", got)
			}
		})
	}
}

func TestChainExecutionRejectsInvalidBudgetLedger(t *testing.T) {
	for _, test := range []struct {
		name  string
		state uint8
		claim moveBoundBudgetClaim
	}{
		{"unknown cannot release", 4, moveBoundBudgetClaim{Reserved: 20, Settled: true}},
		{"terminal must settle", 2, moveBoundBudgetClaim{Reserved: 20}},
		{"running cannot settle", 1, moveBoundBudgetClaim{Reserved: 20, Settled: true}},
		{"reserve must match signed intent", 1, moveBoundBudgetClaim{Reserved: 19}},
		{"spent cannot exceed reserve", 2, moveBoundBudgetClaim{Reserved: 20, Spent: 21, Settled: true}},
		{"unsettled cannot claim cost", 4, moveBoundBudgetClaim{Reserved: 20, Spent: 1}},
	} {
		t.Run(test.name, func(t *testing.T) {
			f, fingerprint, _ := executionFixture(t, test.state, test.claim)
			_, found, err := f.resolver.LookupExecution(context.Background(), f.cap.ID.String(), fingerprint)
			if err == nil || found {
				t.Fatalf("invalid budget accepted: found=%v err=%v", found, err)
			}
		})
	}
}

func TestChainExecutionBudgetSourceAndReadConsistency(t *testing.T) {
	for _, mode := range []string{"missing", "wrong parent", "wrong type", "changed during read", "RPC failure"} {
		t.Run(mode, func(t *testing.T) {
			f, fingerprint, claimID := executionFixture(t, 1, moveBoundBudgetClaim{Reserved: 20})
			object := f.objects[claimID]
			switch mode {
			case "missing":
				delete(f.objects, claimID)
			case "wrong parent":
				object.OwnerID = f.org.ID.String()
				f.objects[claimID] = object
			case "wrong type":
				object.Type = strings.ReplaceAll(object.Type, "BoundBudgetClaim>", "BoundBudgetTotals>")
				f.objects[claimID] = object
			case "changed during read":
				f.changeOnRead = claimID
			case "RPC failure":
				f.fail = true
			}
			_, found, err := f.resolver.LookupExecution(context.Background(), f.cap.ID.String(), fingerprint)
			if err == nil || found {
				t.Fatalf("untrusted ledger accepted: found=%v err=%v", found, err)
			}
		})
	}
}
