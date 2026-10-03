package nodecommand

import (
	"context"
	"crypto/ed25519"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/block-vision/sui-go-sdk/mystenbcs"
	"golang.org/x/crypto/blake2b"
)

type chainFixture struct {
	objects      map[string]ChainObject
	reads        map[string]int
	changeOnRead string
	fail         bool
	resolver     *ChainAuthorityResolver
	cap          moveCapability
	auth         moveAuthorityBinding
	member       moveMembership
	coordinator  moveCoordinator
	org          moveOrganization
	human        moveHuman
	grant        moveGrant
	managed      moveManaged
	role         moveRole
	index        moveHostIndex
}

func (f *chainFixture) ReadChainObject(_ context.Context, id string) (ChainObject, error) {
	if f.fail {
		return ChainObject{}, errors.New("RPC unavailable")
	}
	object, ok := f.objects[id]
	if !ok {
		return ChainObject{}, ErrChainObjectNotFound
	}
	f.reads[id]++
	if id == f.changeOnRead && f.reads[id] > 1 {
		object.Version++
	}
	return object, nil
}
func addressNumber(n byte) moveAddress { var a moveAddress; a[31] = n; return a }
func (f *chainFixture) saveObject(t *testing.T, id moveAddress, kind string, value any) {
	t.Helper()
	bytes, err := mystenbcs.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	f.objects[id.String()] = ChainObject{ID: id.String(), Type: f.resolver.packageID + "::" + kind, Version: 1, Shared: true, Content: bytes}
}
func (f *chainFixture) saveField(t *testing.T, parent moveAddress, tag, key []byte, keyType, valueType string, value any) string {
	t.Helper()
	id, err := dynamicFieldID(parent.String(), tag, key)
	if err != nil {
		t.Fatal(err)
	}
	idAddress, _ := chainAddress(id)
	valueBytes, err := mystenbcs.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	content := append(append(append([]byte{}, idAddress[:]...), key...), valueBytes...)
	f.objects[id] = ChainObject{ID: id, Type: "0x2::dynamic_field::Field<" + keyType + ", " + valueType + ">", Version: 1, OwnerID: parent.String(), Content: content}
	return id
}
func (f *chainFixture) sync(t *testing.T) {
	pkg := f.resolver.packageID
	f.saveObject(t, f.cap.ID, "remote_authority::RemoteCapability", f.cap)
	f.saveObject(t, f.member.ID, "host::HostMembership", f.member)
	f.saveObject(t, f.coordinator.ID, "host::CoordinatorBinding", f.coordinator)
	f.saveObject(t, f.org.ID, "organization::Organization", f.org)
	f.saveObject(t, f.human.ID, "identity::HumanIdentity", f.human)
	f.saveObject(t, f.grant.ID, "identity::DeviceGrant", f.grant)
	f.saveObject(t, f.managed.ID, "host::ManagedAgent", f.managed)
	f.saveField(t, f.cap.ID, structKeyTag(pkg, "host", "AuthorityBindingKey"), []byte{0}, pkg+"::host::AuthorityBindingKey", pkg+"::host::AuthorityBinding", f.auth)
	f.saveField(t, f.org.ID, structKeyTag(pkg, "host", "HostIndexBinding"), []byte{0}, pkg+"::host::HostIndexBinding", pkg+"::host::HostIndex", f.index)
	f.saveField(t, f.index.ActiveHosts.ID, []byte{4}, f.member.Host[:], "address", "0x2::object::ID", f.member.ID)
	f.saveField(t, f.human.Roles.ID, structKeyTag("0x2", "object", "ID"), f.org.ID[:], "0x2::object::ID", pkg+"::identity::OrgRole", f.role)
}
func newChainFixture(t *testing.T) *chainFixture {
	t.Helper()
	f := &chainFixture{objects: map[string]ChainObject{}, reads: map[string]int{}}
	var err error
	f.resolver, err = NewChainAuthorityResolver(f, "0x42")
	if err != nil {
		t.Fatal(err)
	}
	const now = 1700000000000
	f.resolver.now = func() time.Time { return time.UnixMilli(now) }
	seed := make([]byte, 32)
	seed[0] = 6
	public := ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey)
	hostAddress := moveAddress(blake2b.Sum256(append([]byte{0}, public...)))
	// Generic Host ledger fixture. Direct messages require their separate
	// permission/source fixture and cannot use an unbound generic capability.
	f.cap = moveCapability{ID: addressNumber(1), Schema: 1, Org: addressNumber(2), Issuer: addressNumber(3), Delegate: addressNumber(4), ReservationScope: 2, TargetKind: 3, Node: hostAddress.String(), Agent: "worker", Actions: []string{"start"}, Scope: "control", MaxUses: 10, MaxBudget: 100, BudgetAsset: "MIST", Expiry: now + 60000, Version: 1}
	f.member = moveMembership{ID: addressNumber(5), Org: f.cap.Org, Host: hostAddress, PublicKey: public, EncryptionKey: make([]byte, 32), Name: "local", Binding: addressNumber(6), Version: 1, Expiry: now + 120000}
	f.coordinator = moveCoordinator{ID: addressNumber(6), Org: f.cap.Org, Address: hostAddress, PublicKey: public, Endpoint: "https://entry.example.invalid", Version: 1}
	f.human = moveHuman{ID: addressNumber(3), Generation: 1, Network: "localnet", Roles: moveTable{ID: addressNumber(7), Size: 1}}
	f.grant = moveGrant{ID: addressNumber(8), Human: f.human.ID, Device: f.cap.Delegate, Actions: []byte{1, 2, 3, 4}, Expiry: now + 60000, Version: 1, Generation: 1}
	f.org = moveOrganization{ID: f.cap.Org, Admin: f.human.ID, Active: true}
	f.managed = moveManaged{ID: addressNumber(9), Org: f.cap.Org, Membership: f.member.ID, Host: hostAddress, Instance: "worker", Runtime: "bounded-process-v1", Workspace: make([]byte, 32), Control: true, Version: 1}
	f.role = moveRole{Owner: f.human.ID, Admin: true, Active: true, Version: 1}
	f.index = moveHostIndex{ActiveHosts: moveTable{ID: addressNumber(10), Size: 1}}
	f.auth = moveAuthorityBinding{Membership: f.member.ID, MembershipVersion: 1, Managed: []moveAddress{f.managed.ID}, ManagedVersion: 1, Human: f.human.ID, Grant: []moveAddress{f.grant.ID}, GrantVersion: 1, Generation: 1, RequiredAction: 2}
	f.sync(t)
	return f
}
func TestChainAuthorityCurrentPermissions(t *testing.T) {
	f := newChainFixture(t)
	state, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()})
	if err != nil {
		t.Fatal(err)
	}
	if state.AuthorizedSigners[0] != f.grant.Device.String() || state.Target.AgentID != "worker" || state.AuthorityVersionHash == "" || state.RemainingBudget.Amount != 100 {
		t.Fatalf("bad projection %+v", state)
	}
	for id := range f.objects {
		if f.reads[id] != 2 {
			t.Fatalf("dependency %s was not verified twice", id)
		}
	}
	// A data revision with the same role flags must still change the version
	// stamp, so Reserve cannot accept a mixed authorization snapshot.
	f.reads = map[string]int{}
	obj := f.objects[f.human.ID.String()]
	obj.Version++
	f.objects[obj.ID] = obj
	next, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()})
	if err != nil {
		t.Fatal(err)
	}
	if next.AuthorityVersionHash == state.AuthorityVersionHash {
		t.Fatal("dependency version change was ignored")
	}
}
func TestChainAuthorityRejectsInvalidDependencies(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*chainFixture)
		code   RejectionCode
	}{
		{"device revoked", func(f *chainFixture) { f.grant.Revoked = true }, CodeRevoked},
		{"recovery generation changed", func(f *chainFixture) { f.human.Generation++ }, CodeRevoked},
		{"device permission version changed", func(f *chainFixture) { f.grant.Version++ }, CodeRevoked},
		{"host revoked", func(f *chainFixture) { f.member.Revoked = true }, CodeRevoked},
		{"host membership version changed", func(f *chainFixture) { f.member.Version++ }, CodeRevoked},
		{"coordinator revoked", func(f *chainFixture) { f.coordinator.Revoked = true }, CodeRevoked},
		{"organization inactive", func(f *chainFixture) { f.org.Active = false }, CodeRevoked},
		{"instance rebound", func(f *chainFixture) { f.managed.Version++ }, CodeRevoked},
		{"instance revoked", func(f *chainFixture) { f.managed.Revoked = true }, CodeRevoked},
		{"observation cannot control", func(f *chainFixture) { f.managed.Runtime = "tmux-observe"; f.managed.Control = false }, CodeUnauthorized},
		{"device missing action", func(f *chainFixture) { f.grant.Actions = []byte{1} }, CodeUnauthorized},
		{"device expired at boundary", func(f *chainFixture) { f.grant.Expiry = 1700000000000 }, CodeExpired},
		{"host expired at boundary", func(f *chainFixture) { f.member.Expiry = 1700000000000 }, CodeExpired},
		{"role removed", func(f *chainFixture) { f.role.Active = false }, CodeUnauthorized},
		{"organization owner changed", func(f *chainFixture) { f.role.Owner = addressNumber(33) }, CodeUnauthorized},
		{"cross organization device", func(f *chainFixture) { f.grant.Org = []moveAddress{addressNumber(33)} }, CodeUnauthorized},
		{"another Host instance", func(f *chainFixture) { f.managed.Host = addressNumber(33) }, CodeWrongTarget},
		{"cross organization Host", func(f *chainFixture) { f.member.Org = addressNumber(33) }, CodeWrongTarget},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newChainFixture(t)
			c.mutate(f)
			f.sync(t)
			_, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()})
			if CodeOf(err) != c.code {
				t.Fatalf("want %s, got %v", c.code, err)
			}
		})
	}
}
func TestChainAuthorityRPCFailureTypeForgeryAndConcurrentChange(t *testing.T) {
	for _, mode := range []string{"RPC failure", "forged package", "object owner", "BCS UID", "field owner", "concurrent change"} {
		t.Run(mode, func(t *testing.T) {
			f := newChainFixture(t)
			switch mode {
			case "RPC failure":
				f.fail = true
			case "forged package":
				obj := f.objects[f.member.ID.String()]
				obj.Type = strings.Replace(obj.Type, f.resolver.packageID, addressNumber(99).String(), 1)
				f.objects[obj.ID] = obj
			case "object owner":
				obj := f.objects[f.grant.ID.String()]
				obj.Shared = false
				f.objects[obj.ID] = obj
			case "BCS UID":
				obj := f.objects[f.grant.ID.String()]
				obj.Content[31]++
				f.objects[obj.ID] = obj
			case "field owner":
				for id, obj := range f.objects {
					if obj.OwnerID == f.cap.ID.String() {
						obj.OwnerID = f.member.ID.String()
						f.objects[id] = obj
					}
				}
			case "concurrent change":
				f.changeOnRead = f.grant.ID.String()
			}
			if _, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()}); err == nil {
				t.Fatal("invalid chain state accepted")
			}
		})
	}
}
func TestChainBCSRejectsMalformedFrames(t *testing.T) {
	for _, bytes := range [][]byte{{2}, {1, 0}, {}, {128, 0}, {255, 255, 255, 255, 16}, {1, 255}} {
		var value bool
		if err := decodeChainBCS(bytes, &value); err == nil {
			t.Fatalf("invalid bool frame accepted %x", bytes)
		}
	}
	for _, bytes := range [][]byte{{128, 0}, {255, 255, 255, 255, 16}, {1, 255}, {2, 65}} {
		var value string
		if err := decodeChainBCS(bytes, &value); err == nil {
			t.Fatalf("invalid string frame accepted %x", bytes)
		}
	}
}
func TestDynamicFieldIDsMatchMystenSDK(t *testing.T) {
	// Values generated independently by @mysten/sui deriveDynamicFieldID.
	id, err := dynamicFieldID("0x1", structKeyTag("0x42", "host", "AuthorityBindingKey"), []byte{0})
	if err != nil || id != "0xa127b6e34f3fc6a5b9cf69a53ea547cf5f28ddbdf06af8aef20f58709d70d6ab" {
		t.Fatalf("SDK struct field mismatch %s %v", id, err)
	}
	key := addressNumber(3)
	id, err = dynamicFieldID("0x2", structKeyTag("0x2", "object", "ID"), key[:])
	if err != nil || id != "0x30a37f1607180aa04ee47dfcf3265060cf7aec4b15cb7b678f0d34139e27225f" {
		t.Fatalf("SDK ID field mismatch %s %v", id, err)
	}
}

type chainReservationProbe struct{ reserved bool }

func (p *chainReservationProbe) Supports(s ReservationScope) bool { return s == ReservationScopeNode }
func (p *chainReservationProbe) Inspect(context.Context, Reservation) (ReservationResult, bool, error) {
	return ReservationResult{}, false, nil
}
func (p *chainReservationProbe) Reserve(context.Context, Reservation, CapabilityState) (ReservationResult, error) {
	p.reserved = true
	return ReservationResult{}, nil
}
func TestChainStoreRechecksBeforeReservation(t *testing.T) {
	f := newChainFixture(t)
	probe := &chainReservationProbe{}
	store, err := NewChainAuthorityStore(f.resolver, probe)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = NewChainAuthorityStore(f.resolver, nil); err == nil {
		t.Fatal("missing chain reservation accepted")
	}
	state, err := store.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()})
	if err != nil {
		t.Fatal(err)
	}
	reservation := Reservation{CapabilityID: state.ID, Signer: state.AuthorizedSigners[0], Scope: state.ReservationScope, ExpectedAuthorityHash: state.SnapshotHash(), ExpectedRevocationVersion: state.RevocationVersion, AuthorityObservedAtMS: state.CheckpointObservedAtMS}
	// Fresh timestamp alone is permitted; authorization versions remain exact.
	f.resolver.now = func() time.Time { return time.UnixMilli(1700000000001) }
	if _, err = store.Reserve(context.Background(), reservation); err != nil || !probe.reserved {
		t.Fatalf("unchanged chain snapshot rejected: %v", err)
	}
	probe.reserved = false
	f.grant.Version++
	f.sync(t)
	if _, err = store.Reserve(context.Background(), reservation); err == nil || probe.reserved {
		t.Fatalf("changed grant reached reservation: %v", err)
	}
}
