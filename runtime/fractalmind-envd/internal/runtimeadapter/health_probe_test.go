package runtimeadapter

import (
	"context"
	"encoding/json"
	"os/exec"
	"strings"
	"testing"
)

type recordingAdapter struct{ ops []Operation }

func (r *recordingAdapter) run(_ context.Context, request Request) (Response, error) {
	r.ops = append(r.ops, request.Operation)
	return Response{SchemaVersion: SchemaVersion, Adapter: AdapterName, CommandID: request.CommandID, Operation: request.Operation, OK: true}, nil
}

func shell(t *testing.T) string {
	t.Helper()
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("sh unavailable")
	}
	return sh
}

func TestHealthRunsOnlyConfiguredProbes(t *testing.T) {
	sh := shell(t)
	base := &recordingAdapter{}
	adapter, err := WithHealthProbes(base, []HealthProbe{
		{Name: "ok-check", Argv: []string{sh, "-c", "echo verified"}},
		{Name: "bad-check", Argv: []string{sh, "-c", "echo broken >&2; exit 3"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	response, err := adapter.run(context.Background(), Request{SchemaVersion: SchemaVersion, CommandID: "c1", Operation: OperationHealth})
	if err != nil {
		t.Fatal(err)
	}
	if response.OK || response.Error == nil || !strings.Contains(response.Error.Message, "bad-check") {
		t.Fatalf("a failing probe must fail health: %+v", response)
	}
	var result struct {
		Probes []ProbeResult `json:"probes"`
	}
	if err = json.Unmarshal(response.Result, &result); err != nil || len(result.Probes) != 2 {
		t.Fatalf("result: %s %v", response.Result, err)
	}
	if !result.Probes[0].OK || strings.TrimSpace(result.Probes[0].Stdout) != "verified" || result.Probes[1].ExitCode != 3 || !strings.Contains(result.Probes[1].Stderr, "broken") {
		t.Fatalf("probe results: %+v", result.Probes)
	}
	if len(base.ops) != 0 {
		t.Fatal("health must not reach the base adapter when probes are configured")
	}
	if _, err = adapter.run(context.Background(), Request{SchemaVersion: SchemaVersion, CommandID: "c2", Operation: OperationInventory}); err != nil || len(base.ops) != 1 {
		t.Fatal("other operations must go to the base adapter unchanged")
	}
	if _, err = adapter.run(context.Background(), Request{SchemaVersion: SchemaVersion, CommandID: "c3", Operation: OperationHealth, Agent: "tmux-x"}); err == nil {
		t.Fatal("health is node-wide; an agent target must be refused")
	}
}

func TestHealthProbeBoundsOutputAndTime(t *testing.T) {
	sh := shell(t)
	adapter, err := WithHealthProbes(&recordingAdapter{}, []HealthProbe{
		{Name: "noisy", Argv: []string{sh, "-c", "head -c 20000 /dev/zero | tr '\\0' x"}},
		{Name: "slow", Argv: []string{sh, "-c", "sleep 5"}, TimeoutSeconds: 1},
	})
	if err != nil {
		t.Fatal(err)
	}
	response, err := adapter.run(context.Background(), Request{SchemaVersion: SchemaVersion, CommandID: "c1", Operation: OperationHealth})
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Probes []ProbeResult `json:"probes"`
	}
	_ = json.Unmarshal(response.Result, &result)
	if len(result.Probes[0].Stdout) != probeOutputLimit || !result.Probes[0].Truncated {
		t.Fatalf("output not bounded: %d", len(result.Probes[0].Stdout))
	}
	if result.Probes[1].OK || result.Probes[1].DurationMS > 3000 {
		t.Fatalf("slow probe not stopped at its timeout: %+v", result.Probes[1])
	}
}

func TestHealthProbeConfigurationIsChecked(t *testing.T) {
	for name, probes := range map[string][]HealthProbe{
		"relative program": {{Name: "x", Argv: []string{"python3", "verify.py"}}},
		"empty argv":       {{Name: "x"}},
		"bad name":         {{Name: "Bad Name", Argv: []string{"/bin/true"}}},
		"duplicate":        {{Name: "x", Argv: []string{"/bin/true"}}, {Name: "x", Argv: []string{"/bin/true"}}},
		"relative dir":     {{Name: "x", Argv: []string{"/bin/true"}, Dir: "tools"}},
		"timeout":          {{Name: "x", Argv: []string{"/bin/true"}, TimeoutSeconds: 1000}},
	} {
		if _, err := WithHealthProbes(&recordingAdapter{}, probes); err == nil {
			t.Errorf("%s: expected a configuration error", name)
		}
	}
}
