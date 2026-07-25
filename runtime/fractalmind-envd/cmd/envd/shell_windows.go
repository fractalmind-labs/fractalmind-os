//go:build windows

package main

import (
	"context"
	"fmt"
	"os/exec"
	"time"
)

func runShellCommand(command string, timeout time.Duration) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	out, err := exec.CommandContext(ctx, "cmd", "/C", command).CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return out, fmt.Errorf("shell command timed out after %s", timeout)
	}
	return out, err
}
