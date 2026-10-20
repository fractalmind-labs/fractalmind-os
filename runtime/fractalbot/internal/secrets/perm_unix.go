//go:build !windows

package secrets

import (
	"fmt"
	"os"
	"syscall"
)

// checkOwnerOnly refuses a secret file or directory that another user owns
// or that other users can read.
func checkOwnerOnly(path string, dir bool) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if stat, ok := info.Sys().(*syscall.Stat_t); ok && int(stat.Uid) != os.Getuid() {
		return fmt.Errorf("%s is not owned by the current user", path)
	}
	want := os.FileMode(0o600)
	if dir {
		want = 0o700
	}
	if info.Mode().Perm()&^want != 0 {
		return fmt.Errorf("%s must be mode %#o or stricter", path, want)
	}
	return nil
}
