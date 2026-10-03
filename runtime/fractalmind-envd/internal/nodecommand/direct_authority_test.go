package nodecommand

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

func directExecutionFixture(t *testing.T) (*chainFixture, moveDirectPermission, moveDirectCapability, NodeCommand, moveDirectMessage, moveDirectClaim) {
	t.Helper()
	f, p, b := directFixture(t)
	command := NodeCommand{Version: "1", CommandID: "direct-fixture", Signer: f.cap.Delegate.String(), Target: Target{OrganizationID: p.Org.String(), NodeID: f.cap.Node, AgentID: f.cap.Agent}, Action: "direct.message", Scope: "direct", Capability: CapabilityRef{ID: f.cap.ID.String(), RevocationVersion: 1}, Nonce: "nonce", IdempotencyKey: "idem", IssuedAtMS: 1700000000000, ExpiresAtMS: int64(p.Expiry), Budget: &BudgetClaim{Asset: "TOOL_CALLS", Amount: 3}}
	payload := map[string]any{"message": "请检查文件", "task": "ensure .probe.txt exists", "bounds": map[string]any{"paths": map[string][]string{"file.read": {"."}, "file.write": {"."}}, "max_calls": "3"}, "direct": map[string]any{"version": "1", "permission_id": p.ID.String(), "permission_version": "1", "message_id": addressNumber(40).String(), "conversation_id": "conv", "message_token": "token", "message_record_id": addressNumber(41).String(), "action": "file.write"}}
	command.Payload, _ = json.Marshal(payload)
	command.PayloadHash = HashPayload(command.Payload)
	signing, err := command.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	intent := sha256.Sum256(signing)
	run := moveExecution{ID: addressNumber(42), Org: p.Org, Capability: f.cap.ID, CapabilityVersion: 1, Human: p.Human, Grant: f.grant.ID, GrantVersion: 1, Membership: p.Membership, Host: p.Host, Managed: []moveAddress{p.Managed}, Delegate: f.cap.Delegate, Node: f.cap.Node, Agent: f.cap.Agent, Command: command.CommandID, Nonce: command.Nonce, Idempotency: command.IdempotencyKey, IntentHash: intent[:], Action: command.Action, Scope: command.Scope, BudgetAsset: "TOOL_CALLS", BudgetAmount: 3, Issued: uint64(command.IssuedAtMS), Expires: uint64(command.ExpiresAtMS)}
	f.saveObject(t, run.ID, "node_execution::CommandExecution", run)
	core := f.resolver.packageID
	index := moveExecutionIndex{Executions: moveTable{ID: addressNumber(43), Size: 1}}
	f.saveField(t, f.cap.ID, structKeyTag(core, "node_execution", "ExecutionIndexKey"), []byte{0}, core+"::node_execution::ExecutionIndexKey", core+"::node_execution::ExecutionIndex", index)
	f.saveField(t, index.Executions.ID, []byte{6, 1}, appendBCSBytes(nil, intent[:]), "vector<u8>", "0x2::object::ID", run.ID)
	f.saveField(t, f.cap.ID, structKeyTag(core, "remote_authority", "BoundBudgetClaimKey"), appendBCSBytes(nil, intent[:]), core+"::remote_authority::BoundBudgetClaimKey", core+"::remote_authority::BoundBudgetClaim", moveBoundBudgetClaim{Reserved: 3})
	f.saveField(t, f.cap.ID, structKeyTag(core, "remote_authority", "CommandContractKey"), appendBCSBytes(nil, intent[:]), core+"::remote_authority::CommandContractKey", core+"::remote_authority::CommandContractBinding", moveCommandContract{Contract: p.ID, Agreement: 1, Boundary: p.Boundary})
	saveDirectField(t, f, f.cap.ID, intent[:], "DirectCommandBinding", moveDirectCommand{Permission: p.ID, Version: 1, Message: addressNumber(40)})
	claim := moveDirectClaim{Capability: f.cap.ID, Message: addressNumber(40), Version: 1, Reserved: 3}
	p.Reserved = 3
	saveDirectPolicy(t, f, p, b, p.Boundary)
	f.saveField(t, p.Claims.ID, structKeyTag("0x2", "object", "ID"), run.ID[:], "0x2::object::ID", f.resolver.directPackageID+"::direct_agent::DirectClaim", claim)
	f.saveField(t, p.Runs.ID, structKeyTag("0x2", "object", "ID"), claim.Message[:], "0x2::object::ID", "0x2::object::ID", run.ID)
	f.saveField(t, p.Messages.ID, structKeyTag("0x1", "string", "String"), appendBCSBytes(nil, []byte("token")), "0x1::string::String", "0x2::object::ID", claim.Message)
	var parsed DirectRequestPayload
	json.Unmarshal(command.Payload, &parsed)
	hash, _ := DirectRequestHash(parsed)
	request, _ := hex.DecodeString(hash)
	message := moveDirectMessage{ID: claim.Message, Org: p.Org, Permission: p.ID, PermissionVersion: 1, Managed: p.Managed, ManagedVersion: 1, Membership: p.Membership, Conversation: "conv", Token: "token", Action: "file.write", Boundary: p.Boundary, Amount: 3, RequestHash: request, Human: p.Human, Generation: 1, Device: f.cap.Delegate, Grant: f.grant.ID, GrantVersion: 1, Created: uint64(command.IssuedAtMS), Expiry: p.Expiry, Record: addressNumber(41)}
	saveDirectObject(t, f, message.ID, "Message", message, true)
	record := moveEncryptedRecord{ID: message.Record, Org: p.Org, Kind: 6, LogicalID: "direct-message-token", Revision: 1, KeyVersion: 1, Human: p.Human, Device: f.cap.Delegate, Grant: f.grant.ID, GrantVersion: 1, CreatedMS: message.Created}
	f.saveObject(t, record.ID, "product_record::EncryptedRecord", record)
	object := f.objects[record.ID.String()]
	object.Shared = false
	object.Immutable = true
	f.objects[object.ID] = object
	return f, p, b, command, message, claim
}

func TestDirectOriginalRunAndImmutableContent(t *testing.T) {
	for _, mode := range []string{"valid", "claim spent differs", "claim reservation missing", "source mutable", "record replaced", "record author", "message directory", "different signed text", "different signed budget", "mixed read", "historical policy changed"} {
		t.Run(mode, func(t *testing.T) {
			f, p, b, command, message, claim := directExecutionFixture(t)
			signing, _ := command.SigningBytes()
			h := sha256.Sum256(signing)
			fingerprint := hex.EncodeToString(h[:])
			// Always prove the positive baseline before applying the mutation.
			state, err := f.resolver.Resolve(context.Background(), command.Capability)
			if err != nil {
				t.Fatal(err)
			}
			if err = f.resolver.ValidateDirectCommand(context.Background(), command, state); err != nil {
				t.Fatal(err)
			}
			switch mode {
			case "claim spent differs":
				claimRunID := addressNumber(42)
				claim.Spent = 1
				f.saveField(t, p.Claims.ID, structKeyTag("0x2", "object", "ID"), claimRunID[:], "0x2::object::ID", f.resolver.directPackageID+"::direct_agent::DirectClaim", claim)
			case "claim reservation missing":
				p.Reserved = 0
				saveDirectPolicy(t, f, p, b, p.Boundary)
			case "source mutable":
				o := f.objects[message.ID.String()]
				o.Immutable = false
				o.Shared = true
				f.objects[o.ID] = o
			case "record replaced":
				o := f.objects[message.Record.String()]
				o.Type = f.resolver.directPackageID + "::product_record::EncryptedRecord"
				f.objects[o.ID] = o
			case "record author":
				var record moveEncryptedRecord
				decodeChainBCS(f.objects[message.Record.String()].Content, &record)
				record.Device = addressNumber(80)
				f.saveObject(t, record.ID, "product_record::EncryptedRecord", record)
				o := f.objects[record.ID.String()]
				o.Shared = false
				o.Immutable = true
				f.objects[o.ID] = o
			case "message directory":
				f.saveField(t, p.Messages.ID, structKeyTag("0x1", "string", "String"), appendBCSBytes(nil, []byte(message.Token)), "0x1::string::String", "0x2::object::ID", addressNumber(80))
			case "different signed text":
				var value map[string]any
				json.Unmarshal(command.Payload, &value)
				value["message"] = "different instruction"
				command.Payload, _ = json.Marshal(value)
				command.PayloadHash = HashPayload(command.Payload)
			case "different signed budget":
				command.Budget.Amount = 2
			case "mixed read":
				f.reads = map[string]int{}
				f.changeOnRead = message.ID.String()
			case "historical policy changed":
				p.Version++
				p.Revoked = true
				saveDirectPolicy(t, f, p, b, p.Boundary)
			}
			if mode == "valid" {
				return
			}
			if mode == "historical policy changed" {
				run, found, err := f.resolver.LookupExecution(context.Background(), f.cap.ID.String(), fingerprint)
				if err != nil || !found || run.Direct == nil || run.Direct.PermissionVersion != 1 {
					t.Fatalf("lost original version: %v", err)
				}
				if _, err = f.resolver.Resolve(context.Background(), command.Capability); CodeOf(err) != CodeRevoked {
					t.Fatalf("old authority remained current: %v", err)
				}
			} else if err = f.resolver.ValidateDirectCommand(context.Background(), command, state); err == nil {
				t.Fatal("substituted original claim or signed request accepted")
			}
		})
	}
}

func saveDirectObject(t *testing.T, f *chainFixture, id moveAddress, kind string, value any, immutable bool) {
	t.Helper()
	f.saveObject(t, id, "direct_agent::"+kind, value)
	obj := f.objects[id.String()]
	obj.Type = f.resolver.directPackageID + "::direct_agent::" + kind
	obj.Immutable = immutable
	obj.Shared = !immutable
	f.objects[obj.ID] = obj
}
func saveDirectField(t *testing.T, f *chainFixture, parent moveAddress, tag []byte, kind string, value any) string {
	core, ext := f.resolver.packageID, f.resolver.directPackageID
	return f.saveField(t, parent, extensionFieldTag(core, ext), appendBCSBytes(nil, tag), core+"::execution_extension::FieldKey<"+ext+"::direct_agent::Witness>", ext+"::direct_agent::"+kind, value)
}
func saveDirectPolicy(t *testing.T, f *chainFixture, p moveDirectPermission, b moveDirectCapability, boundary []byte) {
	t.Helper()
	core, ext := f.resolver.packageID, f.resolver.directPackageID
	saveDirectObject(t, f, p.ID, "StandingPermission", p, false)
	saveDirectField(t, f, f.cap.ID, []byte("permission"), "PermissionCapability", b)
	f.saveField(t, f.cap.ID, structKeyTag(core, "remote_authority", "ExecutionContractKey"), []byte{0}, core+"::remote_authority::ExecutionContractKey", core+"::remote_authority::ExecutionContractBinding", moveContractBinding{Contract: p.ID, Agreement: b.Version, Boundary: boundary})
	f.saveField(t, f.cap.ID, structKeyTag(core, "execution_extension", "SourceKey"), []byte{0}, core+"::execution_extension::SourceKey", core+"::execution_extension::ExtensionSource", moveExtensionSource{Source: strings.TrimPrefix(ext, "0x") + "::direct_agent::Witness"})
	index := movePermissionIndex{Source: strings.TrimPrefix(ext, "0x") + "::direct_agent::Witness", Agents: moveTable{ID: addressNumber(27)}}
	f.saveField(t, p.Org, structKeyTag(core, "execution_extension", "IndexKey"), []byte{0}, core+"::execution_extension::IndexKey", core+"::execution_extension::PermissionIndex", index)
	f.saveField(t, index.Agents.ID, structKeyTag("0x2", "object", "ID"), p.Managed[:], "0x2::object::ID", "0x2::object::ID", p.ID)
}
func directFixture(t *testing.T) (*chainFixture, moveDirectPermission, moveDirectCapability) {
	t.Helper()
	f := newChainFixture(t)
	f.resolver.directPackageID = addressNumber(99).String()
	f.cap.Actions = []string{"direct.message"}
	f.cap.Scope = "direct"
	f.cap.BudgetAsset = "TOOL_CALLS"
	f.cap.MaxBudget = 6
	f.sync(t)
	hash, _ := hex.DecodeString(boundaryVector)
	p := moveDirectPermission{ID: addressNumber(20), Org: f.org.ID, Human: f.human.ID, Generation: 1, Managed: f.managed.ID, ManagedVersion: 1, Membership: f.member.ID, MembershipVersion: 1, Host: f.member.Host, Workspace: f.managed.Workspace, Version: 1, Actions: []string{"ask", "status", "file.read", "file.write"}, Boundary: hash, MaxCalls: 3, Limit: 6, Expiry: f.cap.Expiry, Messages: moveTable{ID: addressNumber(21)}, Approvals: moveTable{ID: addressNumber(22)}, Runs: moveTable{ID: addressNumber(23)}, Claims: moveTable{ID: addressNumber(24)}}
	b := moveDirectCapability{Permission: p.ID, Version: 1}
	saveDirectPolicy(t, f, p, b, hash)
	return f, p, b
}
func TestDirectContentHashMatchesSdk(t *testing.T) {
	for _, tc := range []struct{ action, calls, task, want string }{
		{"file.write", "3", "ensure .probe.txt exists", "60a90a2e370de16c9f3604ae205b19469f5d8f9879f52e1ed13fec23c7dbec80"},
		{"status", "0", "", "f55703706f2e249f3d55d006204ab33f6be1ad78527739a35183d536d093d758"},
	} {
		raw, _ := json.Marshal(map[string]any{"message": "请检查文件", "task": tc.task, "direct": map[string]any{"action": tc.action}, "bounds": map[string]any{"paths": map[string][]string{"file.read": {"."}, "file.write": {"."}}, "max_calls": tc.calls}})
		var p DirectRequestPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			t.Fatal(err)
		}
		hash, err := DirectRequestHash(p)
		if err != nil || hash != tc.want {
			t.Fatalf("SDK hash mismatch: %s %v", hash, err)
		}
	}
}
func TestDirectCurrentPermissionAndSourceBinding(t *testing.T) {
	f, p, _ := directFixture(t)
	state, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()})
	if err != nil || state.Direct == nil || state.Direct.ID != p.ID.String() || state.Contract != nil || state.Handover != nil {
		t.Fatalf("direct mistaken for OKR: %+v %v", state, err)
	}
	if state.Direct.Version != 1 || state.Direct.MaxCalls != 3 || state.Direct.BoundaryHash != boundaryVector {
		t.Fatal("incorrect direct bounds")
	}
	next := state
	d := *state.Direct
	next.Direct = &d
	d.Version++
	if next.SnapshotHash() == state.SnapshotHash() {
		t.Fatal("direct version absent from authority snapshot")
	}
}
func TestDirectPermissionRejectsChangedSources(t *testing.T) {
	for _, mode := range []string{"revoked", "version", "generation", "instance", "member", "workspace", "expiry", "overspent", "overreserved", "wrong type origin", "wrong directory", "wrong witness", "mixed read", "RPC failure", "missing"} {
		t.Run(mode, func(t *testing.T) {
			f, p, b := directFixture(t)
			switch mode {
			case "revoked":
				p.Revoked = true
			case "version":
				p.Version++
			case "generation":
				p.Generation++
			case "instance":
				p.ManagedVersion++
			case "member":
				p.MembershipVersion++
			case "workspace":
				p.Workspace = make([]byte, 32)
				p.Workspace[0] = 1
			case "expiry":
				p.Expiry = 1700000000000
			case "overspent":
				p.Spent = 7
			case "overreserved":
				p.Spent = 5
				p.Reserved = 2
			case "mixed read":
				f.changeOnRead = p.ID.String()
			case "RPC failure":
				f.fail = true
			}
			saveDirectPolicy(t, f, p, b, p.Boundary)
			switch mode {
			case "wrong type origin":
				obj := f.objects[p.ID.String()]
				obj.Type = f.resolver.packageID + "::direct_agent::StandingPermission"
				f.objects[obj.ID] = obj
			case "missing":
				delete(f.objects, p.ID.String())
			case "wrong directory":
				f.saveField(t, addressNumber(27), structKeyTag("0x2", "object", "ID"), p.Managed[:], "0x2::object::ID", "0x2::object::ID", addressNumber(60))
			case "wrong witness":
				core := f.resolver.packageID
				f.saveField(t, f.cap.ID, structKeyTag(core, "execution_extension", "SourceKey"), []byte{0}, core+"::execution_extension::SourceKey", core+"::execution_extension::ExtensionSource", moveExtensionSource{Source: "other::Witness"})
			}
			if _, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()}); err == nil {
				t.Fatal("invalid direct source authorized")
			}
		})
	}
}
func TestDirectWorkspaceProtectionAndUnknownTransport(t *testing.T) {
	f, p, _ := directFixture(t)
	core := f.resolver.packageID
	entries := moveActiveAssignments{Total: 1, Revision: 3, Agents: moveTable{ID: addressNumber(51)}, Workspaces: moveTable{ID: addressNumber(52)}}
	f.saveField(t, p.Org, structKeyTag(core, "execution_extension", "ActiveAssignmentsKey"), []byte{0}, core+"::execution_extension::ActiveAssignmentsKey", core+"::execution_extension::ActiveAssignments", entries)
	key := appendBCSBytes(append([]byte(nil), p.Host[:]...), p.Workspace)
	f.saveField(t, entries.Workspaces.ID, structKeyTag(core, "execution_extension", "WorkspaceKey"), key, core+"::execution_extension::WorkspaceKey", "u64", uint64(1))
	state, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()})
	if err != nil || !state.Direct.WorkspaceProtected || state.Direct.WorkspaceRevision != 3 {
		t.Fatalf("sibling instance workspace protection missing: %v", err)
	}
	f.fail = true
	if _, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()}); err == nil {
		t.Fatal("RPC error converted to free workspace")
	}
}
func TestDirectSingleApprovalRequiresCurrentApprover(t *testing.T) {
	for _, mode := range []string{"valid", "grant revoked", "grant revision", "grant expired", "grant wrong scope", "no approve", "workspace changed", "approval replaced"} {
		t.Run(mode, func(t *testing.T) {
			f, p, b := directFixture(t)
			approver := moveGrant{ID: addressNumber(61), Human: f.human.ID, Device: addressNumber(62), Actions: []byte{3}, Version: 1, Generation: 1, Expiry: p.Expiry}
			approval := moveDirectApproval{ID: addressNumber(60), Org: p.Org, Permission: p.ID, PermissionVersion: 1, Message: addressNumber(40), Managed: p.Managed, ManagedVersion: 1, Action: "file.write", Boundary: p.Boundary, Amount: 5, State: 3, Expiry: p.Expiry, Device: approver.Device, Grant: []moveAddress{approver.ID}, GrantVersion: 1, Generation: 1}
			b.Approval = []moveAddress{approval.ID}
			f.cap.MaxBudget = 5
			f.cap.MaxUses = 1
			f.sync(t)
			switch mode {
			case "grant revoked":
				approver.Revoked = true
			case "grant revision":
				approver.Version++
			case "grant expired":
				approver.Expiry = 1700000000000
			case "grant wrong scope":
				approver.Org = []moveAddress{addressNumber(98)}
			case "no approve":
				approver.Actions = []byte{1, 2}
			case "workspace changed":
				approval.WorkspaceRevision = 1
			case "approval replaced":
				approval.PermissionVersion++
			}
			saveDirectPolicy(t, f, p, b, p.Boundary)
			saveDirectObject(t, f, approval.ID, "Approval", approval, false)
			f.saveObject(t, approver.ID, "identity::DeviceGrant", approver)
			state, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()})
			if mode == "valid" {
				if err != nil || state.Direct.ApprovingGrantID != approver.ID.String() || state.Direct.MaxCalls != 5 || state.Direct.ApprovedMessageID != approval.Message.String() {
					t.Fatalf("valid approval: %v", err)
				}
			} else if err == nil {
				t.Fatal("invalid approving authority accepted")
			}
		})
	}
}
func TestDirectPayloadScopeBudgetAndApproval(t *testing.T) {
	f, _, _ := directFixture(t)
	state, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()})
	if err != nil {
		t.Fatal(err)
	}
	base := map[string]any{"message": "请检查文件", "task": "ensure .probe.txt exists", "bounds": map[string]any{"paths": map[string][]string{"file.read": {"."}, "file.write": {"."}}, "max_calls": "3"}, "direct": map[string]any{"version": "1", "permission_id": state.Direct.ID, "permission_version": "1", "message_id": addressNumber(40).String(), "conversation_id": "conv", "message_token": "token", "message_record_id": addressNumber(41).String(), "action": "file.write"}}
	for _, mode := range []string{"valid", "unbound", "wrong scope", "no instance", "unknown field", "wrong budget", "wrong asset", "workspace protected", "wrong version", "wrong record", "wrong action"} {
		t.Run(mode, func(t *testing.T) {
			raw, _ := json.Marshal(base)
			var value map[string]any
			json.Unmarshal(raw, &value)
			command := NodeCommand{Target: state.Target, Action: "direct.message", Scope: "direct", Budget: &BudgetClaim{Asset: "TOOL_CALLS", Amount: 3}}
			copy := *state.Direct
			authority := &copy
			switch mode {
			case "unbound":
				authority = nil
			case "wrong scope":
				command.Scope = "control"
			case "no instance":
				command.Target.AgentID = ""
			case "unknown field":
				value["okr"] = map[string]any{"id": "self"}
			case "wrong budget":
				command.Budget.Amount = 5
			case "wrong asset":
				command.Budget.Asset = "SUI"
			case "workspace protected":
				copy.WorkspaceProtected = true
			case "wrong version":
				value["direct"].(map[string]any)["permission_version"] = "2"
			case "wrong record":
				value["direct"].(map[string]any)["message_record_id"] = "0x1"
			case "wrong action":
				value["direct"].(map[string]any)["action"] = "shell.exec"
			}
			command.Payload, _ = json.Marshal(value)
			_, err := ParseDirectRequest(command, authority)
			if mode == "valid" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil {
				t.Fatal("invalid signed direct request accepted")
			}
		})
	}
}
