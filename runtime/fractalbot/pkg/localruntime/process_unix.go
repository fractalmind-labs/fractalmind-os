//go:build !windows

package localruntime

import (
	"errors"
	"os"
	"syscall"
)

func processIsAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func checkSocketOwner(info os.FileInfo) error {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return errors.New("cannot inspect the messaging socket's owner")
	}
	if int(stat.Uid) != os.Getuid() {
		return errors.New("the messaging socket is not owned by the current user")
	}
	return nil
}
