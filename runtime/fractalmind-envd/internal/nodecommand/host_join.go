package nodecommand

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"net/url"
	"strings"

	"github.com/block-vision/sui-go-sdk/mystenbcs"
	"golang.org/x/crypto/blake2b"
	"golang.org/x/crypto/hkdf"
)

// HostInvitation is a short-lived bearer credential. No code/entropy/seed is
// exported for journaling, configuration, argv or diagnostic output.
type HostInvitation struct {
	Network, ID string
	private     ed25519.PrivateKey
}

func (i *HostInvitation) String() string   { return "HostInvitation{credential:redacted}" }
func (i *HostInvitation) GoString() string { return i.String() }

func ParseHostInvitation(code []byte, network string) (*HostInvitation, error) {
	parts := strings.Split(strings.TrimSpace(string(code)), ":")
	invalid := func() (*HostInvitation, error) { return nil, fmt.Errorf("invalid Host invitation or network") }
	if network != "localnet" && network != "testnet" && network != "devnet" && network != "mainnet" {
		return invalid()
	}
	if len(parts) != 5 || parts[0] != "FHI1" || parts[1] != network || len(parts[2]) != 66 || len(parts[3]) != 64 || len(parts[4]) != 8 {
		return invalid()
	}
	address, err := chainAddress(parts[2])
	if err != nil || address.String() != parts[2] {
		return invalid()
	}
	entropy, err := hex.DecodeString(parts[3])
	if err != nil || hex.EncodeToString(entropy) != parts[3] {
		return invalid()
	}
	defer clear(entropy)
	sum := sha256.Sum256([]byte(strings.Join(parts[:4], ":")))
	checksum := hex.EncodeToString(sum[:4])
	if subtle.ConstantTimeCompare([]byte(checksum), []byte(parts[4])) != 1 {
		return invalid()
	}
	seed := make([]byte, 32)
	defer clear(seed)
	if _, err = io.ReadFull(hkdf.New(sha256.New, entropy, []byte("fractalmind.host-invite.v1"), []byte(network)), seed); err != nil {
		return invalid()
	}
	return &HostInvitation{Network: network, ID: parts[2], private: ed25519.NewKeyFromSeed(seed)}, nil
}
func (i *HostInvitation) Close() { clear(i.private); i.private = nil }
func (i *HostInvitation) PublicKey() []byte {
	if len(i.private) != ed25519.PrivateKeySize {
		return nil
	}
	return append([]byte(nil), i.private[32:]...)
}

type HostJoinInput struct {
	Network, ProtocolRegistry, InviteID, ExpectedOrganization, HostAddress string
	ProofPublicKey, HostPublicKey, EncryptionPublicKey                     []byte
}
type HostJoinPlan struct {
	Network              string `json:"network"`
	InviteID             string `json:"invite_id"`
	OrganizationID       string `json:"organization_id"`
	OrganizationName     string `json:"organization_name"`
	BindingID            string `json:"coordinator_binding"`
	BindingVersion       uint64 `json:"binding_version"`
	CoordinatorAddress   string `json:"coordinator_address"`
	CoordinatorPublicKey string `json:"coordinator_public_key"`
	Endpoint             string `json:"coordinator_endpoint"`
	IssuerHuman          string `json:"issuer_human"`
	IssuerGrant          string `json:"issuer_grant"`
	ExpiresAtMS          uint64 `json:"invite_expires_at_ms"`
	MembershipTTLMS      uint64 `json:"membership_ttl_ms"`
	ObservationTTLMS     uint64 `json:"observation_ttl_ms"`
	ClockMS              uint64 `json:"clock_ms"`
	ProofExpiresAtMS     uint64 `json:"proof_expires_at_ms"`
	VersionPin           string `json:"-"`
	proofPublicKey       []byte
}
type moveInvite struct {
	ID, Org, Binding                                      moveAddress
	BindingVersion                                        uint64
	IssuerHuman, IssuerDevice, IssuerGrant                moveAddress
	GrantVersion, Generation                              uint64
	ProofPublicKey                                        []byte
	TemplateVersion, Expiry, MembershipTTL, CapabilityTTL uint64
	MaxUses, Uses                                         uint8
	Revoked                                               bool
}
type moveProtocolRegistry struct {
	ID                   moveAddress
	Organizations, Names moveTable
	Count                uint64
}
type moveIdentityRegistry struct {
	ID, ProtocolRegistry moveAddress
	Recoveries, Devices  moveTable
}

func (i *HostInvitation) SignJoin(plan HostJoinPlan, hostPublic, encryptionPublic []byte) ([]byte, error) {
	if len(i.private) != 64 || i.ID != plan.InviteID || i.Network != plan.Network || !equalBytes(i.PublicKey(), plan.proofPublicKey) || len(hostPublic) != 32 || len(encryptionPublic) != 32 {
		return nil, fmt.Errorf("invalid Host invitation proof context")
	}
	org, err := chainAddress(plan.OrganizationID)
	if err != nil {
		return nil, err
	}
	invite, err := chainAddress(plan.InviteID)
	if err != nil {
		return nil, err
	}
	binding, err := chainAddress(plan.BindingID)
	if err != nil {
		return nil, err
	}
	host := signingAddress(hostPublic)
	intent := struct {
		Domain               []byte
		Invite, Org, Binding moveAddress
		BindingVersion       uint64
		Host                 moveAddress
		Public, Encryption   []byte
		Expiry               uint64
	}{[]byte("fractalmind.host-invite.v1"), invite, org, binding, plan.BindingVersion, host, hostPublic, encryptionPublic, plan.ProofExpiresAtMS}
	bytes, err := mystenbcs.Marshal(intent)
	if err != nil {
		return nil, err
	}
	return ed25519.Sign(i.private, bytes), nil
}
func equalBytes(a, b []byte) bool { return len(a) == len(b) && subtle.ConstantTimeCompare(a, b) == 1 }
func signingAddress(public []byte) moveAddress { // same Ed25519 flag/address derivation as Sui
	return moveAddress(blake2b.Sum256(append([]byte{0}, public...)))
}

// InspectHostJoin consumes no capability, performs no transaction, and treats
// every persistent source as Sui-owned. Shared UID and typed dynamic-field
// provenance are checked by the same reader used for protected execution.
func (s *ChainAuthorityResolver) InspectHostJoin(ctx context.Context, input HostJoinInput) (HostJoinPlan, error) {
	var out HostJoinPlan
	if input.Network != "localnet" && input.Network != "devnet" && input.Network != "testnet" && input.Network != "mainnet" {
		return out, fmt.Errorf("unsupported Host invitation network")
	}
	for _, id := range []string{input.ProtocolRegistry, input.InviteID, input.HostAddress} {
		a, err := chainAddress(id)
		if err != nil || a.String() != id {
			return out, fmt.Errorf("canonical join object IDs and Host address required")
		}
	}
	if len(input.ProofPublicKey) != 32 || len(input.HostPublicKey) != 32 || len(input.EncryptionPublicKey) != 32 || signingAddress(input.HostPublicKey).String() != input.HostAddress {
		return out, fmt.Errorf("Host or invitation public keys mismatch")
	}
	r := &chainRead{resolver: s, versions: map[string]uint64{}}
	var registry moveProtocolRegistry
	if err := r.object(ctx, input.ProtocolRegistry, "organization::ProtocolRegistry", &registry); err != nil {
		return out, err
	}
	var identityID moveAddress
	pkg := s.packageID
	if err := r.field(ctx, input.ProtocolRegistry, structKeyTag(pkg, "identity", "RegistryBinding"), []byte{0}, pkg+"::identity::RegistryBinding", "0x2::object::ID", &identityID); err != nil {
		return out, err
	}
	var identity moveIdentityRegistry
	if err := r.object(ctx, identityID.String(), "identity::IdentityRegistry", &identity); err != nil {
		return out, err
	}
	if identity.ProtocolRegistry.String() != input.ProtocolRegistry {
		return out, fmt.Errorf("identity registry provenance mismatch")
	}
	var invite moveInvite
	if err := r.object(ctx, input.InviteID, "host::HostInvite", &invite); err != nil {
		return out, err
	}
	if !equalBytes(invite.ProofPublicKey, input.ProofPublicKey) || invite.TemplateVersion != 1 || invite.MaxUses != 1 {
		return out, fmt.Errorf("invitation proof or template mismatch")
	}
	if invite.Revoked || invite.Uses != 0 {
		return out, fmt.Errorf("invitation revoked or consumed")
	}
	if input.ExpectedOrganization != "" && input.ExpectedOrganization != invite.Org.String() {
		return out, fmt.Errorf("invitation belongs to a different organization")
	}
	var org moveOrganization
	var binding moveCoordinator
	var human moveHuman
	var grant moveGrant
	if err := r.object(ctx, invite.Org.String(), "organization::Organization", &org); err != nil {
		return out, err
	}
	if err := r.object(ctx, invite.Binding.String(), "host::CoordinatorBinding", &binding); err != nil {
		return out, err
	}
	if err := r.object(ctx, invite.IssuerHuman.String(), "identity::HumanIdentity", &human); err != nil {
		return out, err
	}
	if err := r.object(ctx, invite.IssuerGrant.String(), "identity::DeviceGrant", &grant); err != nil {
		return out, err
	}
	if !org.Active || binding.Revoked || binding.Org != org.ID || binding.Version != invite.BindingVersion || !sameSigningAddress(binding.PublicKey, binding.Address) || len(binding.PublicKey) != 32 {
		return out, fmt.Errorf("Coordinator binding revoked or changed")
	}
	endpoint, err := url.Parse(binding.Endpoint)
	if err != nil || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" || endpoint.Host == "" || (endpoint.Path != "" && endpoint.Path != "/") ||
		(endpoint.Scheme != "https" && (endpoint.Scheme != "http" || (endpoint.Hostname() != "localhost" && endpoint.Hostname() != "127.0.0.1" && endpoint.Hostname() != "::1"))) {
		return out, fmt.Errorf("unsafe Coordinator endpoint")
	}
	if human.Registry != identity.ID || human.Network != input.Network || human.Generation != invite.Generation || grant.Human != human.ID || grant.Device != invite.IssuerDevice || grant.Generation != human.Generation || grant.Version != invite.GrantVersion || grant.Revoked || !containsByte(grant.Actions, 4) ||
		!containsAddress(human.Grants, grant.ID) || !containsAddress(human.Organizations, org.ID) || len(grant.Org) > 1 || (len(grant.Org) == 1 && grant.Org[0] != org.ID) {
		return out, fmt.Errorf("invitation issuer authority changed")
	}
	var role moveRole
	if err := r.field(ctx, human.Roles.ID.String(), structKeyTag("0x2", "object", "ID"), org.ID[:], "0x2::object::ID", pkg+"::identity::OrgRole", &role); err != nil {
		return out, err
	}
	if !role.Active || !role.Admin || role.Owner != org.Admin || role.Version == 0 {
		return out, fmt.Errorf("invitation issuer organization role changed")
	}
	var index moveHostIndex
	if err := r.field(ctx, org.ID.String(), structKeyTag(pkg, "host", "HostIndexBinding"), []byte{0}, pkg+"::host::HostIndexBinding", pkg+"::host::HostIndex", &index); err != nil {
		return out, err
	}
	if !containsAddress(index.Invitations, invite.ID) || !containsAddress(index.Bindings, binding.ID) {
		return out, fmt.Errorf("invitation is not indexed by its organization")
	}
	hostAddress, _ := chainAddress(input.HostAddress)
	var existing moveAddress
	err = r.field(ctx, index.ActiveHosts.ID.String(), []byte{4}, hostAddress[:], "address", "0x2::object::ID", &existing)
	if err == nil {
		return out, fmt.Errorf("Host already has a current membership; inspect it instead of joining again")
	}
	if !errors.Is(err, ErrChainObjectNotFound) {
		return out, err
	}
	clock, err := s.ChainTime(ctx)
	if err != nil {
		return out, err
	}
	now := uint64(clock)
	const day = 86400000
	if invite.Expiry > math.MaxInt64 || invite.Expiry <= now || grant.Expiry <= now || invite.MembershipTTL == 0 || invite.MembershipTTL > 90*day || invite.CapabilityTTL == 0 || invite.CapabilityTTL > invite.MembershipTTL || now > math.MaxInt64-invite.MembershipTTL {
		return out, fmt.Errorf("invitation/issuer expired or invalid membership bounds")
	}
	proofExpiry := now + 120000
	if proofExpiry > invite.Expiry {
		proofExpiry = invite.Expiry
	}
	pin, err := r.joinPin(ctx)
	if err != nil {
		return out, err
	}
	return HostJoinPlan{Network: input.Network, InviteID: invite.ID.String(), OrganizationID: org.ID.String(), OrganizationName: org.Name, BindingID: binding.ID.String(), BindingVersion: binding.Version, CoordinatorAddress: binding.Address.String(), CoordinatorPublicKey: hex.EncodeToString(binding.PublicKey), Endpoint: binding.Endpoint, IssuerHuman: human.ID.String(), IssuerGrant: grant.ID.String(), ExpiresAtMS: invite.Expiry, MembershipTTLMS: invite.MembershipTTL, ObservationTTLMS: invite.CapabilityTTL, ClockMS: now, ProofExpiresAtMS: proofExpiry, VersionPin: pin, proofPublicKey: append([]byte(nil), invite.ProofPublicKey...)}, nil
}
func containsAddress(values []moveAddress, value moveAddress) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
func (r *chainRead) joinPin(ctx context.Context) (string, error) {
	return r.versionPin(ctx, fmt.Errorf("join authority changed during inspection: %w", ErrChainSnapshotChanged))
}

type HostAdmissionState struct {
	OrganizationID        string `json:"organization_id"`
	InviteID              string `json:"invite_id"`
	MembershipID          string `json:"membership_id"`
	HostAddress           string `json:"host_address"`
	BindingID             string `json:"coordinator_binding"`
	ObservationCapability string `json:"observation_capability"`
	ExpiresAtMS           uint64 `json:"expires_at_ms"`
	Revoked               bool   `json:"revoked"`
	Current               bool   `json:"current_membership"`
}

// ReadHostAdmission reconstructs qualification after restart without a bearer
// code. A historical membership never becomes current from its version number.
func (s *ChainAuthorityResolver) ReadHostAdmission(ctx context.Context, orgID, inviteID string, hostPublic, encryptionPublic []byte) (HostAdmissionState, error) {
	var out HostAdmissionState
	orgAddress, err := chainAddress(orgID)
	if err != nil || orgAddress.String() != orgID || len(hostPublic) != 32 || len(encryptionPublic) != 32 {
		return out, fmt.Errorf("invalid Host admission context")
	}
	inviteAddress, err := chainAddress(inviteID)
	if err != nil || inviteAddress.String() != inviteID {
		return out, fmt.Errorf("invalid invitation ID")
	}
	r := &chainRead{resolver: s, versions: map[string]uint64{}}
	var org moveOrganization
	var index moveHostIndex
	var invite moveInvite
	if err = r.object(ctx, orgID, "organization::Organization", &org); err != nil {
		return out, err
	}
	if err = r.object(ctx, inviteID, "host::HostInvite", &invite); err != nil {
		return out, err
	}
	if invite.Org != orgAddress || invite.Uses != 1 {
		return out, fmt.Errorf("invitation has not been redeemed for this organization")
	}
	pkg := s.packageID
	if err = r.field(ctx, orgID, structKeyTag(pkg, "host", "HostIndexBinding"), []byte{0}, pkg+"::host::HostIndexBinding", pkg+"::host::HostIndex", &index); err != nil {
		return out, err
	}
	if !containsAddress(index.Invitations, inviteAddress) || len(index.Memberships) > 1000 {
		return out, fmt.Errorf("invalid membership directory")
	}
	var found *moveMembership
	for _, id := range index.Memberships {
		var member moveMembership
		if err = r.object(ctx, id.String(), "host::HostMembership", &member); err != nil {
			return out, err
		}
		if member.Org != orgAddress {
			return out, fmt.Errorf("foreign membership")
		}
		if member.Invite == inviteAddress && member.Host == signingAddress(hostPublic) {
			if found != nil {
				return out, fmt.Errorf("ambiguous source invitation membership")
			}
			copy := member
			found = &copy
		}
	}
	if found == nil {
		return out, ErrChainObjectNotFound
	}
	if !equalBytes(found.PublicKey, hostPublic) || !equalBytes(found.EncryptionKey, encryptionPublic) || found.Binding != invite.Binding {
		return out, fmt.Errorf("Host membership key/binding mismatch")
	}
	var binding moveCoordinator
	if err = r.object(ctx, found.Binding.String(), "host::CoordinatorBinding", &binding); err != nil {
		return out, err
	}
	if binding.Org != orgAddress || !containsAddress(index.Bindings, binding.ID) {
		return out, fmt.Errorf("foreign Coordinator binding")
	}
	var current moveAddress
	err = r.field(ctx, index.ActiveHosts.ID.String(), []byte{4}, found.Host[:], "address", "0x2::object::ID", &current)
	if err != nil && !errors.Is(err, ErrChainObjectNotFound) {
		return out, err
	}
	clock, err := s.ChainTime(ctx)
	if err != nil {
		return out, err
	}
	if _, err = r.joinPin(ctx); err != nil {
		return out, err
	}
	return HostAdmissionState{OrganizationID: orgID, InviteID: inviteID, MembershipID: found.ID.String(), HostAddress: found.Host.String(), BindingID: binding.ID.String(), ObservationCapability: found.Observation.String(), ExpiresAtMS: found.Expiry, Revoked: found.Revoked, Current: current == found.ID && org.Active && !binding.Revoked && !found.Revoked && found.Expiry > uint64(clock)}, nil
}
