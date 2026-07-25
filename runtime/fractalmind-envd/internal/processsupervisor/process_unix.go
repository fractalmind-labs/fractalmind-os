//go:build !windows

package processsupervisor

import (
	"os"
	"os/exec"
	"syscall"
	"time"
)

func configureProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func stopAndWait(process *os.Process, waitCh <-chan error, timeout time.Duration) {
	if process == nil {
		return
	}
	_ = syscall.Kill(-process.Pid, syscall.SIGTERM)
	select {
	case <-waitCh:
		return
	case <-time.After(timeout):
	}
	_ = syscall.Kill(-process.Pid, syscall.SIGKILL)
	<-waitCh
}
