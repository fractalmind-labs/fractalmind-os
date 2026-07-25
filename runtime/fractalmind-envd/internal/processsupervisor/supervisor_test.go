package processsupervisor

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSupervisorRestartsExitedProcess(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "starts")
	s, err := New(Config{
		Name:         "test-exit",
		Command:      os.Args[0],
		Args:         []string{"-test.run=TestSupervisorHelperProcess"},
		Env:          []string{"GO_WANT_SUPERVISOR_HELPER=exit", "SUPERVISOR_MARKER=" + marker},
		RestartDelay: 10 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.Run(ctx) }()
	waitForStarts(t, marker, 2)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestSupervisorRestartsUnhealthyProcess(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "starts")
	health := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "unhealthy", http.StatusServiceUnavailable)
	}))
	defer health.Close()

	s, err := New(Config{
		Name:               "test-health",
		Command:            os.Args[0],
		Args:               []string{"-test.run=TestSupervisorHelperProcess"},
		Env:                []string{"GO_WANT_SUPERVISOR_HELPER=wait", "SUPERVISOR_MARKER=" + marker},
		HealthURL:          health.URL,
		RestartDelay:       10 * time.Millisecond,
		HealthInterval:     10 * time.Millisecond,
		HealthTimeout:      100 * time.Millisecond,
		UnhealthyThreshold: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.Run(ctx) }()
	waitForStarts(t, marker, 2)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestSupervisorHelperProcess(t *testing.T) {
	mode := os.Getenv("GO_WANT_SUPERVISOR_HELPER")
	if mode == "" {
		return
	}
	marker := os.Getenv("SUPERVISOR_MARKER")
	f, err := os.OpenFile(marker, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		os.Exit(2)
	}
	_, _ = fmt.Fprintln(f, "start")
	_ = f.Close()
	if mode == "wait" {
		for {
			time.Sleep(time.Hour)
		}
	}
	os.Exit(1)
}

func waitForStarts(t *testing.T, marker string, want int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		data, _ := os.ReadFile(marker)
		if strings.Count(string(data), "start") >= want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	data, _ := os.ReadFile(marker)
	t.Fatalf("starts = %q, want at least %d", data, want)
}
