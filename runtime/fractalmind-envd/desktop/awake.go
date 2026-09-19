package desktop

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"time"
)

type runContextFunc func(context.Context, []string) error

var runContextArgv runContextFunc = func(ctx context.Context, argv []string) error {
	if len(argv) == 0 {
		return nil
	}
	return exec.CommandContext(ctx, argv[0], argv[1:]...).Run()
}

// AwakeGuard holds OS-level assertions that keep an unattended desktop
// capturable. It is currently macOS-specific; other platforms return a no-op
// guard so callers can enable it unconditionally.
type AwakeGuard struct {
	cancel context.CancelFunc
	done   chan struct{}
}

func NewAwakeGuard(ctx context.Context, goos string) (*AwakeGuard, error) {
	if goos != "darwin" {
		return &AwakeGuard{}, nil
	}
	argv := macOSAwakeHoldArgs(os.Getpid())
	guardCtx, cancel := context.WithCancel(ctx)
	cmd := exec.CommandContext(guardCtx, argv[0], argv[1:]...)
	if err := cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("start caffeinate: %w", err)
	}
	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(done)
	}()
	return &AwakeGuard{cancel: cancel, done: done}, nil
}

func (g *AwakeGuard) Stop() {
	if g == nil || g.cancel == nil {
		return
	}
	g.cancel()
	select {
	case <-g.done:
	case <-time.After(2 * time.Second):
	}
}

// NudgeUserActive asks macOS to mark the user/display active for a short time
// before a capture process starts. It cannot unlock a locked login session, but
// it helps wake a logged-in display that has idled.
func NudgeUserActive(ctx context.Context, goos string) error {
	if goos != "darwin" {
		return nil
	}
	nudgeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return runContextArgv(nudgeCtx, macOSUserActiveArgs())
}

func macOSAwakeHoldArgs(pid int) []string {
	// -d prevents display sleep; -i prevents idle system sleep; -m prevents disk
	// sleep; -s prevents system sleep while on AC power; -w ties the assertion
	// to envd-desktop so a hard process exit cannot leave an orphan assertion.
	return []string{"caffeinate", "-dims", "-w", strconv.Itoa(pid)}
}

func macOSUserActiveArgs() []string {
	return []string{"caffeinate", "-u", "-t", "2"}
}
