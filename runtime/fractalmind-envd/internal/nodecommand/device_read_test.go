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
