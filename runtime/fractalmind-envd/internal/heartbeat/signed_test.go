package heartbeat

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/agent"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/wsauth"
)

type testSigner struct {
	pub     ed25519.PublicKey
	private ed25519.PrivateKey
}

func TestNativeDiscoveryIsSignedAndCannotUpgradeTmuxSource(t *testing.T) {
	inventory, _, err := agent.NewNativeInventory(map[string]string{"files": t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	d := inventory.Discover()
	if d.State != "complete" {
		t.Skip("actual native continuity unsupported or unavailable")
	}
	signer, old, payload := signedFixture(t)
	payload.NativeDiscovery = &d
	// The scan finishes after the base fixture's timestamp; publish current time.
	payload.Timestamp = time.Now()
	proof, err := Sign(signer, old.Scope, old.SessionNonce, 1, payload.Timestamp.UnixMilli()+FreshnessMS, payload)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := Verify(proof, signer.pub, payload.Timestamp.UnixMilli())
	if err != nil || actual.NativeDiscovery == nil || actual.NativeDiscovery.Instances[0].InstanceID != d.Instances[0].InstanceID {
		t.Fatal("native source not preserved", err)
	}
	payload.NativeDiscovery = nil
	payload.Discovery = &d
	if _, err := Sign(signer, old.Scope, old.SessionNonce, 2, payload.Timestamp.UnixMilli()+FreshnessMS, payload); err == nil {
		t.Fatal("native adapter promoted via tmux source")
	}
}

func (s testSigner) PublicKeyBytes() []byte  { return s.pub }
func (s testSigner) Address() string         { return wsauth.DeriveAddress(s.pub) }
func (s testSigner) Sign(data []byte) []byte { return ed25519.Sign(s.private, data) }
func signedFixture(t *testing.T) (testSigner, Signed, *Payload) {
	t.Helper()
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer := testSigner{pub, private}
	id := func(s string) string { return "0x" + strings.Repeat(s, 64) }
	scope := Scope{ChainIdentifier: "TestChain", OrganizationID: id("1"), MembershipID: id("2"), MembershipVersion: "1", BindingID: id("3"), BindingVersion: "1", HostAddress: signer.Address()}
	payload := NewPayload(signer.Address(), "actual-host", nil, time.Now().Add(-time.Second))
	signed, err := Sign(signer, scope, strings.Repeat("a", 64), 1, payload.Timestamp.UnixMilli()+FreshnessMS, payload)
	if err != nil {
		t.Fatal(err)
	}
	return signer, signed, payload
}

func TestSignedHostObservationAuthenticatesOriginalBytesAndScope(t *testing.T) {
	for _, mode := range []string{"valid", "body", "signature", "public key", "Host address", "membership", "binding version", "chain", "organization", "nonce", "expired", "future", "long expiry", "sequence", "unknown payload field"} {
		t.Run(mode, func(t *testing.T) {
			signer, signed, payload := signedFixture(t)
			public := append([]byte(nil), signer.pub...)
			now := payload.Timestamp.UnixMilli()
			switch mode {
			case "body":
				signed.Body = base64.StdEncoding.EncodeToString([]byte(`{"host_id":"forged"}`))
			case "signature":
				signed.Signature = strings.Repeat("0", 128)
			case "public key":
				public[0] ^= 1
			case "Host address":
				signed.HostAddress = "0x" + strings.Repeat("4", 64)
			case "membership":
				signed.MembershipID = "0x" + strings.Repeat("4", 64)
			case "binding version":
				signed.BindingVersion = "2"
			case "chain":
				signed.ChainIdentifier = "OtherChain"
			case "organization":
				signed.OrganizationID = "0x" + strings.Repeat("4", 64)
			case "nonce":
				signed.SessionNonce = strings.Repeat("b", 64)
			case "expired":
				now = signed.ExpiresAtMS
			case "future":
				now -= 5001
			case "long expiry":
				signed.ExpiresAtMS += 1
			case "sequence":
				signed.Sequence = 0
			case "unknown payload field":
				body, _ := base64.StdEncoding.DecodeString(signed.Body)
				var object map[string]any
				json.Unmarshal(body, &object)
				object["unverified_capability"] = "execute"
				body, _ = json.Marshal(object)
				signed.Body = base64.StdEncoding.EncodeToString(body)
				signed.Signature = hex.EncodeToString(signer.Sign(signingText(signed, body)))
			}
			got, err := Verify(signed, public, now)
			if mode == "valid" {
				if err != nil || got.HostID != signer.Address() || got.System.NumCPU < 1 {
					t.Fatal(got, err)
				}
			} else if err == nil {
				t.Fatal("invalid or stale observation verified")
			}
		})
	}
}

func TestSignedHostObservationBoundsAndEncoding(t *testing.T) {
	signer, signed, payload := signedFixture(t)
	for _, value := range []string{"-1", "01", "18446744073709551616"} {
		scope := signed.Scope
		scope.MembershipVersion = value
		if _, err := Sign(signer, scope, signed.SessionNonce, 1, signed.ExpiresAtMS, payload); err == nil {
			t.Fatal("noncanonical version accepted")
		}
	}
	if _, err := Sign(signer, signed.Scope, signed.SessionNonce, MaxSequence+1, signed.ExpiresAtMS, payload); err == nil {
		t.Fatal("unsafe sequence accepted")
	}
	raw, _ := json.Marshal(signed)
	if _, err := DecodeSigned(append(raw, []byte(`{}`)...)); err == nil {
		t.Fatal("trailing envelope accepted")
	}
	if _, err := DecodeSigned(make([]byte, 512<<10+1)); err == nil {
		t.Fatal("oversized envelope accepted")
	}
	if got := Expiry(payload.Timestamp, uint64(signed.ExpiresAtMS-500)); got != signed.ExpiresAtMS-500 {
		t.Fatal("member expiry not enforced")
	}
}
