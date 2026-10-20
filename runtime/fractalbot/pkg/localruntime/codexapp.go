package localruntime

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

var codexThreadPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// CodexApp queues into a pinned Codex App thread with `codex queue`. Codex's
// own durable queue holds the message until the thread is free, so an active
// turn finishes first. No App instance or debugging endpoint is needed.
type CodexApp struct {
	// Codex is the codex executable; default `codex` on PATH.
	Codex string
	// Timeout bounds one queue call; default 30 seconds.
	Timeout time.Duration
}

func (CodexApp) Name() string { return "codexApp" }

func (CodexApp) Capabilities() Capabilities {
	return Capabilities{DurableQueue: true, WakesIdle: true}
}

func (c CodexApp) Deliver(ctx context.Context, target Target, req Request) Result {
	if req.Mode != Assign {
		return failed(req, errors.New("codexApp supports assign only"))
	}
	thread := strings.TrimSpace(target.Session)
	if !codexThreadPattern.MatchString(thread) {
		return failed(req, errors.New("codexApp needs the Codex thread ID as the agent's session"))
	}
	if strings.TrimSpace(req.Prompt) == "" {
		return failed(req, errors.New("prompt is empty"))
	}
	timeout := req.Timeout
	if timeout <= 0 {
		timeout = c.Timeout
	}
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	codex := c.Codex
	if codex == "" {
		codex = "codex"
	}
	cmd := exec.CommandContext(ctx, codex, "queue", "--thread", thread, "--message", req.Prompt)
	cmd.Dir = target.Workspace
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	// Error output is dropped: it may quote the message.
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return failed(req, fmt.Errorf("codex queue timed out after %s", timeout))
		}
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return failed(req, fmt.Errorf("codex queue rejected the message (exit code %d)", exit.ExitCode()))
		}
		return failed(req, fmt.Errorf("codex queue could not run: %w", err))
	}
	// Accept only an explicit confirmation for this thread; anything else may
	// mean the message went nowhere.
	if !strings.Contains(stdout.String(), "for thread "+thread) {
		return failed(req, errors.New("codex queue did not confirm the target thread"))
	}
	return Result{Status: Queued, EnvelopeID: req.Envelope.ID, Location: "codex thread " + thread}
}

// Presence is Unknown: the queue accepts messages whether or not the App runs.
func (CodexApp) Presence(context.Context, Target) Presence { return Unknown }
