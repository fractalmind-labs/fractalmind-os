//go:build !darwin || !cgo

package hostidentity

import (
	"errors"
	"fmt"
	"runtime"

	"github.com/99designs/keyring"
)

type nativeStore struct{ ring keyring.Keyring }

func openNativeStore(collection string) (Store, error) {
	var backend keyring.BackendType
	switch runtime.GOOS {
	case "windows":
		backend = keyring.WinCredBackend
	case "linux":
		backend = keyring.SecretServiceBackend
	default:
		return nil, fmt.Errorf("native Host credential store unavailable on %s", runtime.GOOS)
	}
	ring, err := keyring.Open(keyring.Config{ServiceName: nativeService, AllowedBackends: []keyring.BackendType{backend}, WinCredPrefix: nativeService + "/", LibSecretCollectionName: collection})
	if err != nil {
		return nil, fmt.Errorf("native Host credential store unavailable: %w", err)
	}
	return nativeStore{ring}, nil
}
func (s nativeStore) Get(profile string) ([]byte, error) {
	name, err := account(profile)
	if err != nil {
		return nil, err
	}
	item, err := s.ring.Get(name)
	if errors.Is(err, keyring.ErrKeyNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return item.Data, nil
}
func (s nativeStore) Create(profile string, data []byte) error {
	// Initialize holds the same per-profile OS lock across the check and create.
	existing, err := s.Get(profile)
	clear(existing)
	if err == nil {
		return ErrAlreadyExists
	}
	if !errors.Is(err, ErrNotFound) {
		return err
	}
	name, err := account(profile)
	if err != nil {
		return err
	}
	return s.ring.Set(keyring.Item{Key: name, Data: data, Label: "FractalMind Host " + profile, KeychainNotSynchronizable: true})
}
