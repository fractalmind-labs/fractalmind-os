package boundedrun

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type plannerFunc func(context.Context, PlanningContext) (Decision, error)

func (f plannerFunc) Next(ctx context.Context, p PlanningContext) (Decision, error) { return f(ctx, p) }

func TestModelPlannerUsesActualToolsAndNeverAcceptsGoals(t *testing.T) {
	dir := t.TempDir()
	checks := 0
	check := func(context.Context) error { checks++; return nil }
	tools, err := OpenTools(Policy{Workspace: dir, Paths: map[string][]string{Read: {"."}, Write: {"."}}, Deadline: time.Now().Add(time.Minute), MaxCalls: 3}, check)
	if err != nil {
		t.Fatal(err)
	}
	defer tools.Close()
	calls := 0
	planner := plannerFunc(func(_ context.Context, p PlanningContext) (Decision, error) {
		calls++
		encoded, _ := json.Marshal(p)
		var wire map[string]any
		if json.Unmarshal(encoded, &wire) != nil || wire["host_observations"] == nil {
			t.Fatal("observations must be an explicit array on the model wire")
		}
		if p.RemainingCalls != uint64(4-calls) || len(p.Observations) != calls-1 {
			t.Fatal("incorrect actual budget/observations", p)
		}
		// Mutation of the proposal input must not change the Host's approved goal.
		p.Task.Files[0].Content = "forged"
		switch calls {
		case 1:
			return Decision{Call: &Call{Action: Read, Path: "output.md"}}, nil
		case 2:
			if p.Observations[0].Error != "file_missing" {
				t.Fatal("missing actual read")
			}
			return Decision{Call: &Call{Action: Write, Path: "output.md", Content: "approved"}}, nil
		default:
			return Decision{Call: &Call{Action: Read, Path: "output.md"}}, nil
		}
	})
	out := RunPlannedFileGoals(context.Background(), tools, FileTask{Kind: "ensure_text_files", Files: []FileGoal{{"output.md", "approved"}}}, planner, 3, check)
	value, _ := os.ReadFile(filepath.Join(dir, "output.md"))
	if out.Status != "submitted" || out.Used != 3 || len(out.Evidence) != 1 || !out.Evidence[0].Verified || string(value) != "approved" || calls != 3 || checks < 9 {
		t.Fatalf("actual measurement failed: %+v checks=%d calls=%d", out, checks, calls)
	}
}

func TestModelPlannerCannotReplaceAuthorityOrClaimEvidence(t *testing.T) {
	for _, mode := range []string{"outside approved file", "changed approved content", "model says done", "stop during model", "request limit", "tool budget", "write without current hash"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, "output.md"), []byte("original"), 0600); err != nil {
				t.Fatal(err)
			}
			stopped := false
			check := func(context.Context) error {
				if stopped {
					return ErrStopped
				}
				return nil
			}
			limit := uint64(3)
			if mode == "tool budget" {
				limit = 1
			}
			tools, err := OpenTools(Policy{Workspace: dir, Paths: map[string][]string{Read: {"."}, Write: {"."}}, Deadline: time.Now().Add(time.Minute), MaxCalls: limit}, check)
			if err != nil {
				t.Fatal(err)
			}
			defer tools.Close()
			calls := 0
			p := plannerFunc(func(context.Context, PlanningContext) (Decision, error) {
				calls++
				switch mode {
				case "outside approved file":
					return Decision{Call: &Call{Action: Write, Path: "other.md", Content: "approved"}}, nil
				case "changed approved content":
					return Decision{Call: &Call{Action: Write, Path: "output.md", Content: "forged"}}, nil
				case "model says done":
					return Decision{Stop: "all KR complete"}, nil
				case "stop during model":
					stopped = true
					return Decision{Call: &Call{Action: Write, Path: "output.md", Content: "approved"}}, nil
				case "write without current hash":
					return Decision{Call: &Call{Action: Write, Path: "output.md", Content: "approved"}}, nil
				default:
					return Decision{Call: &Call{Action: Read, Path: "output.md"}}, nil
				}
			})
			out := RunPlannedFileGoals(context.Background(), tools, FileTask{Kind: "ensure_text_files", Files: []FileGoal{{"output.md", "approved"}}}, p, 2, check)
			want := map[string]string{"outside approved file": "boundary_denied", "changed approved content": "boundary_denied", "model says done": "model_stopped", "stop during model": "stopped", "request limit": "model_limit", "tool budget": "budget_exhausted", "write without current hash": "workspace_changed"}[mode]
			value, _ := os.ReadFile(filepath.Join(dir, "output.md"))
			if out.Status != "blocked" || out.Reason != want || len(out.Evidence) != 0 || string(value) != "original" || calls > 2 {
				t.Fatalf("unsafe result %+v calls=%d", out, calls)
			}
			if _, err := os.Stat(filepath.Join(dir, "other.md")); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("unapproved file written")
			}
		})
	}
}

func TestPlannerDecisionRejectsUnframedClaims(t *testing.T) {
	for _, raw := range []string{`{"stop":"done","verified":true}`, `{"call":{"action":"file.write","path":"x"},"stop":"done"}`, `{"call":null}`, "```json\n{\"stop\":\"done\"}\n```", `{"stop":"done"} {}`} {
		if _, err := ParseDecision(raw); err == nil {
			t.Fatal("accepted unsupported decision", raw)
		}
	}
}
