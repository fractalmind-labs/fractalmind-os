//go:build !darwin || !cgo

package main

import "fmt"

func removeNativeRestartIdentity(string) error {
	return fmt.Errorf("isolated macOS native Host restart requires CGO")
}
