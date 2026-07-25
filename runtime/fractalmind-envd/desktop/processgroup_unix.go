//go:build !windows

package desktop

import (
	"os"
	"syscall"
	"time"
)

// ExitProcessGroup terminates envd-desktop and capture/awake child processes.
func ExitProcessGroup() {
	if err := syscall.Kill(-os.Getpid(), syscall.SIGTERM); err == nil {
		time.Sleep(time.Second)
	}
	os.Exit(0)
}
