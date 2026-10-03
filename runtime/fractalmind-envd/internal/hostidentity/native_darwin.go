//go:build darwin && cgo

package hostidentity

import (
	"fmt"
	keychain "github.com/99designs/go-keychain"
)

type nativeStore struct{}

func openNativeStore(string) (Store, error) { return nativeStore{}, nil }
func hostQuery(profile string) (keychain.Item, error) {
	name, err := account(profile)
	if err != nil {
		return keychain.Item{}, err
	}
	item := keychain.NewItem()
	item.SetSecClass(keychain.SecClassGenericPassword)
	item.SetService(nativeService)
	item.SetAccount(name)
	return item, nil
}
func (nativeStore) Get(profile string) ([]byte, error) {
	query, err := hostQuery(profile)
	if err != nil {
		return nil, err
	}
	query.SetMatchLimit(keychain.MatchLimitOne)
	query.SetReturnData(true)
	results, err := keychain.QueryItem(query)
	// Check OS errors before checking results. A locked/unavailable keychain
	// must never be treated as missing keys and regenerated.
	if err == keychain.ErrorItemNotFound {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("macOS Host Keychain read failed: %w", err)
	}
	// QueryItem normalizes only errSecItemNotFound to (nil, nil).
	if len(results) == 0 {
		return nil, ErrNotFound
	}
	if len(results) != 1 {
		return nil, fmt.Errorf("macOS Host Keychain returned no exact item")
	}
	return results[0].Data, nil
}
func (nativeStore) Create(profile string, data []byte) error {
	item, err := hostQuery(profile)
	if err != nil {
		return err
	}
	item.SetLabel("FractalMind Host " + profile)
	item.SetDescription("Local Host signing and encryption keys")
	item.SetAccessible(keychain.AccessibleWhenUnlockedThisDeviceOnly)
	item.SetSynchronizable(keychain.SynchronizableNo)
	item.SetAccess(&keychain.Access{Label: "FractalMind Host", TrustedApplications: nil})
	item.SetData(data)
	err = keychain.AddItem(item)
	if err == keychain.ErrorDuplicateItem {
		return ErrAlreadyExists
	}
	if err != nil {
		return fmt.Errorf("macOS Host Keychain create failed: %w", err)
	}
	return nil
}
