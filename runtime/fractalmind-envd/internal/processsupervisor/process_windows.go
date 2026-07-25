//go:build windows

package processsupervisor

import (
	"os"
	"os/exec"
	"time"
)

func configureProcess(*exec.Cmd) {}

func stopAndWait(process *os.Process, waitCh <-chan error, timeout time.Duration) {
	if process == nil {
		return
	}
	_ = process.Kill()
	select {
	case <-waitCh:
	case <-time.After(timeout):
	}
}
