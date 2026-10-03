//go:build darwin && cgo

package main

import keychain "github.com/99designs/go-keychain"

// Called only after the exact generated test profile has been validated.
func removeNativeRestartIdentity(profile string) error {
	item := keychain.NewItem()
	item.SetSecClass(keychain.SecClassGenericPassword)
	item.SetService("org.fractalmind.envd.host")
	item.SetAccount("host-v1-" + profile)
	err := keychain.DeleteItem(item)
	if err == keychain.ErrorItemNotFound {
		return nil
	}
	return err
}
