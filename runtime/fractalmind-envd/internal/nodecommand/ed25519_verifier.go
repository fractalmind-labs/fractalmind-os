package nodecommand

import (
	"context"
	"crypto/ed25519"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"strings"

	"golang.org/x/crypto/blake2b"
)

// Ed25519Verifier verifies signed-command envelopes against SUI-style Ed25519
// identities. Signatures are encoded as ed25519:<public-key-hex>:<signature-hex>.
type Ed25519Verifier struct{}

func (Ed25519Verifier) Verify(_ context.Context, signer string, payload []byte, signature string) error {
	parts := strings.Split(signature, ":")
	if len(parts) != 3 || parts[0] != "ed25519" {
		return fmt.Errorf("signature must use ed25519:<public-key-hex>:<signature-hex>")
	}
	pubBytes, err := hex.DecodeString(parts[1])
	if err != nil {
		return fmt.Errorf("decode public key: %w", err)
	}
	if len(pubBytes) != ed25519.PublicKeySize {
		return fmt.Errorf("invalid public key size: got %d, want %d", len(pubBytes), ed25519.PublicKeySize)
	}
	sigBytes, err := hex.DecodeString(parts[2])
	if err != nil {
		return fmt.Errorf("decode signature: %w", err)
	}
	if len(sigBytes) != ed25519.SignatureSize {
		return fmt.Errorf("invalid signature size: got %d, want %d", len(sigBytes), ed25519.SignatureSize)
	}
	pub := ed25519.PublicKey(pubBytes)
	if !ed25519.Verify(pub, payload, sigBytes) {
		return fmt.Errorf("signature verification failed")
	}
	if subtle.ConstantTimeCompare([]byte(deriveSUIAddress(pub)), []byte(signer)) != 1 {
		return fmt.Errorf("signer does not match public key")
	}
	return nil
}

func deriveSUIAddress(pub ed25519.PublicKey) string {
	payload := make([]byte, 1+len(pub))
	payload[0] = 0x00
	copy(payload[1:], pub)
	hash := blake2b.Sum256(payload)
	return "0x" + hex.EncodeToString(hash[:])
}
