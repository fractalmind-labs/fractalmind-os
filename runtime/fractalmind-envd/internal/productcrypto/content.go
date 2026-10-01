// Package productcrypto implements the SDK's FME1 authenticated content
// envelope. It neither stores keys nor grants access to encrypted chain data.
package productcrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"fmt"
)

const MaxPlaintextBytes = 65504 // 64 KiB Move body less magic, nonce and GCM tag.

func contentCipher(key []byte, context string) (cipher.AEAD, error) {
	if len(key) != 32 || context == "" || len(context) > 1024 {
		return nil, fmt.Errorf("32-byte key and bounded content context are required")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func Encrypt(plaintext, key []byte, context string) ([]byte, error) {
	if len(plaintext) > MaxPlaintextBytes {
		return nil, fmt.Errorf("content exceeds chain record limit")
	}
	gcm, err := contentCipher(key, context)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return nil, err
	}
	header := append([]byte("FME1"), nonce...)
	return gcm.Seal(header, nonce, plaintext, []byte(context)), nil
}

func Decrypt(envelope, key []byte, context string) ([]byte, error) {
	if len(envelope) < 32 || len(envelope) > MaxPlaintextBytes+32 || string(envelope[:4]) != "FME1" {
		return nil, fmt.Errorf("invalid encrypted envelope")
	}
	gcm, err := contentCipher(key, context)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, envelope[4:16], envelope[16:], []byte(context))
}
