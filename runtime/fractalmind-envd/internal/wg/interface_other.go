//go:build !darwin && !linux

package wg

import (
	"fmt"
	"log"
	"runtime"
)

// These platforms can run the command/control plane without WireGuard.
// Never report that an interface or forwarding was configured successfully.
func ensureInterface(string) error {
	return fmt.Errorf("envd WireGuard interface setup is not supported on %s", runtime.GOOS)
}
func assignInterfaceAddr(string, string) error {
	return fmt.Errorf("envd WireGuard address setup is not supported on %s", runtime.GOOS)
}
func EnableIPForward(string) {
	log.Printf("[wg] IP forwarding is not supported on %s", runtime.GOOS)
}
