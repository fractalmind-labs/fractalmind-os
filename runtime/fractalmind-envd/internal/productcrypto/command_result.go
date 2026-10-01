package productcrypto

import (
	"crypto/ecdh"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"strconv"
	"strings"

	"golang.org/x/crypto/hkdf"
)

const resultDomain = "fractalmind.command-result-key.v1"

func canonicalAddress(value string) bool {
	if len(value) != 66 || !strings.HasPrefix(value, "0x") || value != strings.ToLower(value) {
		return false
	}
	_, err := hex.DecodeString(value[2:])
	return err == nil
}
func validFingerprint(value string) bool {
	if len(value) != 64 || value != strings.ToLower(value) {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
func CommandResultKey(organizationKey []byte, organizationID, fingerprint string, version uint64) ([]byte, error) {
	if len(organizationKey) != 32 || !canonicalAddress(organizationID) || !validFingerprint(fingerprint) || version == 0 {
		return nil, fmt.Errorf("invalid command result key context")
	}
	key := make([]byte, 32)
	_, err := io.ReadFull(hkdf.New(sha256.New, organizationKey, []byte(resultDomain), []byte(resultDomain+":"+organizationID+":"+fingerprint+":"+strconv.FormatUint(version, 10))), key)
	return key, err
}
func CommandResultWrapContext(organizationID, capabilityID, membershipID, fingerprint string, version uint64) (string, error) {
	if !canonicalAddress(organizationID) || !canonicalAddress(capabilityID) || !canonicalAddress(membershipID) || !validFingerprint(fingerprint) || version == 0 {
		return "", fmt.Errorf("invalid command result wrapping context")
	}
	return "fractalmind.command-result-wrap.v1:" + organizationID + ":" + capabilityID + ":" + membershipID + ":" + fingerprint + ":" + strconv.FormatUint(version, 10), nil
}

// UnwrapResultKey accepts only a 32-byte per-command result key. A caller's
// Host secret stays local; low-order X25519 public keys are rejected by ECDH.
func UnwrapResultKey(envelope, hostSecret []byte, context string) ([]byte, error) {
	if len(envelope) != 132 || string(envelope[:4]) != "FMW1" || len(hostSecret) != 32 || context == "" || len(context) > 1024 {
		return nil, fmt.Errorf("invalid command result key envelope")
	}
	private, err := ecdh.X25519().NewPrivateKey(hostSecret)
	if err != nil {
		return nil, err
	}
	public, err := ecdh.X25519().NewPublicKey(envelope[4:36])
	if err != nil {
		return nil, err
	}
	shared, err := private.ECDH(public)
	if err != nil {
		return nil, err
	}
	defer clear(shared)
	key := make([]byte, 32)
	defer clear(key)
	if _, err := io.ReadFull(hkdf.New(sha256.New, shared, envelope[36:68], []byte("fractalmind.key-wrap.v1:"+context)), key); err != nil {
		return nil, err
	}
	plaintext, err := Decrypt(envelope[68:], key, context)
	if err != nil {
		return nil, err
	}
	if len(plaintext) != 32 {
		clear(plaintext)
		return nil, fmt.Errorf("wrapped command key must be 32 bytes")
	}
	return plaintext, nil
}

func EncryptCommandResult(plaintext, derivedKey []byte, context string) ([]byte, error) {
	envelope, err := Encrypt(plaintext, derivedKey, context)
	if err != nil {
		return nil, err
	}
	envelope[3] = '2'
	return envelope, nil
}
func DecryptCommandResult(envelope, derivedKey []byte, context string) ([]byte, error) {
	if len(envelope) < 32 || string(envelope[:4]) != "FME2" {
		return nil, fmt.Errorf("invalid command result envelope")
	}
	legacy := append([]byte(nil), envelope...)
	legacy[3] = '1'
	return Decrypt(legacy, derivedKey, context)
}
