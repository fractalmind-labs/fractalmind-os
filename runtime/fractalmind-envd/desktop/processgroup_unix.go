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
	exitProcessGroup(
		syscall.Getpgrp,
		os.Getpid,
		shieldProcessSignal,
		syscall.Kill,
		time.Sleep,
		os.Exit,
	)
}

func exitProcessGroup(
	getpgrp func() int,
	getpid func() int,
	shield func(os.Signal) func(),
	kill func(int, syscall.Signal) error,
	sleep func(time.Duration),
	exit func(int),
) {
	pid := getpid()
	if getpgrp() == pid {
		// Keep the group leader alive long enough to escalate stubborn capture
		// children. The shield is scoped to this teardown path so a process that
		// survives a failed group kill does not keep SIGTERM ignored.
		restore := shield(syscall.SIGTERM)
		terminateProcessGroup(pid, kill, sleep)
		restore()
	}
	exit(0)
}

var shieldProcessSignal = func(sig os.Signal) func() {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, sig)
	return func() {
		signal.Stop(ch)
		close(ch)
	}
}

func terminateProcessGroup(pid int, kill func(int, syscall.Signal) error, sleep func(time.Duration)) {
	_ = kill(-pid, syscall.SIGTERM)
	sleep(processGroupStopGrace)
	_ = kill(-pid, syscall.SIGKILL)
}
