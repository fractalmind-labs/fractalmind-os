package wsauth

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"testing"
)

// testSigner is a minimal Signer backed by an Ed25519 key, mirroring
// sui.Keypair's behaviour.
type testSigner struct {
	priv ed25519.PrivateKey
	pub  ed25519.PublicKey
}

func newTestSigner(t *testing.T) *testSigner {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return &testSigner{priv: priv, pub: pub}
}

func (s *testSigner) Sign(data []byte) []byte { return ed25519.Sign(s.priv, data) }
func (s *testSigner) PublicKeyBytes() []byte  { return s.pub }
func (s *testSigner) Address() string         { return DeriveAddress(s.pub) }

func TestProveVerifyRoundTrip(t *testing.T) {
	signer := newTestSigner(t)
	nonce, _, err := NewNonce()
	if err != nil {
		t.Fatalf("NewNonce: %v", err)
	}
	proof := Prove(signer, nonce)
	addr, err := VerifyProof(proof, nonce)
	if err != nil {
		t.Fatalf("VerifyProof: %v", err)
	}
	if addr != signer.Address() {
		t.Fatalf("verified address = %s, want %s", addr, signer.Address())
	}
}

func TestVerifyRejectsWrongNonce(t *testing.T) {
	signer := newTestSigner(t)
	nonce, _, _ := NewNonce()
	proof := Prove(signer, nonce)

	other, _, _ := NewNonce()
	if _, err := VerifyProof(proof, other); err == nil {
		t.Fatal("expected verification to fail for a different nonce (replay/wrong-challenge defense)")
	}
}

func TestVerifyRejectsForgedAddress(t *testing.T) {
	signer := newTestSigner(t)
	nonce, _, _ := NewNonce()
	proof := Prove(signer, nonce)
	// Attacker keeps a valid signature+pubkey but claims a different address.
	proof.Address = "0x" + hex.EncodeToString(make([]byte, 32))
	if _, err := VerifyProof(proof, nonce); err == nil {
		t.Fatal("expected verification to fail when claimed address is not derived from the public key")
	}
}

func TestVerifyRejectsTamperedSignature(t *testing.T) {
	signer := newTestSigner(t)
	nonce, _, _ := NewNonce()
	proof := Prove(signer, nonce)
	// Flip one signature byte.
	sig, _ := hex.DecodeString(proof.Signature)
	sig[0] ^= 0xff
	proof.Signature = hex.EncodeToString(sig)
	if _, err := VerifyProof(proof, nonce); err == nil {
		t.Fatal("expected verification to fail for a tampered signature")
	}
}

func TestVerifyRejectsMismatchedKey(t *testing.T) {
	// Sign with one key but present another key's pubkey/address.
	signer := newTestSigner(t)
	other := newTestSigner(t)
	nonce, _, _ := NewNonce()
	proof := Prove(signer, nonce)
	proof.PublicKey = hex.EncodeToString(other.PublicKeyBytes())
	proof.Address = other.Address()
	if _, err := VerifyProof(proof, nonce); err == nil {
		t.Fatal("expected verification to fail when the signature was not made by the presented key")
	}
}

func TestVerifyRejectsBadSizes(t *testing.T) {
	signer := newTestSigner(t)
	nonce, _, _ := NewNonce()
	good := Prove(signer, nonce)

	cases := map[string]func(Proof) Proof{
		"short pubkey": func(p Proof) Proof { p.PublicKey = "abcd"; return p },
		"short sig":    func(p Proof) Proof { p.Signature = "abcd"; return p },
		"bad hex pub":  func(p Proof) Proof { p.PublicKey = "zz"; return p },
	}
	for name, mut := range cases {
		if _, err := VerifyProof(mut(good), nonce); err == nil {
			t.Fatalf("%s: expected error", name)
		}
	}
	// Short nonce.
	if _, err := VerifyProof(good, []byte("short")); err == nil {
		t.Fatal("short nonce: expected error")
	}
}

func TestDecodeNonce(t *testing.T) {
	_, hexN, _ := NewNonce()
	b, err := DecodeNonce(hexN)
	if err != nil || len(b) != NonceSize {
		t.Fatalf("DecodeNonce round trip failed: err=%v len=%d", err, len(b))
	}
	if _, err := DecodeNonce("abcd"); err == nil {
		t.Fatal("expected error for short nonce hex")
	}
}

func TestAddressAllowed(t *testing.T) {
	if !AddressAllowed("0xabc", nil) {
		t.Fatal("empty allowlist should permit any verified identity")
	}
	if AddressAllowed("0xabc", []string{"0xdef"}) {
		t.Fatal("address outside allowlist must be rejected")
	}
	if !AddressAllowed("0xabc", []string{"0xdef", "0xabc"}) {
		t.Fatal("allowlisted address must be permitted")
	}
}
