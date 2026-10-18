//go:build !windows

package agent

import (
	"errors"
	"os"
	"syscall"
)

func validateClaudeDesktopMessagingSocketPlatform(info os.FileInfo) error {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return errors.New("inspect Claude Desktop messaging socket ownership")
	}
	if int(stat.Uid) != os.Getuid() {
		return errors.New("Claude Desktop messaging socket is not owned by the current user")
	}
	return nil
}

func processIsAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}
