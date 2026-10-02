package nodecommand

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"slices"
	"strings"
	"unicode/utf8"
)

// Direct permissions and one-use approvals have their own ledger. Historical
// claims remain authentic after the permission changes, without authorizing
// another operation under that old version.
type DirectPermissionAuthority struct {
	ID, BoundaryHash, ApprovalID, ApprovingGrantID, ApprovedMessageID string
	Version, MaxCalls, WorkspaceRevision                              Uint64String
	Actions                                                           []string
	WorkspaceProtected                                                bool
}
type DirectCommandAuthority interface {
	ValidateDirectCommand(context.Context, NodeCommand, CapabilityState) error
}
type DirectMessageRef struct {
	Version           string       `json:"version"`
	PermissionID      string       `json:"permission_id"`
	PermissionVersion Uint64String `json:"permission_version"`
	MessageID         string       `json:"message_id"`
	ConversationID    string       `json:"conversation_id"`
	MessageToken      string       `json:"message_token"`
	MessageRecordID   string       `json:"message_record_id"`
	Action            string       `json:"action"`
	ApprovalID        string       `json:"approval_id,omitempty"`
	ApprovingGrantID  string       `json:"approving_grant_id,omitempty"`
}
type DirectRequestPayload struct {
	Message string `json:"message"`
	Task    string `json:"task,omitempty"`
	Bounds  *struct {
		Paths    map[string][]string `json:"paths"`
		MaxCalls Uint64String        `json:"max_calls"`
	} `json:"bounds"`
	Direct *DirectMessageRef `json:"direct"`
}
type moveDirectPermission struct {
	ID, Org, Human                        moveAddress
	Generation                            uint64
	Managed                               moveAddress
	ManagedVersion                        uint64
	Membership                            moveAddress
	MembershipVersion                     uint64
	Host                                  moveAddress
	Workspace                             []byte
	Version                               uint64
	Revoked                               bool
	Actions                               []string
	Boundary                              []byte
	MaxCalls, Limit, Spent, Reserved      uint64
	ApprovedSpent, ApprovedReserved       uint64
	Expiry                                uint64
	ApprovedDevice, ApprovedGrant, Record moveAddress
	RecordRevision                        uint64
	Messages, Approvals, Runs, Claims     moveTable
}
type moveDirectCapability struct {
	Permission moveAddress
	Version    uint64
	Approval   []moveAddress
}
type moveDirectCommand struct {
	Permission moveAddress
	Version    uint64
	Message    moveAddress
	Approval   []moveAddress
}
type moveDirectMessage struct {
	ID, Org, Permission           moveAddress
	PermissionVersion             uint64
	Managed                       moveAddress
	ManagedVersion                uint64
	Membership                    moveAddress
	Conversation, Token, Action   string
	Boundary                      []byte
	Amount                        uint64
	RequestHash                   []byte
	Human                         moveAddress
	Generation                    uint64
	Device, Grant                 moveAddress
	GrantVersion, Created, Expiry uint64
	Record                        moveAddress
}
type moveDirectApproval struct {
	ID, Org, Permission       moveAddress
	PermissionVersion         uint64
	Message, Managed          moveAddress
	ManagedVersion            uint64
	Action                    string
	Boundary                  []byte
	Amount, WorkspaceRevision uint64
	State                     uint8
	Expiry                    uint64
	Device                    moveAddress
	Grant                     []moveAddress
	GrantVersion, Generation  uint64
	Record                    moveAddress
}
type moveDirectClaim struct {
	Capability, Message moveAddress
	Version             uint64
	Approval            []moveAddress
	Reserved, Spent     uint64
	Settled             bool
}
type moveExtensionSource struct{ Source string }
type movePermissionIndex struct {
	Source string
	Agents moveTable
}
type moveActiveAssignments struct {
	Total, Revision    uint64
	Agents, Workspaces moveTable
}

func directAction(a string) bool {
	return a == "ask" || a == "status" || a == "file.read" || a == "file.write"
}
func directNoTools(a string) bool { return a == "ask" || a == "status" }
func extensionFieldTag(core, ext string) []byte {
	tag := structKeyTag(core, "execution_extension", "FieldKey")
	tag[len(tag)-1] = 1
	return append(tag, structKeyTag(ext, "direct_agent", "Witness")...)
}
func (r *chainRead) directField(ctx context.Context, parent string, tag []byte, kind string, out any) error {
	core, ext := r.resolver.packageID, r.resolver.directPackageID
	return r.field(ctx, parent, extensionFieldTag(core, ext), appendBCSBytes(nil, tag),
		core+"::execution_extension::FieldKey<"+ext+"::direct_agent::Witness>", ext+"::direct_agent::"+kind, out)
}
func (r *chainRead) directPermission(ctx context.Context, cap moveCapability) (moveDirectPermission, moveDirectCapability, *moveContractBinding, error) {
	var p moveDirectPermission
	var b moveDirectCapability
	if err := r.directField(ctx, cap.ID.String(), []byte("permission"), "PermissionCapability", &b); err != nil {
		return p, b, nil, err
	}
	if b.Version == 0 || len(b.Approval) > 1 {
		return p, b, nil, fmt.Errorf("invalid direct capability binding")
	}
	if err := r.object(ctx, b.Permission.String(), "direct_agent::StandingPermission", &p); err != nil {
		return p, b, nil, err
	}
	if p.Version == 0 || len(p.Boundary) != 32 || len(p.Workspace) != 32 || len(p.Actions) > 4 || p.MaxCalls > 1000 || p.MaxCalls > p.Limit || p.Spent > p.Limit || p.Reserved > p.Limit-p.Spent {
		return p, b, nil, fmt.Errorf("invalid direct permission layout or ledger")
	}
	seen := map[string]bool{}
	for _, a := range p.Actions {
		if !directAction(a) || seen[a] {
			return p, b, nil, fmt.Errorf("invalid permission actions")
		}
		seen[a] = true
	}
	contract, err := r.contractBinding(ctx, cap.ID.String())
	if err != nil {
		return p, b, nil, err
	}
	if contract == nil || contract.Contract != p.ID || contract.Agreement != b.Version {
		return p, b, nil, fmt.Errorf("direct and core contract bindings disagree")
	}
	core, ext := r.resolver.packageID, r.resolver.directPackageID
	var source moveExtensionSource
	if err = r.field(ctx, cap.ID.String(), structKeyTag(core, "execution_extension", "SourceKey"), []byte{0}, core+"::execution_extension::SourceKey", core+"::execution_extension::ExtensionSource", &source); err != nil {
		return p, b, nil, err
	}
	expected := strings.TrimPrefix(ext, "0x") + "::direct_agent::Witness"
	if source.Source != expected {
		return p, b, nil, fmt.Errorf("direct capability extension source mismatch")
	}
	var index movePermissionIndex
	if err = r.field(ctx, p.Org.String(), structKeyTag(core, "execution_extension", "IndexKey"), []byte{0}, core+"::execution_extension::IndexKey", core+"::execution_extension::PermissionIndex", &index); err != nil {
		return p, b, nil, err
	}
	if index.Source != expected {
		return p, b, nil, fmt.Errorf("direct directory extension source mismatch")
	}
	var pointer moveAddress
	if err = r.field(ctx, index.Agents.ID.String(), structKeyTag("0x2", "object", "ID"), p.Managed[:], "0x2::object::ID", "0x2::object::ID", &pointer); err != nil {
		return p, b, nil, err
	}
	if pointer != p.ID {
		return p, b, nil, fmt.Errorf("direct directory permission mismatch")
	}
	return p, b, contract, nil
}
func (r *chainRead) directWorkspace(ctx context.Context, p moveDirectPermission) (bool, uint64, error) {
	core := r.resolver.packageID
	var entries moveActiveAssignments
	err := r.field(ctx, p.Org.String(), structKeyTag(core, "execution_extension", "ActiveAssignmentsKey"), []byte{0}, core+"::execution_extension::ActiveAssignmentsKey", core+"::execution_extension::ActiveAssignments", &entries)
	if errors.Is(err, ErrChainObjectNotFound) {
		return false, 0, nil
	}
	if err != nil {
		return false, 0, err
	}
	if entries.Revision == 0 {
		return false, 0, fmt.Errorf("invalid workspace revision")
	}
	var agentCount, workspaceCount uint64
	err = r.field(ctx, entries.Agents.ID.String(), structKeyTag("0x2", "object", "ID"), p.Managed[:], "0x2::object::ID", "u64", &agentCount)
	if err != nil && !errors.Is(err, ErrChainObjectNotFound) {
		return false, 0, err
	}
	key := appendBCSBytes(append([]byte(nil), p.Host[:]...), p.Workspace)
	err = r.field(ctx, entries.Workspaces.ID.String(), structKeyTag(core, "execution_extension", "WorkspaceKey"), key, core+"::execution_extension::WorkspaceKey", "u64", &workspaceCount)
	if err != nil && !errors.Is(err, ErrChainObjectNotFound) {
		return false, 0, err
	}
	return agentCount > 0 || workspaceCount > 0, entries.Revision, nil
}
func (r *chainRead) currentDirect(ctx context.Context, cap moveCapability, auth moveAuthorityBinding, instance *ManagedInstanceAuthority, now uint64) (*DirectPermissionAuthority, uint64, error) {
	p, b, contract, err := r.directPermission(ctx, cap)
	if err != nil {
		return nil, 0, err
	}
	if cap.MaxBudget == 0 && cap.BudgetAsset != "" || cap.MaxBudget > 0 && cap.BudgetAsset != "TOOL_CALLS" {
		return nil, 0, fmt.Errorf("direct capability has an invalid tool asset")
	}
	if p.Revoked || p.Version != b.Version {
		return nil, 0, reject(CodeRevoked, "direct permission changed or revoked", nil)
	}
	if p.Expiry > math.MaxInt64 || now >= p.Expiry {
		return nil, 0, reject(CodeExpired, "direct permission expired", nil)
	}
	if cap.Scope != "direct" || len(cap.Actions) != 1 || cap.Actions[0] != "direct.message" || p.Org != cap.Org || p.Human != auth.Human || p.Generation != auth.Generation || instance == nil || p.Managed.String() != instance.ID || p.ManagedVersion != uint64(instance.Version) || p.Membership != auth.Membership || p.MembershipVersion != auth.MembershipVersion || p.Host.String() != cap.Node || hex.EncodeToString(p.Workspace) != instance.WorkspaceHash || cap.Expiry > p.Expiry {
		return nil, 0, reject(CodeWrongTarget, "direct identity, membership or instance binding changed", nil)
	}
	protected, revision, err := r.directWorkspace(ctx, p)
	if err != nil {
		return nil, 0, err
	}
	a := &DirectPermissionAuthority{ID: p.ID.String(), Version: Uint64String(p.Version), BoundaryHash: hex.EncodeToString(contract.Boundary), MaxCalls: Uint64String(p.MaxCalls), Actions: append([]string(nil), p.Actions...), WorkspaceProtected: protected, WorkspaceRevision: Uint64String(revision)}
	expiry := p.Expiry
	if len(b.Approval) == 0 {
		if !bytes.Equal(contract.Boundary, p.Boundary) || cap.MaxBudget > p.Limit || cap.MaxBudget > 0 && cap.BudgetAsset != "TOOL_CALLS" {
			return nil, 0, fmt.Errorf("standing capability boundary/budget mismatch")
		}
	} else {
		var approval moveDirectApproval
		if err = r.object(ctx, b.Approval[0].String(), "direct_agent::Approval", &approval); err != nil {
			return nil, 0, err
		}
		if approval.State != 1 && approval.State != 3 || approval.Org != p.Org || approval.Permission != p.ID || approval.PermissionVersion != p.Version || approval.Managed != p.Managed || approval.ManagedVersion != p.ManagedVersion || approval.Generation != p.Generation || len(approval.Grant) != 1 || !directAction(approval.Action) || !bytes.Equal(approval.Boundary, contract.Boundary) || approval.Amount > 1000 || cap.MaxBudget != approval.Amount || cap.MaxUses != 1 {
			return nil, 0, reject(CodeRevoked, "single-use direct approval changed", nil)
		}
		if approval.Expiry > p.Expiry || now >= approval.Expiry || cap.Expiry > approval.Expiry {
			return nil, 0, reject(CodeExpired, "single-use direct approval expired", nil)
		}
		if approval.Action == "file.write" && approval.WorkspaceRevision != revision {
			return nil, 0, reject(CodeRevoked, "workspace changed since direct approval", nil)
		}
		var grant moveGrant
		if err = r.object(ctx, approval.Grant[0].String(), "identity::DeviceGrant", &grant); err != nil {
			return nil, 0, err
		}
		var human moveHuman
		if err = r.object(ctx, p.Human.String(), "identity::HumanIdentity", &human); err != nil {
			return nil, 0, err
		}
		var org moveOrganization
		if err = r.object(ctx, p.Org.String(), "organization::Organization", &org); err != nil {
			return nil, 0, err
		}
		var role moveRole
		if err = r.field(ctx, human.Roles.ID.String(), structKeyTag("0x2", "object", "ID"), p.Org[:], "0x2::object::ID", r.resolver.packageID+"::identity::OrgRole", &role); err != nil {
			return nil, 0, err
		}
		if grant.Human != p.Human || grant.Device != approval.Device || grant.Version != approval.GrantVersion || grant.Revoked || grant.Generation != p.Generation || len(grant.Org) > 1 || len(grant.Org) == 1 && grant.Org[0] != p.Org || !containsByte(grant.Actions, 3) || grant.Expiry > math.MaxInt64 || now >= grant.Expiry || !role.Active || !role.Admin || role.Owner != org.Admin {
			return nil, 0, reject(CodeRevoked, "approving device or organization authority changed", nil)
		}
		a.ApprovalID = approval.ID.String()
		a.ApprovingGrantID = grant.ID.String()
		a.ApprovedMessageID = approval.Message.String()
		a.MaxCalls = Uint64String(approval.Amount)
		a.Actions = []string{approval.Action}
		expiry = min(expiry, approval.Expiry, grant.Expiry)
	}
	return a, expiry, nil
}

// Match the SDK's BCS content commitment, independently of the command payload
// hash. A valid signature cannot substitute text for another stored message.
func DirectRequestHash(p DirectRequestPayload) (string, error) {
	if p.Direct == nil || p.Bounds == nil || !directAction(p.Direct.Action) || !utf8.ValidString(p.Message) || len(p.Message) == 0 || len(p.Message) > 4096 || !utf8.ValidString(p.Task) || len(p.Task) > 16384 || uint64(p.Bounds.MaxCalls) > 1000 || directNoTools(p.Direct.Action) != (p.Bounds.MaxCalls == 0) || directNoTools(p.Direct.Action) && p.Task != "" {
		return "", fmt.Errorf("invalid direct request text, action or budget")
	}
	boundary, err := ExecutionBoundaryHash(p.Bounds.Paths)
	if err != nil {
		return "", err
	}
	hashBytes, _ := hex.DecodeString(boundary)
	b := append([]byte("fractalmind.direct-request.v1"), 1)
	b = appendBCSBytes(b, []byte(p.Direct.Action))
	b = appendBCSBytes(b, []byte(p.Message))
	b = appendBCSBytes(b, []byte(p.Task))
	b = appendBCSBytes(b, hashBytes)
	b = binary.LittleEndian.AppendUint64(b, uint64(p.Bounds.MaxCalls))
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:]), nil
}
func ParseDirectRequest(command NodeCommand, authority *DirectPermissionAuthority) (DirectRequestPayload, error) {
	var p DirectRequestPayload
	decoder := json.NewDecoder(bytes.NewReader(command.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&p); err != nil {
		return p, reject(CodeInvalidEnvelope, "invalid signed direct request", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return p, reject(CodeInvalidEnvelope, "trailing direct payload", err)
	}
	if authority == nil || p.Direct == nil || p.Bounds == nil || command.Action != "direct.message" || command.Scope != "direct" || command.Target.AgentID == "" {
		return p, reject(CodeUnauthorized, "direct request requires a fixed instance and chain permission", nil)
	}
	d := p.Direct
	for _, id := range []string{d.PermissionID, d.MessageID, d.MessageRecordID} {
		a, err := chainAddress(id)
		if err != nil || a.String() != id {
			return p, reject(CodeInvalidEnvelope, "noncanonical direct source ID", err)
		}
	}
	if d.Version != "1" || d.PermissionID != authority.ID || d.PermissionVersion != authority.Version || strings.TrimSpace(d.ConversationID) == "" || len(d.ConversationID) > 160 || !utf8.ValidString(d.ConversationID) || strings.TrimSpace(d.MessageToken) == "" || len(d.MessageToken) > 160 || !utf8.ValidString(d.MessageToken) || d.ApprovalID != authority.ApprovalID || d.ApprovingGrantID != authority.ApprovingGrantID || authority.ApprovedMessageID != "" && d.MessageID != authority.ApprovedMessageID {
		return p, reject(CodeRevoked, "direct permission, conversation or single-use approval changed", nil)
	}
	if _, err := DirectRequestHash(p); err != nil {
		return p, reject(CodeInvalidEnvelope, "invalid direct request content", err)
	}
	boundary, _ := ExecutionBoundaryHash(p.Bounds.Paths)
	if boundary != authority.BoundaryHash || !slices.Contains(authority.Actions, d.Action) || p.Bounds.MaxCalls > authority.MaxCalls || authority.ApprovalID == "" && d.Action == "file.write" && authority.WorkspaceProtected {
		return p, reject(CodeUnauthorized, "direct action or workspace requires approval", nil)
	}
	if p.Bounds.MaxCalls == 0 {
		if command.Budget != nil {
			return p, reject(CodeUnauthorized, "question/status cannot consume tools", nil)
		}
	} else if command.Budget == nil || command.Budget.Asset != "TOOL_CALLS" || command.Budget.Amount != p.Bounds.MaxCalls {
		return p, reject(CodeUnauthorized, "direct allowance differs from signed budget", nil)
	}
	return p, nil
}

func (r *chainRead) immutable(ctx context.Context, id, kind string, out any) error {
	o, err := r.resolver.reader.ReadChainObject(ctx, id)
	if err != nil {
		return err
	}
	pkg := r.resolver.packageID
	if strings.HasPrefix(kind, "direct_agent::") {
		pkg = r.resolver.directPackageID
	}
	if o.ID != id || o.Type != pkg+"::"+kind || !o.Immutable || o.Shared || o.Version == 0 || len(o.Content) < 32 || "0x"+hex.EncodeToString(o.Content[:32]) != id {
		return fmt.Errorf("invalid immutable %s source", kind)
	}
	if err = decodeChainBCS(o.Content, out); err != nil {
		return err
	}
	r.versions[id] = o.Version
	return nil
}

type DirectExecutionAuthority struct {
	PermissionID, MessageID, MessageRecordID, ConversationID, MessageToken, Action string
	BoundaryHash, RequestHash, ApprovalID, ApprovingGrantID                        string
	PermissionVersion                                                              Uint64String
	CreatedAtMS, ExpiresAtMS                                                       uint64
}

func (r *chainRead) directExecution(ctx context.Context, cap moveCapability, run moveExecution, local moveBoundBudgetClaim) (*DirectExecutionAuthority, error) {
	p, b, contract, err := r.directPermission(ctx, cap)
	if err != nil {
		return nil, err
	}
	if len(run.Managed) != 1 || run.Action != "direct.message" || run.Scope != "direct" {
		return nil, fmt.Errorf("direct execution requires one fixed instance")
	}
	if run.BudgetAmount == 0 && run.BudgetAsset != "" || run.BudgetAmount > 0 && run.BudgetAsset != "TOOL_CALLS" {
		return nil, fmt.Errorf("direct original Run uses an invalid asset")
	}
	var binding moveDirectCommand
	if err = r.directField(ctx, cap.ID.String(), run.IntentHash, "DirectCommandBinding", &binding); err != nil {
		return nil, err
	}
	if binding.Permission != p.ID || binding.Version != b.Version || !slices.Equal(binding.Approval, b.Approval) {
		return nil, fmt.Errorf("direct original command binding mismatch")
	}
	var core moveCommandContract
	pkg := r.resolver.packageID
	if err = r.field(ctx, cap.ID.String(), structKeyTag(pkg, "remote_authority", "CommandContractKey"), appendBCSBytes(nil, run.IntentHash), pkg+"::remote_authority::CommandContractKey", pkg+"::remote_authority::CommandContractBinding", &core); err != nil {
		return nil, err
	}
	if core.Contract != p.ID || core.Agreement != binding.Version || core.KR != 0 || !bytes.Equal(core.Boundary, contract.Boundary) {
		return nil, fmt.Errorf("core and direct command contract disagree")
	}
	var claim moveDirectClaim
	if err = r.field(ctx, p.Claims.ID.String(), structKeyTag("0x2", "object", "ID"), run.ID[:], "0x2::object::ID", r.resolver.directPackageID+"::direct_agent::DirectClaim", &claim); err != nil {
		return nil, err
	}
	if claim.Capability != cap.ID || claim.Message != binding.Message || claim.Version != binding.Version || !slices.Equal(claim.Approval, binding.Approval) || claim.Reserved != local.Reserved || claim.Spent != local.Spent || claim.Settled != local.Settled {
		return nil, fmt.Errorf("direct and capability ledgers disagree")
	}
	spent, reserved := p.Spent, p.Reserved
	if len(claim.Approval) == 1 {
		spent, reserved = p.ApprovedSpent, p.ApprovedReserved
	}
	if !claim.Settled && reserved < claim.Reserved || claim.Settled && spent < claim.Spent {
		return nil, fmt.Errorf("direct cumulative ledger does not cover original claim")
	}
	var original moveAddress
	if err = r.field(ctx, p.Runs.ID.String(), structKeyTag("0x2", "object", "ID"), binding.Message[:], "0x2::object::ID", "0x2::object::ID", &original); err != nil {
		return nil, err
	}
	if original != run.ID {
		return nil, fmt.Errorf("message does not refer to original Run")
	}
	var message moveDirectMessage
	if err = r.immutable(ctx, binding.Message.String(), "direct_agent::Message", &message); err != nil {
		return nil, err
	}
	if !directAction(message.Action) || directNoTools(message.Action) != (message.Amount == 0) || message.Amount > 1000 {
		return nil, fmt.Errorf("invalid immutable direct message action/budget")
	}
	if message.Org != run.Org || message.Permission != p.ID || message.PermissionVersion != binding.Version || message.Managed != run.Managed[0] || message.Membership != run.Membership || message.Human != run.Human || message.Device != run.Delegate || message.Grant != run.Grant || message.GrantVersion != run.GrantVersion || message.Amount != run.BudgetAmount || !bytes.Equal(message.Boundary, core.Boundary) || len(message.RequestHash) != 32 {
		return nil, fmt.Errorf("immutable message and original Run disagree")
	}
	var messagePointer moveAddress
	if err = r.field(ctx, p.Messages.ID.String(), structKeyTag("0x1", "string", "String"), appendBCSBytes(nil, []byte(message.Token)), "0x1::string::String", "0x2::object::ID", &messagePointer); err != nil {
		return nil, err
	}
	if messagePointer != message.ID {
		return nil, fmt.Errorf("direct message directory source mismatch")
	}
	var record moveEncryptedRecord
	if err = r.immutable(ctx, message.Record.String(), "product_record::EncryptedRecord", &record); err != nil {
		return nil, err
	}
	if record.Org != message.Org || record.Kind != 6 || record.LogicalID != "direct-message-"+message.Token || record.Revision != 1 || record.Human != message.Human || record.Device != message.Device || record.Grant != message.Grant || record.GrantVersion != message.GrantVersion || record.CreatedMS != message.Created {
		return nil, fmt.Errorf("message encrypted record source mismatch")
	}
	d := &DirectExecutionAuthority{PermissionID: p.ID.String(), PermissionVersion: Uint64String(binding.Version), MessageID: message.ID.String(), MessageRecordID: message.Record.String(), ConversationID: message.Conversation, MessageToken: message.Token, Action: message.Action, BoundaryHash: hex.EncodeToString(message.Boundary), RequestHash: hex.EncodeToString(message.RequestHash), CreatedAtMS: message.Created, ExpiresAtMS: message.Expiry}
	if len(binding.Approval) == 1 {
		d.ApprovalID = binding.Approval[0].String()
		var approval moveDirectApproval
		if err = r.object(ctx, d.ApprovalID, "direct_agent::Approval", &approval); err != nil {
			return nil, err
		}
		if approval.State != 3 || len(approval.Grant) != 1 || approval.Message != message.ID || approval.Permission != p.ID || approval.PermissionVersion != binding.Version || approval.Managed != message.Managed || approval.ManagedVersion != message.ManagedVersion || approval.Org != run.Org || approval.Generation != message.Generation || approval.Action != message.Action || approval.Amount != message.Amount || !bytes.Equal(approval.Boundary, message.Boundary) {
			return nil, fmt.Errorf("consumed approval and original message disagree")
		}
		d.ApprovingGrantID = approval.Grant[0].String()
	}
	return d, nil
}

// This read-only check is used after signature validation and before each tool.
func (s *ChainAuthorityResolver) ValidateDirectCommand(ctx context.Context, command NodeCommand, state CapabilityState) error {
	p, err := ParseDirectRequest(command, state.Direct)
	if err != nil {
		return err
	}
	b, err := command.SigningBytes()
	if err != nil {
		return err
	}
	h := sha256.Sum256(b)
	run, found, err := s.LookupExecution(ctx, command.Capability.ID, hex.EncodeToString(h[:]))
	if err != nil {
		return err
	}
	if !found || run.Direct == nil {
		return reject(CodeUnauthorized, "direct message has no bound original Run", nil)
	}
	d, ref := run.Direct, p.Direct
	hash, _ := DirectRequestHash(p)
	reservation := Reservation{CapabilityID: command.Capability.ID, Signer: command.Signer, CommandID: command.CommandID, Nonce: command.Nonce, IdempotencyKey: command.IdempotencyKey, Fingerprint: hex.EncodeToString(h[:]), Budget: command.Budget, Target: command.Target, Action: command.Action, CommandScope: command.Scope, IssuedAtMS: command.IssuedAtMS, ExpiresAtMS: command.ExpiresAtMS}
	if !run.Matches(reservation) {
		return reject(CodeUnauthorized, "original Run differs from signed direct command", nil)
	}
	if d.PermissionID != ref.PermissionID || d.PermissionVersion != ref.PermissionVersion || d.MessageID != ref.MessageID || d.MessageRecordID != ref.MessageRecordID || d.ConversationID != ref.ConversationID || d.MessageToken != ref.MessageToken || d.Action != ref.Action || d.ApprovalID != ref.ApprovalID || d.ApprovingGrantID != ref.ApprovingGrantID || d.RequestHash != hash || run.Signer != command.Signer || command.IssuedAtMS < 0 || uint64(command.IssuedAtMS) < d.CreatedAtMS || command.ExpiresAtMS < 0 || uint64(command.ExpiresAtMS) > d.ExpiresAtMS {
		return reject(CodeUnauthorized, "signed content differs from original direct message", nil)
	}
	live, err := s.Resolve(ctx, command.Capability)
	if err != nil {
		return err
	}
	live.CheckpointObservedAtMS = state.CheckpointObservedAtMS
	if live.SnapshotHash() != state.SnapshotHash() {
		return reject(CodeAuthorityStale, "direct authority changed during message validation", nil)
	}
	return nil
}
