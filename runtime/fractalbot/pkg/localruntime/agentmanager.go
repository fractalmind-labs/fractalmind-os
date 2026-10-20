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

// DefaultAgentManagerScript is relative to the agent's workspace.
const DefaultAgentManagerScript = ".claude/skills/agent-manager/scripts/main.py"

const (
	defaultAssignTimeout      = 90 * time.Second
	defaultLifecycleTimeout   = 20 * time.Second
	defaultHeartbeatRunTime   = 8 * time.Minute
	heartbeatRunCommandMargin = 30 * time.Second
)

var heartbeatIDPattern = regexp.MustCompile(`(?m)^\s*HB_ID:\s*([A-Za-z0-9_-]+)\s*$`)

// AgentManager assigns to tmux agents through the workspace's agent-manager.
type AgentManager struct {
	// Script returns the agent-manager entrypoint for a target; nil uses
	// DefaultAgentManagerScript inside the target's workspace.
	Script func(Target) string
	// Python runs the script; default python3.
	Python        string
	AssignTimeout time.Duration
}

func (AgentManager) Name() string { return "agentManager" }

func (AgentManager) Capabilities() Capabilities {
	return Capabilities{WakesIdle: true, Start: true, HardStop: true, CompletionAware: true, PresenceKnown: true}
}

func (a AgentManager) run(ctx context.Context, target Target, stdin string, args ...string) (string, error) {
	script := DefaultAgentManagerScript
	if a.Script != nil {
		script = a.Script(target)
	}
	python := a.Python
	if python == "" {
		python = "python3"
	}
	cmd := exec.CommandContext(ctx, python, append([]string{script}, args...)...)
	cmd.Dir = target.Workspace
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	out := strings.TrimSpace(stdout.String())
	if err != nil {
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			return out, fmt.Errorf("agent-manager %s failed: %s", args[0], msg)
		}
		if out != "" {
			return out, fmt.Errorf("agent-manager %s failed: %s", args[0], out)
		}
		return "", fmt.Errorf("agent-manager %s failed: %w", args[0], err)
	}
	return out, nil
}

// Deliver assigns the prompt, or with HeartbeatRun runs agent-manager's
// heartbeat lifecycle and waits for its terminal outcome.
func (a AgentManager) Deliver(ctx context.Context, target Target, req Request) Result {
	session := strings.TrimSpace(target.Session)
	if session == "" {
		return failed(req, errors.New("agentManager needs the agent-manager agent as the session"))
	}
	switch req.Mode {
	case HeartbeatRun:
		maxRun := req.Timeout
		if maxRun <= 0 {
			maxRun = defaultHeartbeatRunTime
		}
		runCtx, cancel := context.WithTimeout(ctx, maxRun+heartbeatRunCommandMargin)
		defer cancel()
		out, err := a.run(runCtx, target, "", "heartbeat", "run", session, "--timeout", maxRun.String())
		res := Result{Status: Completed, EnvelopeID: req.Envelope.ID}
		if m := heartbeatIDPattern.FindStringSubmatch(out); len(m) == 2 {
			res.Location = "heartbeat " + m[1]
		}
		if err != nil {
			res.Status, res.Err = Failed, err
		}
		return res
	case Assign:
		timeout := req.Timeout
		if timeout <= 0 {
			timeout = a.AssignTimeout
		}
		if timeout <= 0 {
			timeout = defaultAssignTimeout
		}
		runCtx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		if _, err := a.run(runCtx, target, req.Prompt, "assign", session); err != nil {
			return failed(req, err)
		}
		return Result{Status: Delivered, EnvelopeID: req.Envelope.ID, Location: "agent-manager " + session}
	default:
		return failed(req, fmt.Errorf("unsupported mode %q", req.Mode))
	}
}

// Presence asks agent-manager whether the agent's tmux session runs.
func (a AgentManager) Presence(ctx context.Context, target Target) Presence {
	ctx, cancel := context.WithTimeout(ctx, defaultLifecycleTimeout)
	defer cancel()
	out, err := a.run(ctx, target, "", "status", target.Session)
	if err != nil {
		return Unknown
	}
	if statusRunning(out) {
		return Online
	}
	return Offline
}

// Start starts a stopped agent and confirms it runs.
func (a AgentManager) Start(ctx context.Context, target Target) error {
	startCtx, cancel := context.WithTimeout(ctx, defaultLifecycleTimeout)
	defer cancel()
	if _, err := a.run(startCtx, target, "", "start", target.Session); err != nil {
		return err
	}
	if a.Presence(ctx, target) != Online {
		return fmt.Errorf("agent-manager agent %q did not report Running: yes after start", target.Session)
	}
	return nil
}

func statusRunning(out string) bool {
	for _, line := range strings.Split(out, "\n") {
		l := strings.ToLower(strings.TrimSpace(line))
		if strings.HasPrefix(l, "running:") && strings.Contains(l, "yes") {
			return true
		}
	}
	return false
}

// Monitor returns the agent's recent output.
func (a AgentManager) Monitor(ctx context.Context, target Target, lines int) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultLifecycleTimeout)
	defer cancel()
	return a.run(ctx, target, "", "monitor", target.Session, "--lines", fmt.Sprint(lines))
}

// Stop stops the agent's tmux session.
func (a AgentManager) Stop(ctx context.Context, target Target) error {
	ctx, cancel := context.WithTimeout(ctx, defaultLifecycleTimeout)
	defer cancel()
	_, err := a.run(ctx, target, "", "stop", target.Session)
	return err
}
