//go:build !windows

package desktop

import (
	"fmt"
	"os"
	"syscall"
	"time"
)

// EnsureOwnProcessGroup isolates the desktop and any capture/awake children.
func EnsureOwnProcessGroup() error {
	if err := syscall.Setpgid(0, 0); err != nil && err != syscall.EPERM {
		return fmt.Errorf("setpgid: %w", err)
	}
	return nil
}

// ExitProcessGroup terminates envd-desktop and capture/awake child processes.
func ExitProcessGroup() {
	if syscall.Getpgrp() == os.Getpid() {
		if err := syscall.Kill(-os.Getpid(), syscall.SIGTERM); err == nil {
			time.Sleep(time.Second)
		}
	}
	os.Exit(0)
}
