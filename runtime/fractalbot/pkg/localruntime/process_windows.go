//go:build windows

package localruntime

import (
	"errors"
	"os"
)

// processIsAlive is false on Windows until the relay's session channel there
// is settled; a Windows relay lock is therefore always treated as stale.
func processIsAlive(int) bool { return false }

func checkSocketOwner(os.FileInfo) error {
	return errors.New("the Claude Desktop relay is not supported on Windows yet")
}
