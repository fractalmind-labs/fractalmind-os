//go:build !windows

package desktop

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"
)

const processGroupStopGrace = time.Second

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
		// Keep the group leader alive long enough to escalate stubborn capture
		// children. Otherwise the first group-wide SIGTERM can terminate the
		// desktop before it has a chance to send SIGKILL.
		signal.Ignore(syscall.SIGTERM)
		terminateProcessGroup(os.Getpid(), syscall.Kill, time.Sleep)
	}
	os.Exit(0)
}

func terminateProcessGroup(pid int, kill func(int, syscall.Signal) error, sleep func(time.Duration)) {
	_ = kill(-pid, syscall.SIGTERM)
	sleep(processGroupStopGrace)
	_ = kill(-pid, syscall.SIGKILL)
}
