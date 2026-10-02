package nodecommand

import (
	"context"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/blake2b"
)

// ChainObject contains raw, lossless Move BCS. JSON projections and local
// authority.json files are never sources of identity or membership authority.
type ChainObject struct {
	ID, Type, OwnerID   string
	PreviousTransaction string
	Version             uint64
	Shared              bool
	Immutable           bool
	Content             []byte
}

type ChainObjectReader interface {
	ReadChainObject(context.Context, string) (ChainObject, error)
}

// ChainAuthorityResolver reads all current authorization dependencies. It does
// not reserve execution or budget; ChainAuthorityStore must use a chain-backed
// reservation backend before an executor can consume the projection.
type ChainAuthorityResolver struct {
	reader       ChainObjectReader
	packageID    string
	okrPackageID string
	now          func() time.Time
}

func NewChainAuthorityResolver(reader ChainObjectReader, originalPackageID string, okrOrigins ...string) (*ChainAuthorityResolver, error) {
	addr, err := chainAddress(originalPackageID)
	if err != nil || reader == nil {
		return nil, fmt.Errorf("chain reader and original protocol package ID are required")
	}
	if len(okrOrigins) > 1 {
		return nil, fmt.Errorf("at most one OKR type origin is supported")
	}
	okr := addr
	if len(okrOrigins) == 1 && okrOrigins[0] != "" {
		okr, err = chainAddress(okrOrigins[0])
		if err != nil {
			return nil, err
		}
	}
	return &ChainAuthorityResolver{reader: reader, packageID: addr.String(), okrPackageID: okr.String(), now: time.Now}, nil
}

type moveAddress [32]byte

func (a moveAddress) String() string { return "0x" + hex.EncodeToString(a[:]) }
func chainAddress(value string) (moveAddress, error) {
	var result moveAddress
	s := strings.TrimPrefix(value, "0x")
	if len(s) == 0 || len(s) > 64 {
		return result, fmt.Errorf("invalid Sui address")
	}
	if len(s)%2 == 1 {
		s = "0" + s
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		return result, err
	}
	copy(result[32-len(b):], b)
	return result, nil
}

type moveTable struct {
	ID   moveAddress
	Size uint64
}
type moveCapability struct {
	ID                                                         moveAddress
	Schema                                                     uint8
	Org, Issuer, Delegate                                      moveAddress
	Parent                                                     []moveAddress
	ParentVersion                                              uint64
	ReservationScope, TargetKind                               uint8
	Node, Agent                                                string
	Actions                                                    []string
	Scope                                                      string
	MaxUses, ClaimedUses, DelegatedUses                        uint64
	BudgetAsset                                                string
	MaxBudget, ClaimedBudget, DelegatedBudget, Expiry, Version uint64
	Revoked                                                    bool
	Claims, Commands, Nonces, Idempotency                      moveTable
}
type moveAuthorityBinding struct {
	Membership               moveAddress
	MembershipVersion        uint64
	Managed                  []moveAddress
	ManagedVersion           uint64
	Human                    moveAddress
	Grant                    []moveAddress
	GrantVersion, Generation uint64
	RequiredAction           uint8
}
type moveMembership struct {
	ID, Org, Host            moveAddress
	PublicKey, EncryptionKey []byte
	Name                     string
	Binding                  moveAddress
	Version                  uint64
	Revoked                  bool
	Expiry, Joined           uint64
	Invite, Observation      moveAddress
}
type moveCoordinator struct {
	ID, Org, Address moveAddress
	PublicKey        []byte
	Endpoint         string
	Version          uint64
	Revoked          bool
}
type moveOrganization struct {
	ID                         moveAddress
	Name, Description          string
	Admin                      moveAddress
	Active                     bool
	Agents                     moveTable
	AgentCount                 uint64
	Tasks                      moveTable
	TaskCount                  uint64
	Parent                     []moveAddress
	Children                   moveTable
	ChildCount, Depth, Created uint64
}
type moveHostIndex struct {
	Bindings, Invitations, Memberships []moveAddress
	ActiveHosts, Instances             moveTable
}
type moveHuman struct {
	ID, Registry                    moveAddress
	Network                         string
	Generation, RecoveryVersion     uint64
	RecoveryRecord, RecoveryAddress moveAddress
	AdminCaps, Roles                moveTable
	Organizations, Grants           []moveAddress
}
type moveGrant struct {
	ID, Human, Device            moveAddress
	Org                          []moveAddress
	Actions                      []byte
	Expiry                       uint64
	Revoked                      bool
	Version, Generation          uint64
	EncryptionKey, EncryptedKeys []byte
}
type moveRole struct {
	Owner         moveAddress
	Admin, Active bool
	Version       uint64
}
type moveManaged struct {
	ID, Org, Membership, Host moveAddress
	Instance, Runtime         string
	Workspace                 []byte
	Control                   bool
	Human, Device             moveAddress
	Version                   uint64
	Revoked                   bool
	Imported                  uint64
}

type chainRead struct {
	resolver *ChainAuthorityResolver
	versions map[string]uint64
}

func (r *chainRead) object(ctx context.Context, id string, kind string, out any) error {
	obj, err := r.resolver.reader.ReadChainObject(ctx, id)
	if err != nil {
		return err
	}
	pkg := r.resolver.packageID
	if strings.HasPrefix(kind, "okr::") {
		pkg = r.resolver.okrPackageID
	}
	if obj.ID != id || obj.Type != pkg+"::"+kind || obj.Version == 0 || !obj.Shared {
		return fmt.Errorf("unexpected protocol object, owner or version for %s", kind)
	}
	if err := decodeChainBCS(obj.Content, out); err != nil {
		return fmt.Errorf("decode %s: %w", kind, err)
	}
	// All protocol shared object layouts start with UID. Metadata and BCS must agree.
	if len(obj.Content) < 32 || "0x"+hex.EncodeToString(obj.Content[:32]) != id {
		return fmt.Errorf("object UID mismatch")
	}
	r.versions[id] = obj.Version
	return nil
}

func (r *chainRead) field(ctx context.Context, parent string, keyTag []byte, key []byte, keyType, valueType string, out any) error {
	id, err := dynamicFieldID(parent, keyTag, key)
	if err != nil {
		return err
	}
	obj, err := r.resolver.reader.ReadChainObject(ctx, id)
	if err != nil {
		return err
	}
	// A field belongs to its parent, so it is object-owned rather than shared.
	expected := "0x2::dynamic_field::Field<" + keyType + ", " + valueType + ">"
	if obj.ID != id || obj.OwnerID != parent || obj.Version == 0 || normalizeMoveType(obj.Type) != normalizeMoveType(expected) {
		return fmt.Errorf("unexpected dynamic field type, owner or version")
	}
	prefix := 32 + len(key)
	if len(obj.Content) < prefix || "0x"+hex.EncodeToString(obj.Content[:32]) != id || !reflect.DeepEqual(obj.Content[32:prefix], key) {
		return fmt.Errorf("dynamic field UID/name mismatch")
	}
	if err := decodeChainBCS(obj.Content[prefix:], out); err != nil {
		return err
	}
	r.versions[id] = obj.Version
	return nil
}
func normalizeMoveType(value string) string {
	value = strings.ReplaceAll(value, " ", "")
	// Framework type IDs may be expanded by the RPC service.
	return strings.ReplaceAll(value, "0x"+strings.Repeat("0", 63)+"2::", "0x2::")
}
func structKeyTag(packageID, module, name string) []byte {
	addr, _ := chainAddress(packageID)
	result := append([]byte{7}, addr[:]...)
	result = appendBCSBytes(result, []byte(module))
	result = appendBCSBytes(result, []byte(name))
	return append(result, 0) // no type parameters
}
func appendBCSBytes(target, value []byte) []byte {
	n := uint32(len(value))
	for n >= 128 {
		target = append(target, byte(n)|128)
		n >>= 7
	}
	target = append(target, byte(n))
	return append(target, value...)
}
func dynamicFieldID(parent string, typeTag, key []byte) (string, error) {
	addr, err := chainAddress(parent)
	if err != nil {
		return "", err
	}
	h, _ := blake2b.New256(nil)
	h.Write([]byte{0xf0})
	h.Write(addr[:])
	var length [8]byte
	binary.LittleEndian.PutUint64(length[:], uint64(len(key)))
	h.Write(length[:])
	h.Write(key)
	h.Write(typeTag)
	return "0x" + hex.EncodeToString(h.Sum(nil)), nil
}

func (s *ChainAuthorityResolver) Resolve(ctx context.Context, ref CapabilityRef) (CapabilityState, error) {
	addr, err := chainAddress(ref.ID)
	if err != nil || addr.String() != ref.ID {
		return CapabilityState{}, fmt.Errorf("capability ID must be canonical")
	}
	r := &chainRead{resolver: s, versions: map[string]uint64{}}
	var cap moveCapability
	if err := r.object(ctx, ref.ID, "remote_authority::RemoteCapability", &cap); err != nil {
		return CapabilityState{}, err
	}
	if cap.Schema != 1 || len(cap.Parent) != 0 || cap.TargetKind < 2 || cap.TargetKind > 3 || cap.ReservationScope != 2 || cap.Version == 0 {
		return CapabilityState{}, fmt.Errorf("unsupported Host capability schema or delegation")
	}
	var auth moveAuthorityBinding
	keyType := s.packageID + "::host::AuthorityBindingKey"
	if err := r.field(ctx, ref.ID, structKeyTag(s.packageID, "host", "AuthorityBindingKey"), []byte{0}, keyType, s.packageID+"::host::AuthorityBinding", &auth); err != nil {
		return CapabilityState{}, err
	}
	if len(auth.Managed) > 1 || len(auth.Grant) > 1 || auth.RequiredAction < 1 || auth.RequiredAction > 4 {
		return CapabilityState{}, fmt.Errorf("invalid authority binding")
	}
	var member moveMembership
	var org moveOrganization
	var coordinator moveCoordinator
	if err := r.object(ctx, auth.Membership.String(), "host::HostMembership", &member); err != nil {
		return CapabilityState{}, err
	}
	if err := r.object(ctx, cap.Org.String(), "organization::Organization", &org); err != nil {
		return CapabilityState{}, err
	}
	if err := r.object(ctx, member.Binding.String(), "host::CoordinatorBinding", &coordinator); err != nil {
		return CapabilityState{}, err
	}
	now := s.now().UnixMilli()
	if cap.Org != member.Org || coordinator.Org != cap.Org || cap.Node != member.Host.String() {
		return CapabilityState{}, reject(CodeWrongTarget, "Host or organization binding changed", nil)
	}
	if !org.Active || member.Revoked || member.Version != auth.MembershipVersion || coordinator.Revoked || cap.Revoked {
		return CapabilityState{}, reject(CodeRevoked, "chain authority is revoked", nil)
	}
	if member.Expiry > math.MaxInt64 || cap.Expiry > math.MaxInt64 || member.Expiry <= uint64(now) || cap.Expiry <= uint64(now) {
		return CapabilityState{}, reject(CodeExpired, "Host or capability expired", nil)
	}
	if len(member.PublicKey) != 32 || !sameSigningAddress(member.PublicKey, member.Host) || len(coordinator.PublicKey) != 32 || !sameSigningAddress(coordinator.PublicKey, coordinator.Address) {
		return CapabilityState{}, fmt.Errorf("Host or Coordinator signing key mismatch")
	}
	var index moveHostIndex
	keyType = s.packageID + "::host::HostIndexBinding"
	if err := r.field(ctx, cap.Org.String(), structKeyTag(s.packageID, "host", "HostIndexBinding"), []byte{0}, keyType, s.packageID+"::host::HostIndex", &index); err != nil {
		return CapabilityState{}, err
	}
	var currentMember moveAddress
	if err := r.field(ctx, index.ActiveHosts.ID.String(), []byte{4}, member.Host[:], "address", "0x2::object::ID", &currentMember); err != nil {
		return CapabilityState{}, err
	}
	if currentMember != member.ID {
		return CapabilityState{}, reject(CodeRevoked, "Host membership was replaced", nil)
	}
	expiry := cap.Expiry
	if member.Expiry < expiry {
		expiry = member.Expiry
	}
	if len(auth.Grant) == 0 {
		if len(auth.Managed) != 0 || cap.TargetKind != 2 || cap.Delegate != member.Host || auth.RequiredAction != 1 || cap.Scope != "observation" || cap.MaxBudget != 0 {
			return CapabilityState{}, fmt.Errorf("invalid bootstrap observation authority")
		}
		for _, action := range cap.Actions {
			if !observationAction(action) {
				return CapabilityState{}, fmt.Errorf("bootstrap authority cannot execute")
			}
		}
	} else {
		var human moveHuman
		var grant moveGrant
		var role moveRole
		if err := r.object(ctx, auth.Human.String(), "identity::HumanIdentity", &human); err != nil {
			return CapabilityState{}, err
		}
		if err := r.object(ctx, auth.Grant[0].String(), "identity::DeviceGrant", &grant); err != nil {
			return CapabilityState{}, err
		}
		if grant.Human != human.ID || grant.Device != cap.Delegate || len(grant.Org) > 1 || (len(grant.Org) == 1 && grant.Org[0] != cap.Org) {
			return CapabilityState{}, reject(CodeUnauthorized, "device or organization mismatch", nil)
		}
		if grant.Revoked || grant.Generation != human.Generation || human.Generation != auth.Generation || grant.Version != auth.GrantVersion {
			return CapabilityState{}, reject(CodeRevoked, "device permission or identity generation changed", nil)
		}
		if grant.Expiry > math.MaxInt64 || grant.Expiry <= uint64(now) {
			return CapabilityState{}, reject(CodeExpired, "device grant expired", nil)
		}
		if !containsByte(grant.Actions, auth.RequiredAction) {
			return CapabilityState{}, reject(CodeUnauthorized, "device action is not authorized", nil)
		}
		if err := r.field(ctx, human.Roles.ID.String(), structKeyTag("0x2", "object", "ID"), cap.Org[:], "0x2::object::ID", s.packageID+"::identity::OrgRole", &role); err != nil {
			return CapabilityState{}, err
		}
		if !role.Active || role.Owner != org.Admin || (auth.RequiredAction >= 3 && !role.Admin) {
			return CapabilityState{}, reject(CodeUnauthorized, "organization role is not authorized", nil)
		}
		if grant.Expiry < expiry {
			expiry = grant.Expiry
		}
	}
	var instance *ManagedInstanceAuthority
	if len(auth.Managed) == 0 {
		if cap.TargetKind != 2 || cap.Agent != "" || auth.RequiredAction != 1 {
			return CapabilityState{}, fmt.Errorf("unmanaged instance cannot execute")
		}
		for _, action := range cap.Actions {
			if !observationAction(action) {
				return CapabilityState{}, fmt.Errorf("unmanaged Host action is unsupported")
			}
		}
	} else {
		var managed moveManaged
		if err := r.object(ctx, auth.Managed[0].String(), "host::ManagedAgent", &managed); err != nil {
			return CapabilityState{}, err
		}
		if managed.Org != cap.Org || managed.Host != member.Host || managed.Membership != member.ID || managed.Instance != cap.Agent || cap.TargetKind != 3 {
			return CapabilityState{}, reject(CodeWrongTarget, "managed instance mismatch", nil)
		}
		if managed.Revoked || managed.Version != auth.ManagedVersion {
			return CapabilityState{}, reject(CodeRevoked, "managed instance changed or was revoked", nil)
		}
		if len(managed.Workspace) != 32 {
			return CapabilityState{}, fmt.Errorf("invalid managed workspace hash")
		}
		instance = &ManagedInstanceAuthority{ID: managed.ID.String(), Runtime: managed.Runtime, WorkspaceHash: hex.EncodeToString(managed.Workspace), Version: Uint64String(managed.Version)}
		for _, action := range cap.Actions {
			if !observationAction(action) && (auth.RequiredAction != 2 || !managed.Control || managed.Runtime != "bounded-process-v1") {
				return CapabilityState{}, reject(CodeUnauthorized, "instance cannot execute constrained commands", nil)
			}
		}
	}
	if len(cap.Actions) == 0 || cap.MaxUses < cap.DelegatedUses || cap.MaxUses-cap.DelegatedUses < cap.ClaimedUses || cap.MaxBudget < cap.DelegatedBudget || cap.MaxBudget-cap.DelegatedBudget < cap.ClaimedBudget {
		return CapabilityState{}, fmt.Errorf("invalid capability bounds")
	}
	seen := map[string]bool{}
	for _, action := range cap.Actions {
		if !validSigningToken(action) || action == "" || seen[action] {
			return CapabilityState{}, fmt.Errorf("invalid or duplicate capability action")
		}
		seen[action] = true
	}
	if !validSigningToken(cap.Scope) || cap.Scope == "" || (cap.MaxBudget > 0 && (!validSigningToken(cap.BudgetAsset) || cap.BudgetAsset == "")) {
		return CapabilityState{}, fmt.Errorf("invalid capability scope/budget")
	}
	contract, contractExpiry, err := r.currentContract(ctx, cap, auth, instance, uint64(now))
	if err != nil {
		return CapabilityState{}, err
	}
	var handover *ExecutionHandoverAuthority
	if contract != nil {
		handover, err = r.currentHandover(ctx, cap, contract, instance)
		if err != nil {
			return CapabilityState{}, err
		}
	}
	if contractExpiry < expiry {
		expiry = contractExpiry
	}
	// Re-read each dependency by latest version. Any change during resolution
	// fails closed; the chain reservation transaction will check again atomically.
	ids := make([]string, 0, len(r.versions))
	for id := range r.versions {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var stamp strings.Builder
	for _, id := range ids {
		obj, err := s.reader.ReadChainObject(ctx, id)
		if err != nil {
			return CapabilityState{}, err
		}
		if obj.ID != id || obj.Version != r.versions[id] {
			return CapabilityState{}, reject(CodeAuthorityStale, "chain state changed during resolution", nil)
		}
		fmt.Fprintf(&stamp, "%s:%d;", id, obj.Version)
	}
	uses := cap.MaxUses - cap.DelegatedUses
	state := CapabilityState{ID: ref.ID, Target: Target{OrganizationID: cap.Org.String(), NodeID: cap.Node, AgentID: cap.Agent}, AuthorizedSigners: []string{cap.Delegate.String()}, Actions: cap.Actions, Scopes: []string{cap.Scope}, ExpiresAtMS: int64(expiry), RevocationVersion: cap.Version, CheckpointObservedAtMS: now, ReservationScope: ReservationScopeNode, RemainingUses: &uses, AuthorityVersionHash: hashBytes([]byte(stamp.String()))}
	state.ManagedInstance = instance
	state.Contract = contract
	state.Handover = handover
	// Pre-validation ceilings: the exact intent may already be reserved. The
	// chain reservation backend checks its claim and counters without consuming twice.
	if cap.MaxBudget > 0 {
		state.RemainingBudget = &BudgetClaim{Asset: cap.BudgetAsset, Amount: Uint64String(cap.MaxBudget - cap.DelegatedBudget)}
	}
	return state, nil
}
func sameSigningAddress(public []byte, expected moveAddress) bool {
	return blake2b.Sum256(append([]byte{0}, public...)) == [32]byte(expected)
}
func containsByte(values []byte, value byte) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
func observationAction(action string) bool {
	switch action {
	case "inventory", "status", "monitor", "logs", "health", "availability":
		return true
	}
	return false
}

// Only the small set of BCS primitives used by the protocol layouts above is
// accepted. Lengths are bounded by remaining input, booleans and ULEB are
// canonical, and trailing bytes/new layouts fail closed.
func decodeChainBCS(data []byte, out any) error {
	v := reflect.ValueOf(out)
	if v.Kind() != reflect.Pointer || v.IsNil() || len(data) > 1<<20 {
		return fmt.Errorf("invalid BCS destination/size")
	}
	d := bcsReader{data: data}
	if err := d.decode(v.Elem(), 0); err != nil {
		return err
	}
	if d.offset != len(data) {
		return fmt.Errorf("trailing BCS data")
	}
	return nil
}

type bcsReader struct {
	data   []byte
	offset int
}

func (d *bcsReader) take(n int) ([]byte, error) {
	if n < 0 || n > len(d.data)-d.offset {
		return nil, fmt.Errorf("truncated BCS")
	}
	b := d.data[d.offset : d.offset+n]
	d.offset += n
	return b, nil
}
func (d *bcsReader) length() (int, error) {
	var value uint32
	for i := 0; i < 5; i++ {
		b, err := d.take(1)
		if err != nil {
			return 0, err
		}
		if i == 4 && b[0] > 15 {
			return 0, fmt.Errorf("ULEB overflow")
		}
		value |= uint32(b[0]&127) << uint(7*i)
		if b[0] < 128 {
			if i > 0 && b[0] == 0 {
				return 0, fmt.Errorf("noncanonical ULEB")
			}
			if uint64(value) > uint64(len(d.data)-d.offset) {
				return 0, fmt.Errorf("BCS length exceeds input")
			}
			return int(value), nil
		}
	}
	return 0, fmt.Errorf("invalid ULEB")
}
func (d *bcsReader) decode(v reflect.Value, depth int) error {
	if depth > 16 {
		return fmt.Errorf("BCS nesting limit")
	}
	switch v.Kind() {
	case reflect.Uint8:
		b, e := d.take(1)
		if e != nil {
			return e
		}
		v.SetUint(uint64(b[0]))
	case reflect.Uint64:
		b, e := d.take(8)
		if e != nil {
			return e
		}
		v.SetUint(binary.LittleEndian.Uint64(b))
	case reflect.Bool:
		b, e := d.take(1)
		if e != nil {
			return e
		}
		if b[0] > 1 {
			return fmt.Errorf("invalid BCS bool")
		}
		v.SetBool(b[0] == 1)
	case reflect.String:
		n, e := d.length()
		if e != nil {
			return e
		}
		b, e := d.take(n)
		if e != nil {
			return e
		}
		if !utf8.Valid(b) {
			return fmt.Errorf("invalid UTF-8")
		}
		v.SetString(string(b))
	case reflect.Array:
		for i := 0; i < v.Len(); i++ {
			if e := d.decode(v.Index(i), depth+1); e != nil {
				return e
			}
		}
	case reflect.Slice:
		n, e := d.length()
		if e != nil {
			return e
		}
		if n > 65536 {
			return fmt.Errorf("BCS collection limit")
		}
		v.Set(reflect.MakeSlice(v.Type(), n, n))
		for i := 0; i < n; i++ {
			if e := d.decode(v.Index(i), depth+1); e != nil {
				return e
			}
		}
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			if e := d.decode(v.Field(i), depth+1); e != nil {
				return e
			}
		}
	default:
		return fmt.Errorf("unsupported BCS kind %s", v.Kind())
	}
	return nil
}
