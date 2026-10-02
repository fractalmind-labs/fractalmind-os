package nodecommand

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/block-vision/sui-go-sdk/mystenbcs"
)

type admissionGolden struct {
	Request struct {
		HostPublicKey, EncryptionPublicKey, ProofSignature []byte
		Sender, InviteID, OrganizationID, BindingID        string
		ProofExpiresAtMS                                   uint64
	}
	ProofPublicKey []byte
}

func admissionVector(t *testing.T) admissionGolden {
	t.Helper()
	data, err := os.ReadFile("../sui/testdata/host_join_mysten.json")
	if err != nil {
		t.Fatal(err)
	}
	var g admissionGolden
	if err = json.Unmarshal(data, &g); err != nil {
		t.Fatal(err)
	}
	return g
}
func fixtureInvitationCode() string {
	entropy := make([]byte, 32)
	for n := range entropy {
		entropy[n] = byte(n)
	}
	prefix := "FHI1:localnet:" + addressNumber(17).String() + ":" + hex.EncodeToString(entropy)
	sum := sha256.Sum256([]byte(prefix))
	return prefix + ":" + hex.EncodeToString(sum[:4])
}
func TestHostInvitationMatchesIndependentSDKProof(t *testing.T) {
	g := admissionVector(t)
	code := fixtureInvitationCode()
	i, err := ParseHostInvitation([]byte(code), "localnet")
	if err != nil {
		t.Fatal(err)
	}
	if !equalBytes(i.PublicKey(), g.ProofPublicKey) {
		t.Fatal("HKDF proof public key differs from SDK")
	}
	p := HostJoinPlan{Network: "localnet", InviteID: g.Request.InviteID, OrganizationID: g.Request.OrganizationID, BindingID: g.Request.BindingID, BindingVersion: 1, ProofExpiresAtMS: g.Request.ProofExpiresAtMS, proofPublicKey: g.ProofPublicKey}
	sig, err := i.SignJoin(p, g.Request.HostPublicKey, g.Request.EncryptionPublicKey)
	if err != nil || !equalBytes(sig, g.Request.ProofSignature) {
		t.Fatalf("SDK JoinIntent signature differs: %v", err)
	}
	for _, format := range []string{"%v", "%+v", "%#v"} {
		if text := fmt.Sprintf(format, i); !strings.Contains(text, "redacted") {
			t.Fatal("credential diagnostic is not redacted")
		}
	}
	private := i.private
	i.Close()
	for _, b := range private {
		if b != 0 {
			t.Fatal("invitation private key was not cleared")
		}
	}
	if _, err = i.SignJoin(p, g.Request.HostPublicKey, g.Request.EncryptionPublicKey); err == nil {
		t.Fatal("closed credential signed")
	}
}
func TestHostInvitationRejectsMalformedAndCrossNetworkCodes(t *testing.T) {
	code := fixtureInvitationCode()
	for _, bad := range []string{code + ":extra", strings.Replace(code, "FHI1", "FHI2", 1), strings.Replace(code, ":localnet:", ":testnet:", 1), strings.Replace(code, addressNumber(17).String(), "0x11", 1), strings.Replace(code, ":0001", ":FF01", 1), code[:len(code)-1] + "z"} {
		if _, err := ParseHostInvitation([]byte(bad), "localnet"); err == nil || strings.Contains(err.Error(), bad) {
			t.Fatal("invalid invitation accepted or leaked")
		}
	}
}

type hostJoinFixture struct {
	*chainFixture
	invite   moveInvite
	registry moveProtocolRegistry
	identity moveIdentityRegistry
	input    HostJoinInput
}

func newHostJoinFixture(t *testing.T) *hostJoinFixture {
	t.Helper()
	g := admissionVector(t)
	f := &hostJoinFixture{chainFixture: newChainFixture(t)}
	f.registry = moveProtocolRegistry{ID: addressNumber(19), Organizations: moveTable{ID: addressNumber(20)}, Names: moveTable{ID: addressNumber(24)}}
	f.identity = moveIdentityRegistry{ID: addressNumber(18), ProtocolRegistry: f.registry.ID, Recoveries: moveTable{ID: addressNumber(25)}, Devices: moveTable{ID: addressNumber(26)}}
	f.human.Registry = f.identity.ID
	f.human.Organizations = []moveAddress{f.org.ID}
	f.human.Grants = []moveAddress{f.grant.ID}
	f.coordinator.ID = addressNumber(16)
	f.org.Name = "fixture-organization"
	f.invite = moveInvite{ID: addressNumber(17), Org: f.org.ID, Binding: f.coordinator.ID, BindingVersion: 1, IssuerHuman: f.human.ID, IssuerDevice: f.grant.Device, IssuerGrant: f.grant.ID, GrantVersion: 1, Generation: 1, ProofPublicKey: g.ProofPublicKey, TemplateVersion: 1, Expiry: 1700000600000, MembershipTTL: 86400000, CapabilityTTL: 3600000, MaxUses: 1}
	f.index.Bindings = []moveAddress{f.coordinator.ID}
	f.index.Invitations = []moveAddress{f.invite.ID}
	f.index.Memberships = []moveAddress{f.member.ID}
	f.input = HostJoinInput{Network: "localnet", ProtocolRegistry: f.registry.ID.String(), InviteID: f.invite.ID.String(), ExpectedOrganization: f.org.ID.String(), HostAddress: g.Request.Sender, ProofPublicKey: g.ProofPublicKey, HostPublicKey: g.Request.HostPublicKey, EncryptionPublicKey: g.Request.EncryptionPublicKey}
	f.syncJoin(t)
	return f
}
func (f *hostJoinFixture) syncJoin(t *testing.T) {
	f.sync(t)
	pkg := f.resolver.packageID
	f.saveObject(t, f.registry.ID, "organization::ProtocolRegistry", f.registry)
	f.saveObject(t, f.identity.ID, "identity::IdentityRegistry", f.identity)
	f.saveObject(t, f.invite.ID, "host::HostInvite", f.invite)
	f.saveField(t, f.registry.ID, structKeyTag(pkg, "identity", "RegistryBinding"), []byte{0}, pkg+"::identity::RegistryBinding", "0x2::object::ID", f.identity.ID)
	clockID := addressNumber(6)
	bytes, err := mystenbcs.Marshal(struct {
		ID        moveAddress
		Timestamp uint64
	}{clockID, 1700000000000})
	if err != nil {
		t.Fatal(err)
	}
	f.objects[clockID.String()] = ChainObject{ID: clockID.String(), Type: "0x2::clock::Clock", Version: 1, Shared: true, Content: bytes}
}
func TestHostJoinPlanReconstructsAndPinsChainAuthority(t *testing.T) {
	f := newHostJoinFixture(t)
	p, err := f.resolver.InspectHostJoin(context.Background(), f.input)
	if err != nil {
		t.Fatal(err)
	}
	if p.OrganizationName != f.org.Name || p.OrganizationID != f.org.ID.String() || p.Endpoint != f.coordinator.Endpoint || p.VersionPin == "" || p.ProofExpiresAtMS != 1700000120000 {
		t.Fatalf("invalid preview %+v", p)
	}
	// Do not accidentally require READ: the on-chain admission operation checks
	// MANAGE_HOSTS, which is independent of observation permission.
	f.grant.Actions = []byte{4}
	f.syncJoin(t)
	if _, err = f.resolver.InspectHostJoin(context.Background(), f.input); err != nil {
		t.Fatal(err)
	}
	f.reads = map[string]int{}
	obj := f.objects[f.grant.ID.String()]
	obj.Version++
	f.objects[obj.ID] = obj
	next, err := f.resolver.InspectHostJoin(context.Background(), f.input)
	if err != nil || next.VersionPin == p.VersionPin {
		t.Fatal("grant data revision did not invalidate quote pin")
	}
}
func TestHostJoinRejectsInvalidOrChangingAuthority(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*hostJoinFixture)
	}{
		{"consumed", func(f *hostJoinFixture) { f.invite.Uses = 1 }},
		{"revoked", func(f *hostJoinFixture) { f.invite.Revoked = true }},
		{"expired", func(f *hostJoinFixture) { f.invite.Expiry = 1700000000000 }},
		{"invalid template", func(f *hostJoinFixture) { f.invite.TemplateVersion = 2 }},
		{"multiple uses", func(f *hostJoinFixture) { f.invite.MaxUses = 2 }},
		{"unindexed invite", func(f *hostJoinFixture) { f.index.Invitations = nil }},
		{"unindexed binding", func(f *hostJoinFixture) { f.index.Bindings = nil }},
		{"wrong organization", func(f *hostJoinFixture) { f.input.ExpectedOrganization = addressNumber(99).String() }},
		{"wrong proof", func(f *hostJoinFixture) { f.input.ProofPublicKey = make([]byte, 32) }},
		{"host sender mismatch", func(f *hostJoinFixture) { f.input.HostAddress = addressNumber(99).String() }},
		{"coordinator changed", func(f *hostJoinFixture) { f.coordinator.Version++ }},
		{"coordinator revoked", func(f *hostJoinFixture) { f.coordinator.Revoked = true }},
		{"remote insecure endpoint", func(f *hostJoinFixture) { f.coordinator.Endpoint = "http://example.invalid" }},
		{"endpoint credentials", func(f *hostJoinFixture) { f.coordinator.Endpoint = "https://user@example.invalid" }},
		{"inactive organization", func(f *hostJoinFixture) { f.org.Active = false }},
		{"Human registry mismatch", func(f *hostJoinFixture) { f.human.Registry = addressNumber(99) }},
		{"Human network mismatch", func(f *hostJoinFixture) { f.human.Network = "testnet" }},
		{"Human recovery", func(f *hostJoinFixture) { f.human.Generation++ }},
		{"grant revoked", func(f *hostJoinFixture) { f.grant.Revoked = true }},
		{"grant expired", func(f *hostJoinFixture) { f.grant.Expiry = 1700000000000 }},
		{"grant version changed", func(f *hostJoinFixture) { f.grant.Version++ }},
		{"grant missing permission", func(f *hostJoinFixture) { f.grant.Actions = []byte{1} }},
		{"wrong grant scope", func(f *hostJoinFixture) { f.grant.Org = []moveAddress{addressNumber(99)} }},
		{"removed role", func(f *hostJoinFixture) { f.role.Active = false }},
		{"owner changed", func(f *hostJoinFixture) { f.org.Admin = addressNumber(99) }},
		{"overlong membership", func(f *hostJoinFixture) { f.invite.MembershipTTL = 91 * 86400000 }},
		{"observation exceeds membership", func(f *hostJoinFixture) { f.invite.CapabilityTTL = f.invite.MembershipTTL + 1 }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newHostJoinFixture(t)
			c.mutate(f)
			f.syncJoin(t)
			if _, err := f.resolver.InspectHostJoin(context.Background(), f.input); err == nil {
				t.Fatal("invalid join authority accepted")
			}
		})
	}
	for _, mode := range []string{"RPC unavailable", "source changed during read", "forged package", "already joined"} {
		t.Run(mode, func(t *testing.T) {
			f := newHostJoinFixture(t)
			switch mode {
			case "RPC unavailable":
				f.fail = true
			case "source changed during read":
				f.changeOnRead = f.grant.ID.String()
			case "forged package":
				obj := f.objects[f.invite.ID.String()]
				obj.Type = "0x99::host::HostInvite"
				f.objects[obj.ID] = obj
			case "already joined":
				host := signingAddress(f.input.HostPublicKey)
				f.saveField(t, f.index.ActiveHosts.ID, []byte{4}, host[:], "address", "0x2::object::ID", addressNumber(21))
			}
			if _, err := f.resolver.InspectHostJoin(context.Background(), f.input); err == nil {
				t.Fatal("invalid source accepted")
			}
		})
	}
}

func TestHostAdmissionRebuildsCurrentAndHistoricalState(t *testing.T) {
	for _, mode := range []string{"current", "revoked", "pointer removed", "foreign key", "RPC unavailable"} {
		t.Run(mode, func(t *testing.T) {
			f := newHostJoinFixture(t)
			f.invite.Uses = 1
			member := moveMembership{ID: addressNumber(21), Org: f.org.ID, Host: signingAddress(f.input.HostPublicKey), PublicKey: f.input.HostPublicKey, EncryptionKey: f.input.EncryptionPublicKey, Binding: f.coordinator.ID, Version: 1, Expiry: 1700000300000, Invite: f.invite.ID, Observation: addressNumber(22)}
			f.index.Memberships = append(f.index.Memberships, member.ID)
			if mode == "revoked" {
				member.Revoked = true
			}
			if mode == "foreign key" {
				member.EncryptionKey = make([]byte, 32)
			}
			f.syncJoin(t)
			f.saveObject(t, member.ID, "host::HostMembership", member)
			if mode != "pointer removed" {
				f.saveField(t, f.index.ActiveHosts.ID, []byte{4}, member.Host[:], "address", "0x2::object::ID", member.ID)
			}
			if mode == "RPC unavailable" {
				f.fail = true
			}
			state, err := f.resolver.ReadHostAdmission(context.Background(), f.org.ID.String(), f.invite.ID.String(), f.input.HostPublicKey, f.input.EncryptionPublicKey)
			if mode == "foreign key" || mode == "RPC unavailable" {
				if err == nil {
					t.Fatal("invalid reconstruction treated as a membership")
				}
				return
			}
			if err != nil || state.MembershipID != member.ID.String() || state.ObservationCapability != member.Observation.String() || state.Current != (mode == "current") {
				t.Fatalf("wrong membership projection %+v %v", state, err)
			}
		})
	}
}
