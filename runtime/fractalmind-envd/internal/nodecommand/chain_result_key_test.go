package nodecommand

import (
	"context"
	"encoding/binary"
	"encoding/hex"
	"testing"
)

func TestChainResultKeyBinding(t *testing.T) {
	for _, mode := range []string{"valid", "wrong org", "wrong member", "wrong Host", "wrong version", "bad size", "bad outer envelope", "bad inner envelope", "wrong parent", "missing"} {
		t.Run(mode, func(t *testing.T) {
			f, fingerprint, _ := executionFixture(t, 1, moveBoundBudgetClaim{Reserved: 20})
			hash, _ := hex.DecodeString(fingerprint)
			name := binary.LittleEndian.AppendUint64(appendBCSBytes(nil, hash), 1)
			wrapped := make([]byte, 132)
			copy(wrapped, "FMW1")
			copy(wrapped[68:], "FME1")
			grant := moveResultKeyGrant{Org: f.org.ID, Membership: f.member.ID, Host: f.member.Host, KeyVersion: 1, WrappedKey: wrapped}
			switch mode {
			case "wrong org":
				grant.Org = addressNumber(99)
			case "wrong member":
				grant.Membership = addressNumber(99)
			case "wrong Host":
				grant.Host = addressNumber(99)
			case "wrong version":
				grant.KeyVersion = 2
			case "bad size":
				grant.WrappedKey = grant.WrappedKey[:131]
			case "bad outer envelope":
				grant.WrappedKey[0] = 0
			case "bad inner envelope":
				grant.WrappedKey[68] = 0
			}
			pkg := f.resolver.packageID
			id := f.saveField(t, f.cap.ID, structKeyTag(pkg, "node_execution", "ResultKeyKey"), name, pkg+"::node_execution::ResultKeyKey", pkg+"::node_execution::ResultKeyGrant", grant)
			if mode == "wrong parent" {
				object := f.objects[id]
				object.OwnerID = f.org.ID.String()
				f.objects[id] = object
			}
			if mode == "missing" {
				delete(f.objects, id)
			}
			got, err := f.resolver.ReadResultKey(context.Background(), f.cap.ID.String(), fingerprint, 1)
			if mode == "valid" {
				if err != nil || got.HostAddress != f.member.Host.String() || len(got.WrappedKey) != 132 {
					t.Fatalf("valid grant err=%v", err)
				}
			} else if err == nil {
				t.Fatalf("invalid grant accepted %+v", got)
			}
		})
	}
}
