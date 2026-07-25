//go:build !windows

package main

import (
	"bytes"
	"fmt"
	"os/exec"
	"syscall"
	"time"
)

func runShellCommand(command string, timeout time.Duration) ([]byte, error) {
	cmd := exec.Command("bash", "-c", command)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	if err := cmd.Start(); err != nil {
		return output.Bytes(), err
	}

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case err := <-done:
		return output.Bytes(), err
	case <-timer.C:
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		<-done
		return output.Bytes(), fmt.Errorf("shell command timed out after %s", timeout)
	}
}
