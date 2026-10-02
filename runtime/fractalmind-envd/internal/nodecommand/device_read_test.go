package nodecommand

import (
	"context"
	"testing"
)

func TestDeviceReadChecksCurrentScopedGrantAndRole(t *testing.T) {
	for _, mode := range []string{"valid", "read-only phone", "revoked", "expired", "scope", "generation", "no read", "unindexed grant", "unindexed org", "foreign registry", "foreign Human", "removed role", "RPC unavailable", "changing source"} {
		t.Run(mode, func(t *testing.T) {
			f := newHostJoinFixture(t)
			f.grant.EncryptionKey = make([]byte, 32)
			switch mode {
			case "read-only phone":
				f.role.Admin = false
				f.grant.Actions = []byte{1}
			case "revoked":
				f.grant.Revoked = true
			case "expired":
				f.grant.Expiry = 1700000000000
			case "scope":
				f.grant.Org = []moveAddress{addressNumber(99)}
			case "generation":
				f.human.Generation++
			case "no read":
				f.grant.Actions = []byte{4}
			case "unindexed grant":
				f.human.Grants = nil
			case "unindexed org":
				f.human.Organizations = nil
			case "foreign registry":
				f.human.Registry = addressNumber(99)
			case "foreign Human":
				f.grant.Human = addressNumber(99)
			case "removed role":
				f.role.Active = false
			case "RPC unavailable":
				f.fail = true
			case "changing source":
				f.changeOnRead = f.grant.ID.String()
			}
			f.syncJoin(t)
			pin, err := f.resolver.VerifyDeviceRead(context.Background(), DeviceReadInput{Network: "localnet", ProtocolRegistry: f.registry.ID.String(), OrganizationID: f.org.ID.String(), HumanID: f.human.ID.String(), GrantID: f.grant.ID.String(), DeviceAddress: f.grant.Device.String()})
			if mode == "valid" || mode == "read-only phone" {
				if err != nil || pin == "" {
					t.Fatal(pin, err)
				}
			} else if err == nil {
				t.Fatal("stale/unknown read authority accepted")
			}
		})
	}
}

func TestDeviceTransportPinIgnoresExpectedEvidenceWritesButRetainsAuthority(t *testing.T) {
	f := newHostJoinFixture(t)
	f.grant.EncryptionKey = make([]byte, 32)
	f.syncJoin(t)
	input := DeviceReadInput{Network: "localnet", ProtocolRegistry: f.registry.ID.String(), OrganizationID: f.org.ID.String(), HumanID: f.human.ID.String(), GrantID: f.grant.ID.String(), DeviceAddress: f.grant.Device.String()}
	before, err := f.resolver.VerifyDeviceRead(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	// A status result and execution ledger update bump Organization's object
	// version without changing grant, generation, role, active flag or admin.
	obj := f.objects[f.org.ID.String()]
	obj.Version++
	f.objects[obj.ID] = obj
	after, err := f.resolver.VerifyDeviceRead(context.Background(), input)
	if err != nil || before != after {
		t.Fatal("expected execution evidence write invalidated authority", err)
	}
	f.grant.Version++
	f.syncJoin(t)
	changed, err := f.resolver.VerifyDeviceRead(context.Background(), input)
	if err != nil || changed == before {
		t.Fatal("device version change retained authority pin", err)
	}
	f.grant.Revoked = true
	f.syncJoin(t)
	if _, err := f.resolver.VerifyDeviceRead(context.Background(), input); err == nil {
		t.Fatal("revoked device retained authority")
	}
}

func TestDeviceCommandTransportRequiresOperateIndependentlyOfRead(t *testing.T) {
	for _, actions := range [][]byte{{1}, {1, 2}, {2}, {1, 4}} {
		f := newHostJoinFixture(t)
		f.grant.EncryptionKey = make([]byte, 32)
		f.grant.Actions = actions
		f.syncJoin(t)
		input := DeviceReadInput{Network: "localnet", ProtocolRegistry: f.registry.ID.String(), OrganizationID: f.org.ID.String(), HumanID: f.human.ID.String(), GrantID: f.grant.ID.String(), DeviceAddress: f.grant.Device.String(), RequiredAction: 2}
		_, err := f.resolver.VerifyDeviceRead(context.Background(), input)
		if (len(actions) == 2 && actions[1] == 2) != (err == nil) {
			t.Fatalf("actions %v: %v", actions, err)
		}
		input.RequiredAction = 3
		if _, err := f.resolver.VerifyDeviceRead(context.Background(), input); err == nil {
			t.Fatal("unsupported transport action admitted")
		}
	}
}
