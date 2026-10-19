package runtimeadapter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"time"
)

// HealthProbe is a fixed, read-only check the Host owner configured. A signed
// health command can only run the configured argv: nothing in the command
// selects, extends or changes it.
type HealthProbe struct {
	Name           string
	Argv           []string
	Dir            string
	TimeoutSeconds int
}

const (
	maxHealthProbes       = 8
	probeOutputLimit      = 4 << 10
	defaultProbeTimeout   = 30
	maxProbeTimeout       = 120
	healthProbeAdapterTag = "host-health-probes"
)

var probeNamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// ProbeResult is one probe's outcome in the health result.
type ProbeResult struct {
	Name       string `json:"name"`
	OK         bool   `json:"ok"`
	ExitCode   int    `json:"exit_code"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	Truncated  bool   `json:"truncated"`
	DurationMS int64  `json:"duration_ms"`
}

type healthProbeAdapter struct {
	base   Adapter
	probes []HealthProbe
}

// WithHealthProbes answers the node-wide health operation by running the
// configured probes; every other operation goes to base unchanged.
func WithHealthProbes(base Adapter, probes []HealthProbe) (Adapter, error) {
	if len(probes) == 0 {
		return base, nil
	}
	if len(probes) > maxHealthProbes {
		return nil, fmt.Errorf("at most %d health probes", maxHealthProbes)
	}
	seen := map[string]bool{}
	checked := make([]HealthProbe, 0, len(probes))
	for _, p := range probes {
		if !probeNamePattern.MatchString(p.Name) || seen[p.Name] {
			return nil, fmt.Errorf("health probe names must be unique lowercase identifiers")
		}
		seen[p.Name] = true
		if len(p.Argv) == 0 || !filepath.IsAbs(p.Argv[0]) {
			return nil, fmt.Errorf("health probe %s needs an argv whose program is an absolute path", p.Name)
		}
		if p.Dir != "" && !filepath.IsAbs(p.Dir) {
			return nil, fmt.Errorf("health probe %s needs an absolute dir", p.Name)
		}
		if p.TimeoutSeconds == 0 {
			p.TimeoutSeconds = defaultProbeTimeout
		}
		if p.TimeoutSeconds < 1 || p.TimeoutSeconds > maxProbeTimeout {
			return nil, fmt.Errorf("health probe %s timeout must be 1–%d seconds", p.Name, maxProbeTimeout)
		}
		p.Argv = append([]string(nil), p.Argv...)
		checked = append(checked, p)
	}
	return &healthProbeAdapter{base: base, probes: checked}, nil
}

func (a *healthProbeAdapter) Supports(operation Operation) bool {
	if operation == OperationHealth {
		return true
	}
	if s, ok := a.base.(interface{ Supports(Operation) bool }); ok {
		return s.Supports(operation)
	}
	return true
}

func (a *healthProbeAdapter) run(ctx context.Context, request Request) (Response, error) {
	if request.Operation != OperationHealth {
		return a.base.run(ctx, request)
	}
	if err := request.Validate(); err != nil {
		return Response{}, err
	}
	if request.Cancel {
		return Response{}, runError("cancelled", fmt.Errorf("health probes cancelled before execution"))
	}
	if ctx == nil {
		ctx = context.Background()
	}
	results := make([]ProbeResult, 0, len(a.probes))
	failed := ""
	for _, p := range a.probes {
		r, err := runProbe(ctx, p)
		if err != nil {
			return Response{}, err
		}
		if !r.OK && failed == "" {
			failed = p.Name
		}
		results = append(results, r)
	}
	body, err := json.Marshal(struct {
		Source string        `json:"source"`
		Probes []ProbeResult `json:"probes"`
	}{healthProbeAdapterTag, results})
	if err != nil {
		return Response{}, err
	}
	response := Response{SchemaVersion: SchemaVersion, Adapter: AdapterName, CommandID: request.CommandID, Operation: request.Operation, OK: failed == "", ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), Result: body}
	if failed != "" {
		response.Error = &Error{Code: "operation_failed", Message: "health probe " + failed + " failed"}
	}
	if err = response.Validate(request); err != nil {
		return Response{}, runError("internal_error", err)
	}
	return response, nil
}

func runProbe(parent context.Context, p HealthProbe) (ProbeResult, error) {
	ctx, cancel := context.WithTimeout(parent, time.Duration(p.TimeoutSeconds)*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, p.Argv[0], p.Argv[1:]...)
	configureProcessGroup(cmd)
	cmd.Dir = p.Dir
	stdout, stderr := newBoundedBuffer(probeOutputLimit+1), newBoundedBuffer(probeOutputLimit+1)
	cmd.Stdout, cmd.Stderr = stdout, stderr
	started := time.Now()
	runErr := cmd.Run()
	if errors.Is(parent.Err(), context.Canceled) {
		return ProbeResult{}, runError("cancelled", fmt.Errorf("health probes cancelled: %w", parent.Err()))
	}
	r := ProbeResult{Name: p.Name, DurationMS: time.Since(started).Milliseconds()}
	out, errOut := stdout.Bytes(), stderr.Bytes()
	r.Truncated = len(out) > probeOutputLimit || len(errOut) > probeOutputLimit
	r.Stdout, r.Stderr = string(trimTo(out, probeOutputLimit)), string(trimTo(errOut, probeOutputLimit))
	var exitErr *exec.ExitError
	switch {
	case runErr == nil:
		r.OK = true
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		r.ExitCode = -1
		r.Stderr += "\n[timed out]"
	case errors.As(runErr, &exitErr):
		r.ExitCode = exitErr.ExitCode()
	default:
		r.ExitCode = -1
		r.Stderr += "\n[" + runErr.Error() + "]"
	}
	return r, nil
}

func trimTo(b []byte, n int) []byte {
	if len(b) > n {
		return b[:n]
	}
	return b
}
