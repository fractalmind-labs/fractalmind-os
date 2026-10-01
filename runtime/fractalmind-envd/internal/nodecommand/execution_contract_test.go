package nodecommand

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"testing"
)

const boundaryVector = "23ff5a9204bd4625deb00c95ab445ba3b5a49dba9c378e4be22532c52eedef8d"

func TestExecutionBoundaryHashInterop(t *testing.T) {
	hash, err := ExecutionBoundaryHash(map[string][]string{"file.write": {"."}, "file.read": {"."}})
	if err != nil || hash != boundaryVector {
		t.Fatalf("cross-language boundary: %s %v", hash, err)
	}
	a, err := ExecutionBoundaryHash(map[string][]string{"file.read": {"\U00010000", "\ue000"}})
	if err != nil {
		t.Fatal(err)
	}
	b, err := ExecutionBoundaryHash(map[string][]string{"file.read": {"\ue000", "\U00010000"}})
	if err != nil || a != b {
		t.Fatal("UTF-8 path ordering differs")
	}
	for _, paths := range []map[string][]string{nil, {"shell.exec": {"."}}, {"file.read": {".", "."}}, {"file.read": {}}, {"file.read": {string([]byte{255})}}} {
		if _, err := ExecutionBoundaryHash(paths); err == nil {
			t.Fatalf("invalid boundary accepted: %v", paths)
		}
	}
}
func contractFixture(t *testing.T) (*chainFixture, moveOkr, moveOkrBudget, moveContractBinding) {
	t.Helper()
	f := newChainFixture(t)
	f.cap.Actions = []string{"assign"}
	f.cap.Scope = "control"
	f.cap.BudgetAsset = "TOOL_CALLS"
	f.sync(t)
	hash, _ := hex.DecodeString(boundaryVector)
	okr := moveOkr{ID: addressNumber(20), Org: f.org.ID, Human: f.human.ID, State: 1, Version: 2, Agreement: 1, Metrics: []moveOkrMetric{{Baseline: 0, Target: 1}}, Managed: []moveAddress{f.managed.ID}, ManagedVersion: 1, Membership: []moveAddress{f.member.ID}, MembershipVersion: 1, Workspace: f.managed.Workspace, Boundary: hash, Asset: f.cap.BudgetAsset, Limit: 100, Expiry: f.cap.Expiry}
	budget := moveOkrBudget{Asset: okr.Asset, Claims: moveTable{ID: addressNumber(21)}}
	binding := moveContractBinding{Contract: okr.ID, Agreement: 1, Boundary: hash}
	saveContractFixture(t, f, okr, budget, binding)
	return f, okr, budget, binding
}
func saveContractFixture(t *testing.T, f *chainFixture, okr moveOkr, budget moveOkrBudget, binding moveContractBinding) {
	t.Helper()
	pkg := f.resolver.packageID
	f.saveObject(t, okr.ID, "okr::Okr", okr)
	f.saveField(t, f.cap.ID, structKeyTag(pkg, "remote_authority", "ExecutionContractKey"), []byte{0}, pkg+"::remote_authority::ExecutionContractKey", pkg+"::remote_authority::ExecutionContractBinding", binding)
	f.saveField(t, okr.ID, structKeyTag(pkg, "okr", "BudgetKey"), []byte{0}, pkg+"::okr::BudgetKey", pkg+"::okr::BudgetState", budget)
}
func TestCurrentOkrAuthorityAndSignedBoundary(t *testing.T) {
	f, _, _, _ := contractFixture(t)
	state, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()})
	if err != nil || state.Contract == nil {
		t.Fatalf("resolve: %v %+v", err, state)
	}
	payload := func(kr, version Uint64String, path string) json.RawMessage {
		out, _ := json.Marshal(map[string]any{"okr": ExecutionContractRef{ID: state.Contract.ID, AgreementVersion: version, KRIndex: kr}, "bounds": map[string]any{"paths": map[string][]string{"file.read": {path}, "file.write": {"."}}, "max_calls": Uint64String(10)}})
		return out
	}
	command := NodeCommand{Action: "assign", Scope: "control", Budget: &BudgetClaim{Asset: "TOOL_CALLS", Amount: 10}, Payload: payload(0, 1, ".")}
	if err := ValidateExecutionContract(command, state.Contract); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []json.RawMessage{payload(1, 1, "."), payload(0, 2, "."), payload(0, 1, "private"), nil} {
		command.Payload = raw
		if err := ValidateExecutionContract(command, state.Contract); err == nil {
			t.Fatal("stale/cross-boundary command accepted")
		}
	}
	command.Payload = payload(0, 1, ".")
	if err := ValidateExecutionContract(command, nil); err == nil {
		t.Fatal("self-declared OKR accepted without chain binding")
	}
	next := state
	copied := *state.Contract
	next.Contract = &copied
	next.Contract.KRIndex = 1
	if next.SnapshotHash() == state.SnapshotHash() {
		t.Fatal("cursor not covered by authority snapshot")
	}
}
func TestOkrAuthorityRejectsChangedAgreementAndUntrustedLedger(t *testing.T) {
	for _, test := range []string{"paused", "reapproved", "completed cursor", "workspace", "member", "boundary", "expired", "overspent", "overreserved", "mixed read", "missing ledger", "corrupt binding"} {
		t.Run(test, func(t *testing.T) {
			f, okr, budget, binding := contractFixture(t)
			switch test {
			case "paused":
				okr.State = 2
			case "reapproved":
				okr.Agreement++
			case "completed cursor":
				okr.NextKR = 1
			case "workspace":
				okr.Workspace = make([]byte, 32)
				okr.Workspace[0] = 1
			case "member":
				okr.MembershipVersion++
			case "boundary":
				okr.Boundary = make([]byte, 32)
			case "expired":
				okr.Expiry = 1700000000000
			case "overspent":
				budget.Spent = 101
			case "overreserved":
				budget.Spent = 99
				budget.Reserved = 2
			case "corrupt binding":
				binding.Boundary = nil
			}
			saveContractFixture(t, f, okr, budget, binding)
			if test == "mixed read" {
				f.changeOnRead = okr.ID.String()
			}
			if test == "missing ledger" {
				id, _ := dynamicFieldID(okr.ID.String(), structKeyTag(f.resolver.packageID, "okr", "BudgetKey"), []byte{0})
				delete(f.objects, id)
			}
			if _, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()}); err == nil {
				t.Fatal("invalid current authority accepted")
			}
		})
	}
}
func TestOkrExecutionHistoryRetainsOriginalAgreementAndChecksBothBudgets(t *testing.T) {
	for _, test := range []string{"valid historical", "mismatched spent", "missing global claim", "foreign capability"} {
		t.Run(test, func(t *testing.T) {
			f, fingerprint, _ := executionFixture(t, 2, moveBoundBudgetClaim{Reserved: 20, Spent: 7, Settled: true})
			hash, _ := hex.DecodeString(boundaryVector)
			intent, _ := hex.DecodeString(fingerprint)
			pkg := f.resolver.packageID
			binding := moveContractBinding{Contract: addressNumber(20), Agreement: 1, Boundary: hash}
			okr := moveOkr{ID: binding.Contract, Org: f.org.ID, State: 2, Version: 3, Agreement: 2, Metrics: []moveOkrMetric{{Baseline: 0, Target: 1}}, Managed: []moveAddress{f.managed.ID}, Membership: []moveAddress{f.member.ID}, Workspace: f.managed.Workspace, Boundary: hash, Asset: "MIST", Limit: 100}
			budget := moveOkrBudget{Asset: "MIST", Spent: 7, Claims: moveTable{ID: addressNumber(21)}}
			saveContractFixture(t, f, okr, budget, binding)
			command := moveCommandContract{Contract: okr.ID, Agreement: 1, KR: 0, Boundary: hash}
			f.saveField(t, f.cap.ID, structKeyTag(pkg, "remote_authority", "CommandContractKey"), appendBCSBytes(nil, intent), pkg+"::remote_authority::CommandContractKey", pkg+"::remote_authority::CommandContractBinding", command)
			claim := moveOkrClaim{Capability: f.cap.ID, Agreement: 1, Reserved: 20, Spent: 7, Settled: true}
			if test == "mismatched spent" {
				claim.Spent = 6
			}
			if test == "foreign capability" {
				claim.Capability = addressNumber(99)
			}
			runID := addressNumber(11)
			if test != "missing global claim" {
				f.saveField(t, budget.Claims.ID, structKeyTag("0x2", "object", "ID"), runID[:], "0x2::object::ID", pkg+"::okr::BudgetClaim", claim)
			}
			value, found, err := f.resolver.LookupExecution(context.Background(), f.cap.ID.String(), fingerprint)
			if test == "valid historical" {
				if err != nil || !found || value.Contract == nil || value.Contract.AgreementVersion != 1 {
					t.Fatalf("historical contract: %+v %v", value, err)
				}
			} else if err == nil || found {
				t.Fatal("inconsistent global claim accepted")
			}
		})
	}
}
