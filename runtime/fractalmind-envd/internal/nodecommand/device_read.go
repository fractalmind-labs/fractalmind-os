package nodecommand

import (
	"context"
	"encoding/json"
	"fmt"
)

type DeviceReadInput struct {
	Network, ProtocolRegistry, OrganizationID, HumanID, GrantID, DeviceAddress string
	RequiredAction                                                             byte
}

// VerifyDeviceRead checks the current org role and a device-specific grant;
// public identity IDs, Host membership and an HTTP token are not device authority.
func (s *ChainAuthorityResolver) VerifyDeviceRead(ctx context.Context, input DeviceReadInput) (string, error) {
	if input.RequiredAction == 0 {
		input.RequiredAction = 1
	}
	if input.RequiredAction != 1 && input.RequiredAction != 2 {
		return "", fmt.Errorf("unsupported device transport action")
	}
	for _, id := range []string{input.ProtocolRegistry, input.OrganizationID, input.HumanID, input.GrantID, input.DeviceAddress} {
		a, err := chainAddress(id)
		if err != nil || a.String() != id {
			return "", fmt.Errorf("canonical device read IDs required")
		}
	}
	if input.Network != "localnet" && input.Network != "devnet" && input.Network != "testnet" && input.Network != "mainnet" {
		return "", fmt.Errorf("device network required")
	}
	r := &chainRead{resolver: s, versions: map[string]uint64{}}
	var protocol moveProtocolRegistry
	if err := r.object(ctx, input.ProtocolRegistry, "organization::ProtocolRegistry", &protocol); err != nil {
		return "", err
	}
	var identityID moveAddress
	pkg := s.packageID
	if err := r.field(ctx, input.ProtocolRegistry, structKeyTag(pkg, "identity", "RegistryBinding"), []byte{0}, pkg+"::identity::RegistryBinding", "0x2::object::ID", &identityID); err != nil {
		return "", err
	}
	var registry moveIdentityRegistry
	var human moveHuman
	var grant moveGrant
	var org moveOrganization
	for _, item := range []struct {
		id, kind string
		value    any
	}{{identityID.String(), "identity::IdentityRegistry", &registry}, {input.HumanID, "identity::HumanIdentity", &human}, {input.GrantID, "identity::DeviceGrant", &grant}, {input.OrganizationID, "organization::Organization", &org}} {
		if err := r.object(ctx, item.id, item.kind, item.value); err != nil {
			return "", err
		}
	}
	device, _ := chainAddress(input.DeviceAddress)
	if registry.ProtocolRegistry != protocol.ID || human.Registry != registry.ID || human.Network != input.Network || !org.Active ||
		grant.Human != human.ID || grant.Device != device || grant.Revoked || grant.Version == 0 || human.Generation == 0 || grant.Generation != human.Generation || len(grant.EncryptionKey) != 32 ||
		!containsAddress(human.Grants, grant.ID) || !containsAddress(human.Organizations, org.ID) || len(grant.Org) > 1 || (len(grant.Org) == 1 && grant.Org[0] != org.ID) || !containsByte(grant.Actions, 1) || !containsByte(grant.Actions, input.RequiredAction) {
		return "", fmt.Errorf("current device read grant required")
	}
	var role moveRole
	if err := r.field(ctx, human.Roles.ID.String(), structKeyTag("0x2", "object", "ID"), org.ID[:], "0x2::object::ID", pkg+"::identity::OrgRole", &role); err != nil {
		return "", err
	}
	if !role.Active || role.Version == 0 || role.Owner != org.Admin {
		return "", fmt.Errorf("current organization role required")
	}
	clock, err := s.ChainTime(ctx)
	if err != nil {
		return "", err
	}
	if clock < 0 || grant.Expiry <= uint64(clock) {
		return "", fmt.Errorf("device read grant expired")
	}
	if _, err := r.joinPin(ctx); err != nil {
		return "", err
	}
	// Executing a command legitimately mutates Organization (execution ledger,
	// encrypted evidence). Pin authority, not its unrelated object version.
	// Every call still validates exact sources and rechecks their versions for a
	// stable snapshot before producing this digest.
	semantic, err := json.Marshal([]any{input.Network, protocol.ID, registry, human, grant, role, org.ID, org.Admin, org.Active, input.RequiredAction})
	if err != nil {
		return "", err
	}
	return hashBytes(semantic), nil
}
