package server

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
)

type backendSnapshot struct {
	Status    string
	PID       int
	StartedAt int64
	StoppedAt int64
	ExitCode  int
}

type backendProcess struct {
	mu        sync.Mutex
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	stdout    *bufio.Reader
	done      chan struct{}
	startedAt int64
	stoppedAt int64
	exitCode  int
	waitErr   error
}

func startBackendProcess() (*backendProcess, error) {
	cmd := exec.Command("sh", "-c", `while IFS= read -r line; do printf '%s\n' "echo:${line}"; done`)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("create backend stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("create backend stdout: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start backend process: %w", err)
	}

	p := &backendProcess{
		cmd:       cmd,
		stdin:     stdin,
		stdout:    bufio.NewReader(stdout),
		done:      make(chan struct{}),
		startedAt: time.Now().UnixMilli(),
		exitCode:  -1,
	}
	go func() {
		err := cmd.Wait()
		p.mu.Lock()
		defer p.mu.Unlock()
		p.waitErr = err
		p.stoppedAt = time.Now().UnixMilli()
		if err == nil {
			p.exitCode = 0
		} else {
			var exitErr *exec.ExitError
			if errors.As(err, &exitErr) {
				p.exitCode = exitErr.ExitCode()
			}
		}
		close(p.done)
	}()
	return p, nil
}

func (p *backendProcess) roundTrip(prompt string) (string, error) {
	if p == nil {
		return "", fmt.Errorf("backend process not initialized")
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	select {
	case <-p.done:
		return "", fmt.Errorf("backend process already stopped")
	default:
	}

	if _, err := io.WriteString(p.stdin, prompt+"\n"); err != nil {
		return "", fmt.Errorf("write backend prompt: %w", err)
	}
	line, err := p.stdout.ReadString('\n')
	if err != nil {
		return "", fmt.Errorf("read backend response: %w", err)
	}
	return strings.TrimSpace(line), nil
}

func (p *backendProcess) stop() error {
	if p == nil {
		return nil
	}

	p.mu.Lock()
	stdin := p.stdin
	proc := p.cmd.Process
	done := p.done
	p.mu.Unlock()

	if stdin != nil {
		_ = stdin.Close()
	}

	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		if proc != nil {
			_ = proc.Signal(syscall.SIGTERM)
		}
		select {
		case <-done:
		case <-time.After(500 * time.Millisecond):
			if proc != nil {
				_ = proc.Kill()
			}
			<-done
		}
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if p.waitErr != nil {
		var exitErr *exec.ExitError
		if !errors.As(p.waitErr, &exitErr) {
			return p.waitErr
		}
	}
	return nil
}

func (p *backendProcess) snapshot() backendSnapshot {
	if p == nil {
		return backendSnapshot{}
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	snap := backendSnapshot{
		Status:    "running",
		StartedAt: p.startedAt,
		StoppedAt: p.stoppedAt,
		ExitCode:  p.exitCode,
	}
	if p.cmd != nil && p.cmd.Process != nil {
		snap.PID = p.cmd.Process.Pid
	}
	select {
	case <-p.done:
		snap.Status = "stopped"
	default:
	}
	return snap
}
