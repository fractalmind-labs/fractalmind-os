package nodecommand

import (
	"context"
	"testing"
)

func connectionFixture(t *testing.T) *hostJoinFixture {
	f := newHostJoinFixture(t)
	f.index.Memberships = []moveAddress{f.member.ID}
	f.member.Binding = f.coordinator.ID
	f.syncJoin(t)
	return f
}

func TestHostConnectionUsesCurrentPointerAndKeys(t *testing.T) {
	f := connectionFixture(t)
	got, err := f.resolver.ReadHostConnection(context.Background(), f.org.ID.String(), f.member.PublicKey, f.member.EncryptionKey)
	if err != nil {
		t.Fatal(err)
	}
	if got.MembershipID != f.member.ID.String() || got.BindingID != f.coordinator.ID.String() || got.VersionPin == "" || got.HostAddress != f.member.Host.String() {
		t.Fatalf("wrong connection %+v", got)
	}
	url, err := got.WebSocketURL()
	if err != nil || url != "wss://entry.example.invalid/ws" {
		t.Fatal(url, err)
	}
	if _, err = f.resolver.ReadCoordinatorConnection(context.Background(), f.org.ID.String(), f.coordinator.ID.String(), f.coordinator.PublicKey); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{"https://user@entry.invalid", "http://entry.invalid", "https://entry.invalid/path", "https://entry.invalid?q=x", "https://entry.invalid/#x"} {
		if _, err := (HostConnection{Endpoint: invalid}).WebSocketURL(); err == nil {
			t.Fatal("unsafe origin accepted")
		}
	}
}

func TestHostConnectionRejectsStaleForeignAndUnknownAuthority(t *testing.T) {
	for _, mode := range []string{"revoked member", "expired member", "inactive org", "unindexed member", "unindexed binding", "wrong encryption", "foreign org", "revoked binding", "binding signer changed", "unsafe endpoint", "pointer removed", "pointer foreign owner", "RPC unavailable", "changing member"} {
		t.Run(mode, func(t *testing.T) {
			f := connectionFixture(t)
			enc := append([]byte(nil), f.member.EncryptionKey...)
			switch mode {
			case "revoked member":
				f.member.Revoked = true
			case "expired member":
				f.member.Expiry = 1700000000000
			case "inactive org":
				f.org.Active = false
			case "unindexed member":
				f.index.Memberships = nil
			case "unindexed binding":
				f.index.Bindings = nil
			case "wrong encryption":
				enc[0] ^= 1
			case "foreign org":
				f.member.Org = addressNumber(99)
			case "revoked binding":
				f.coordinator.Revoked = true
			case "binding signer changed":
				f.coordinator.Address = addressNumber(99)
			case "unsafe endpoint":
				f.coordinator.Endpoint = "http://entry.invalid"
			}
			f.syncJoin(t)
			pointer, _ := dynamicFieldID(f.index.ActiveHosts.ID.String(), []byte{4}, f.member.Host[:])
			if mode == "pointer removed" {
				delete(f.objects, pointer)
			}
			if mode == "pointer foreign owner" {
				obj := f.objects[pointer]
				obj.OwnerID = addressNumber(99).String()
				f.objects[pointer] = obj
			}
			if mode == "RPC unavailable" {
				f.fail = true
			}
			if mode == "changing member" {
				f.changeOnRead = f.member.ID.String()
				f.reads = map[string]int{}
			}
			if _, err := f.resolver.ReadHostConnection(context.Background(), f.org.ID.String(), f.member.PublicKey, enc); err == nil {
				t.Fatal("non-current or unknown authority accepted")
			}
		})
	}
}

func TestCoordinatorConnectionRejectsDifferentSignerAndBinding(t *testing.T) {
	for _, mode := range []string{"foreign binding", "different key", "revoked", "unindexed", "changed during read", "RPC unavailable"} {
		t.Run(mode, func(t *testing.T) {
			f := connectionFixture(t)
			public := append([]byte(nil), f.coordinator.PublicKey...)
			id := f.coordinator.ID.String()
			switch mode {
			case "foreign binding":
				id = addressNumber(99).String()
			case "different key":
				public[0] ^= 1
			case "revoked":
				f.coordinator.Revoked = true
			case "unindexed":
				f.index.Bindings = nil
			case "changed during read":
				f.changeOnRead = f.coordinator.ID.String()
				f.reads = map[string]int{}
			case "RPC unavailable":
				f.fail = true
			}
			f.syncJoin(t)
			if _, err := f.resolver.ReadCoordinatorConnection(context.Background(), f.org.ID.String(), id, public); err == nil {
				t.Fatal("invalid Coordinator admitted")
			}
		})
	}
}
