// Package hostidentity stores only this Host's local private keys. Organization
// membership, capabilities and all persistent product state remain on Sui.
package hostidentity

import (
	"context"
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"github.com/gofrs/flock"
	"golang.org/x/crypto/blake2b"
)

var ErrNotFound = errors.New("Host identity is not initialized")
var ErrAlreadyExists = errors.New("Host identity already exists")
var profilePattern = regexp.MustCompile("^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")

const nativeService = "org.fractalmind.envd.host"

// Store implementations must never replace an existing identity in Create.
type Store interface {
	Get(profile string) ([]byte, error)
	Create(profile string, data []byte) error
}
type Keys struct {
	mu   sync.Mutex
	data []byte
}
type Public struct {
	Format              string `json:"format"`
	Profile             string `json:"profile"`
	Address             string `json:"host_address"`
	SigningPublicKey    string `json:"signing_public_key"`
	EncryptionPublicKey string `json:"encryption_public_key"`
}

func account(profile string) (string, error) {
	if !profilePattern.MatchString(profile) {
		return "", fmt.Errorf("Host key profile must contain 1–64 ASCII letters, digits, hyphens or underscores")
	}
	return "host-v1-" + profile, nil
}
func DefaultLockDir() (string, error) {
	root, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "fractalmind", "host-identity-locks"), nil
}
func decode(data []byte) (*Keys, error) {
	if len(data) != 68 || string(data[:4]) != "FMH1" {
		return nil, fmt.Errorf("invalid stored Host identity format")
	}
	return &Keys{data: append([]byte(nil), data...)}, nil
}

// Load never creates new keys, including when the OS store is locked/offline.
func Load(store Store, profile string) (*Keys, error) {
	if store == nil {
		return nil, fmt.Errorf("system credential store is required")
	}
	if _, err := account(profile); err != nil {
		return nil, err
	}
	data, err := store.Get(profile)
	if err != nil {
		return nil, err
	}
	defer clear(data)
	return decode(data)
}

// Initialize is explicit and idempotent. The lock contains no secret or
// business state; it serializes initial key creation across envd processes.
func Initialize(ctx context.Context, store Store, profile, lockDir string) (*Keys, error) {
	if store == nil || ctx == nil {
		return nil, fmt.Errorf("context and system credential store are required")
	}
	name, err := account(profile)
	if err != nil {
		return nil, err
	}
	if lockDir == "" {
		lockDir, err = DefaultLockDir()
		if err != nil {
			return nil, err
		}
	}
	if err = os.MkdirAll(lockDir, 0700); err != nil {
		return nil, err
	}
	lock := flock.New(filepath.Join(lockDir, name+".lock"))
	locked, err := lock.TryLockContext(ctx, 25*time.Millisecond)
	if err != nil {
		return nil, err
	}
	if !locked {
		return nil, fmt.Errorf("Host identity initialization lock unavailable")
	}
	defer lock.Close()
	keys, err := Load(store, profile)
	if err == nil {
		return keys, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	data := make([]byte, 68)
	copy(data, "FMH1")
	defer clear(data)
	if _, err = rand.Read(data[4:]); err != nil {
		return nil, err
	}
	if err = store.Create(profile, data); err != nil {
		if errors.Is(err, ErrAlreadyExists) {
			return Load(store, profile)
		}
		return nil, err
	}
	stored, err := Load(store, profile)
	if err != nil {
		return nil, err
	}
	// Never advertise an identity different from the one persisted by the OS.
	for i := range data {
		if data[i] != stored.data[i] {
			stored.Close()
			return nil, fmt.Errorf("Host identity changed during initialization")
		}
	}
	return stored, nil
}
func (k *Keys) Close() {
	k.mu.Lock()
	defer k.mu.Unlock()
	clear(k.data)
	k.data = nil
}
func (k *Keys) SigningPrivate() (ed25519.PrivateKey, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if len(k.data) != 68 {
		return nil, fmt.Errorf("Host identity is closed")
	}
	return ed25519.NewKeyFromSeed(k.data[4:36]), nil
}
func (k *Keys) EncryptionSecret(ctx context.Context) ([]byte, error) {
	if ctx == nil {
		return nil, fmt.Errorf("context is required")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	if len(k.data) != 68 {
		return nil, fmt.Errorf("Host identity is closed")
	}
	return append([]byte(nil), k.data[36:68]...), nil
}
func (k *Keys) Public(profile string) (Public, error) {
	if _, err := account(profile); err != nil {
		return Public{}, err
	}
	private, err := k.SigningPrivate()
	if err != nil {
		return Public{}, err
	}
	defer clear(private)
	secret, err := k.EncryptionSecret(context.Background())
	if err != nil {
		return Public{}, err
	}
	defer clear(secret)
	encryption, err := ecdh.X25519().NewPrivateKey(secret)
	if err != nil {
		return Public{}, err
	}
	public := private.Public().(ed25519.PublicKey)
	address := blake2b.Sum256(append([]byte{0}, public...))
	return Public{Format: "1", Profile: profile, Address: "0x" + hex.EncodeToString(address[:]), SigningPublicKey: hex.EncodeToString(public), EncryptionPublicKey: hex.EncodeToString(encryption.PublicKey().Bytes())}, nil
}
