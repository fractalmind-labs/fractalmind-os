package nodecommand

import (
	"context"
	"encoding/hex"
	"fmt"
	"net/url"
)

// HostConnection is a current chain observation, not a stored permission or
// online claim. Callers re-read it before reconnecting or protected routing.
type HostConnection struct {
	OrganizationID, MembershipID, BindingID, HostAddress string
	CoordinatorAddress, CoordinatorPublicKey, Endpoint   string
	MembershipVersion, BindingVersion, ExpiresAtMS       uint64
	VersionPin                                           string
}

func coordinatorURL(endpoint string) (*url.URL, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Host == "" || (u.Path != "" && u.Path != "/") ||
		(u.Scheme != "https" && (u.Scheme != "http" || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1"))) {
		return nil, fmt.Errorf("unsafe Coordinator endpoint")
	}
	return u, nil
}

func (h HostConnection) WebSocketURL() (string, error) {
	u, err := coordinatorURL(h.Endpoint)
	if err != nil {
		return "", err
	}
	if u.Scheme == "https" {
		u.Scheme = "wss"
	} else {
		u.Scheme = "ws"
	}
	u.Path = "/ws"
	return u.String(), nil
}

func (s *ChainAuthorityResolver) connectionDirectory(ctx context.Context, r *chainRead, orgID string) (moveOrganization, moveHostIndex, error) {
	var org moveOrganization
	var index moveHostIndex
	address, err := chainAddress(orgID)
	if err != nil || address.String() != orgID {
		return org, index, fmt.Errorf("canonical organization required")
	}
	if err = r.object(ctx, orgID, "organization::Organization", &org); err != nil {
		return org, index, err
	}
	if !org.Active {
		return org, index, fmt.Errorf("organization inactive")
	}
	pkg := s.packageID
	err = r.field(ctx, orgID, structKeyTag(pkg, "host", "HostIndexBinding"), []byte{0}, pkg+"::host::HostIndexBinding", pkg+"::host::HostIndex", &index)
	return org, index, err
}

// ReadCoordinatorConnection proves a pinned binding is indexed by this org and
// belongs to the signer of the running Coordinator. No worker-supplied ID is
// allowed to select another organization or Coordinator identity.
func (s *ChainAuthorityResolver) ReadCoordinatorConnection(ctx context.Context, orgID, bindingID string, coordinatorPublic []byte) (HostConnection, error) {
	var out HostConnection
	r := &chainRead{resolver: s, versions: map[string]uint64{}}
	org, index, err := s.connectionDirectory(ctx, r, orgID)
	if err != nil {
		return out, err
	}
	id, err := chainAddress(bindingID)
	if err != nil || id.String() != bindingID || !containsAddress(index.Bindings, id) {
		return out, fmt.Errorf("Coordinator binding is not in this organization")
	}
	var binding moveCoordinator
	if err = r.object(ctx, bindingID, "host::CoordinatorBinding", &binding); err != nil {
		return out, err
	}
	if binding.Org != org.ID || binding.Revoked || binding.Version == 0 || len(coordinatorPublic) != 32 || !equalBytes(binding.PublicKey, coordinatorPublic) || !sameSigningAddress(binding.PublicKey, binding.Address) {
		return out, fmt.Errorf("Coordinator binding revoked or signer changed")
	}
	if _, err = coordinatorURL(binding.Endpoint); err != nil {
		return out, err
	}
	pin, err := r.joinPin(ctx)
	if err != nil {
		return out, err
	}
	return HostConnection{OrganizationID: orgID, BindingID: bindingID, BindingVersion: binding.Version, CoordinatorAddress: binding.Address.String(), CoordinatorPublicKey: hex.EncodeToString(binding.PublicKey), Endpoint: binding.Endpoint, VersionPin: pin}, nil
}

// ReadHostConnection follows the exact active_hosts pointer using the verified
// signing key. Hostname, PID, old invite receipts and historical membership
// records cannot authorize a connection. encryptionPublic is additionally
// required on the worker; the Coordinator proves possession of the signing key.
func (s *ChainAuthorityResolver) ReadHostConnection(ctx context.Context, orgID string, hostPublic, encryptionPublic []byte) (HostConnection, error) {
	var out HostConnection
	if len(hostPublic) != 32 || (encryptionPublic != nil && len(encryptionPublic) != 32) {
		return out, fmt.Errorf("invalid Host public keys")
	}
	r := &chainRead{resolver: s, versions: map[string]uint64{}}
	org, index, err := s.connectionDirectory(ctx, r, orgID)
	if err != nil {
		return out, err
	}
	host := signingAddress(hostPublic)
	var current moveAddress
	if err = r.field(ctx, index.ActiveHosts.ID.String(), []byte{4}, host[:], "address", "0x2::object::ID", &current); err != nil {
		return out, err
	}
	if !containsAddress(index.Memberships, current) {
		return out, fmt.Errorf("current Host membership is not indexed")
	}
	var member moveMembership
	if err = r.object(ctx, current.String(), "host::HostMembership", &member); err != nil {
		return out, err
	}
	if member.Org != org.ID || member.Host != host || member.Revoked || member.Version == 0 || !equalBytes(member.PublicKey, hostPublic) || len(member.EncryptionKey) != 32 || (encryptionPublic != nil && !equalBytes(member.EncryptionKey, encryptionPublic)) {
		return out, fmt.Errorf("Host membership revoked or keys changed")
	}
	var binding moveCoordinator
	if !containsAddress(index.Bindings, member.Binding) {
		return out, fmt.Errorf("Host Coordinator is not indexed")
	}
	if err = r.object(ctx, member.Binding.String(), "host::CoordinatorBinding", &binding); err != nil {
		return out, err
	}
	if binding.Org != org.ID || binding.Revoked || binding.Version == 0 || !sameSigningAddress(binding.PublicKey, binding.Address) || len(binding.PublicKey) != 32 {
		return out, fmt.Errorf("Host Coordinator revoked or changed")
	}
	if _, err = coordinatorURL(binding.Endpoint); err != nil {
		return out, err
	}
	clock, err := s.ChainTime(ctx)
	if err != nil {
		return out, err
	}
	if clock < 0 || member.Expiry <= uint64(clock) {
		return out, fmt.Errorf("Host membership expired")
	}
	pin, err := r.joinPin(ctx)
	if err != nil {
		return out, err
	}
	return HostConnection{OrganizationID: orgID, MembershipID: member.ID.String(), HostAddress: host.String(), MembershipVersion: member.Version, BindingID: binding.ID.String(), BindingVersion: binding.Version, CoordinatorAddress: binding.Address.String(), CoordinatorPublicKey: hex.EncodeToString(binding.PublicKey), Endpoint: binding.Endpoint, ExpiresAtMS: member.Expiry, VersionPin: pin}, nil
}
