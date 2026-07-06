// Package wsauth implements the mutual Ed25519 challenge-response used to
// authenticate the coordinator<->worker control channel.
//
// Historically the worker dialed the coordinator gateway with no authentication
// and executed any command it received (including a raw shell), while the
// coordinator accepted any WebSocket that connected to /ws. This package closes
// that gap by binding both ends of the control channel to their on-chain SUI
// identity: each side signs a fresh random nonce issued by its peer with the
// same Ed25519 key that derives its SUI address, and each side verifies the
// signature and that the claimed address is actually derived from the presented
// public key. It reuses the exact address-derivation scheme already used on the
// relay plane (BLAKE2b-256(0x00 || pubkey)).
package wsauth

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"

	"golang.org/x/crypto/blake2b"
)

// NonceSize is the length in bytes of a challenge nonce.
const NonceSize = 32

// Signer produces Ed25519 signatures for a SUI identity. *sui.Keypair
// implements it.
type Signer interface {
	Sign(data []byte) []byte
	PublicKeyBytes() []byte
	Address() string
}

// Proof is a signature over a peer-issued nonce plus the identity that produced
// it. Address must be derivable from PublicKey.
type Proof struct {
	Address   string `json:"address"`    // 0x + hex(BLAKE2b-256(0x00||pubkey))
	PublicKey string `json:"public_key"` // hex-encoded Ed25519 public key
	Signature string `json:"signature"`  // hex-encoded Ed25519 signature over the nonce
}

// NewNonce returns NonceSize cryptographically-random bytes and their hex form.
func NewNonce() ([]byte, string, error) {
	b := make([]byte, NonceSize)
	if _, err := rand.Read(b); err != nil {
		return nil, "", fmt.Errorf("generate nonce: %w", err)
	}
	return b, hex.EncodeToString(b), nil
}

// DecodeNonce parses a hex nonce and validates its length.
func DecodeNonce(nonceHex string) ([]byte, error) {
	b, err := hex.DecodeString(nonceHex)
	if err != nil {
		return nil, fmt.Errorf("decode nonce: %w", err)
	}
	if len(b) != NonceSize {
		return nil, fmt.Errorf("invalid nonce size: got %d, want %d", len(b), NonceSize)
	}
	return b, nil
}

// DeriveAddress returns the SUI address for an Ed25519 public key, matching
// sui.Keypair.Address and the relay-plane derivation.
func DeriveAddress(pub ed25519.PublicKey) string {
	payload := make([]byte, 1+len(pub))
	payload[0] = 0x00 // Ed25519 scheme flag
	copy(payload[1:], pub)
	hash := blake2b.Sum256(payload)
	return "0x" + hex.EncodeToString(hash[:])
}

// Prove signs nonce with signer and returns the proof.
func Prove(signer Signer, nonce []byte) Proof {
	return Proof{
		Address:   signer.Address(),
		PublicKey: hex.EncodeToString(signer.PublicKeyBytes()),
		Signature: hex.EncodeToString(signer.Sign(nonce)),
	}
}

// VerifyProof checks that the signature is valid over nonce for the presented
// public key and that the claimed address is genuinely derived from that key.
// It returns the verified SUI address on success.
func VerifyProof(p Proof, nonce []byte) (string, error) {
	pubBytes, err := hex.DecodeString(p.PublicKey)
	if err != nil {
		return "", fmt.Errorf("decode public key: %w", err)
	}
	if len(pubBytes) != ed25519.PublicKeySize {
		return "", fmt.Errorf("invalid public key size: %d", len(pubBytes))
	}
	sig, err := hex.DecodeString(p.Signature)
	if err != nil {
		return "", fmt.Errorf("decode signature: %w", err)
	}
	if len(sig) != ed25519.SignatureSize {
		return "", fmt.Errorf("invalid signature size: %d", len(sig))
	}
	if len(nonce) != NonceSize {
		return "", fmt.Errorf("invalid nonce size: %d", len(nonce))
	}
	pub := ed25519.PublicKey(pubBytes)
	if !ed25519.Verify(pub, nonce, sig) {
		return "", fmt.Errorf("signature verification failed")
	}
	derived := DeriveAddress(pub)
	// Constant-time compare to avoid leaking address-match timing.
	if subtle.ConstantTimeCompare([]byte(derived), []byte(p.Address)) != 1 {
		return "", fmt.Errorf("address %q does not match public key (derived %q)", p.Address, derived)
	}
	return derived, nil
}

// AddressAllowed reports whether addr is in allowed. An empty allowlist permits
// any verified identity (authentication still required; authorization open).
func AddressAllowed(addr string, allowed []string) bool {
	if len(allowed) == 0 {
		return true
	}
	for _, a := range allowed {
		if subtle.ConstantTimeCompare([]byte(a), []byte(addr)) == 1 {
			return true
		}
	}
	return false
}
