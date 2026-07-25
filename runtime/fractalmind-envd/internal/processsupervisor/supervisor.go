package processsupervisor

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"time"
)

const stopTimeout = 5 * time.Second

// Config describes one long-running child process and its liveness probe.
type Config struct {
	Name               string
	Command            string
	Args               []string
	Env                []string
	HealthURL          string
	RestartDelay       time.Duration
	HealthInterval     time.Duration
	HealthTimeout      time.Duration
	UnhealthyThreshold int
}

// Supervisor restarts a child after exit or repeated health-check failures.
type Supervisor struct {
	cfg    Config
	client *http.Client
}

func New(cfg Config) (*Supervisor, error) {
	if cfg.Command == "" {
		return nil, errors.New("supervised command is required")
	}
	if cfg.Name == "" {
		cfg.Name = cfg.Command
	}
	if cfg.RestartDelay <= 0 {
		cfg.RestartDelay = 2 * time.Second
	}
	if cfg.HealthInterval <= 0 {
		cfg.HealthInterval = 10 * time.Second
	}
	if cfg.HealthTimeout <= 0 {
		cfg.HealthTimeout = 3 * time.Second
	}
	if cfg.UnhealthyThreshold <= 0 {
		cfg.UnhealthyThreshold = 3
	}
	return &Supervisor{
		cfg:    cfg,
		client: &http.Client{Timeout: cfg.HealthTimeout},
	}, nil
}

// Run blocks until ctx is canceled. Process failures are handled internally.
func (s *Supervisor) Run(ctx context.Context) error {
	for {
		if err := ctx.Err(); err != nil {
			return nil
		}

		cmd := exec.Command(s.cfg.Command, s.cfg.Args...)
		cmd.Env = append(os.Environ(), s.cfg.Env...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		configureProcess(cmd)

		if err := cmd.Start(); err != nil {
			log.Printf("[supervisor:%s] start failed: %v", s.cfg.Name, err)
			if !waitForRestart(ctx, s.cfg.RestartDelay) {
				return nil
			}
			continue
		}

		log.Printf("[supervisor:%s] started pid=%d", s.cfg.Name, cmd.Process.Pid)
		waitCh := make(chan error, 1)
		go func() { waitCh <- cmd.Wait() }()

		reason := s.monitor(ctx, cmd, waitCh)
		if reason == monitorStopped {
			return nil
		}
		if !waitForRestart(ctx, s.cfg.RestartDelay) {
			return nil
		}
	}
}

type monitorResult int

const (
	monitorRestart monitorResult = iota
	monitorStopped
)

func (s *Supervisor) monitor(ctx context.Context, cmd *exec.Cmd, waitCh <-chan error) monitorResult {
	ticker := time.NewTicker(s.cfg.HealthInterval)
	defer ticker.Stop()

	unhealthy := 0
	for {
		select {
		case err := <-waitCh:
			log.Printf("[supervisor:%s] exited: %v", s.cfg.Name, err)
			return monitorRestart
		case <-ctx.Done():
			stopAndWait(cmd.Process, waitCh, stopTimeout)
			log.Printf("[supervisor:%s] stopped", s.cfg.Name)
			return monitorStopped
		case <-ticker.C:
			if s.cfg.HealthURL == "" {
				continue
			}
			if err := s.checkHealth(ctx); err != nil {
				unhealthy++
				log.Printf("[supervisor:%s] health failure %d/%d: %v", s.cfg.Name, unhealthy, s.cfg.UnhealthyThreshold, err)
				if unhealthy >= s.cfg.UnhealthyThreshold {
					stopAndWait(cmd.Process, waitCh, stopTimeout)
					log.Printf("[supervisor:%s] restarting unhealthy process", s.cfg.Name)
					return monitorRestart
				}
				continue
			}
			if unhealthy > 0 {
				log.Printf("[supervisor:%s] health recovered", s.cfg.Name)
			}
			unhealthy = 0
		}
	}
}

func (s *Supervisor) checkHealth(parent context.Context) error {
	ctx, cancel := context.WithTimeout(parent, s.cfg.HealthTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.HealthURL, nil)
	if err != nil {
		return err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("health status %d", resp.StatusCode)
	}
	return nil
}

func waitForRestart(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
