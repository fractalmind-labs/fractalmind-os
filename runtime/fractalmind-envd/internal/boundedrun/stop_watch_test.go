package boundedrun

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
)

type watchAuthority struct {
	mu sync.Mutex
	*authorityProbe
	missing bool
}

func (p *watchAuthority) Resolve(ctx context.Context, c nodecommand.CapabilityRef) (nodecommand.CapabilityState, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.authorityProbe.Resolve(ctx, c)
}
func (p *watchAuthority) LookupExecution(ctx context.Context, cap, intent string) (nodecommand.ChainExecution, bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.fail {
		return nodecommand.ChainExecution{}, false, errors.New("checkpoint RPC unavailable")
	}
	if p.missing {
		return nodecommand.ChainExecution{}, false, nil
	}
	return p.authorityProbe.LookupExecution(ctx, cap, intent)
}
func (p *watchAuthority) ChainTime(ctx context.Context) (int64, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.authorityProbe.ChainTime(ctx)
}

func TestStopWatchOnlyAcknowledgesTheExactOriginalAttempt(t *testing.T) {
	for _, mode := range []string{"stop", "foreign stopped attempt", "missing", "RPC unavailable"} {
		t.Run(mode, func(t *testing.T) {
			command, probe, dir := guardFixture(t)
			p := &watchAuthority{authorityProbe: probe}
			guard, err := NewGuard(context.Background(), p, command, probe.run, dir)
			if err != nil {
				t.Fatal(err)
			}
			ctx, finish := guard.watch(context.Background(), 5*time.Millisecond)
			p.mu.Lock()
			switch mode {
			case "stop":
				p.run.StopRequested = true
			case "foreign stopped attempt":
				p.run.StopRequested = true
				p.run.AttemptID = "another-attempt"
			case "missing":
				p.missing = true
			case "RPC unavailable":
				p.fail = true
			}
			p.mu.Unlock()
			select {
			case <-ctx.Done():
			case <-time.After(3 * time.Second):
				t.Fatal("original watch did not terminate")
			}
			cause := finish()
			var watchError *ExecutionWatchError
			if !errors.As(cause, &watchError) {
				t.Fatalf("missing typed original cause: %v", cause)
			}
			if mode == "stop" {
				if !errors.Is(cause, ErrStopped) {
					t.Fatal(cause)
				}
			} else if errors.Is(cause, ErrStopped) {
				t.Fatal("unavailable/foreign attempt acknowledged as stopped")
			}
		})
	}
}

func TestFinishedWatchDoesNotCancelTheParentOrCreateAStop(t *testing.T) {
	command, probe, dir := guardFixture(t)
	p := &watchAuthority{authorityProbe: probe}
	guard, err := NewGuard(context.Background(), p, command, probe.run, dir)
	if err != nil {
		t.Fatal(err)
	}
	parent, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, finish := guard.watch(parent, 5*time.Millisecond)
	if err := finish(); err != nil || parent.Err() != nil || probe.run.StopRequested {
		t.Fatal("normal completion became a stop", err)
	}
}

type heldPlanner struct {
	entered chan struct{}
	calls   int
}

func (p *heldPlanner) Next(ctx context.Context, _ PlanningContext) (Decision, error) {
	p.calls++
	close(p.entered)
	<-ctx.Done()
	return Decision{}, ctx.Err()
}
func TestStopInterruptsPendingPlannerWithoutToolsOrAnotherRequest(t *testing.T) {
	command, probe, dir := guardFixture(t)
	p := &watchAuthority{authorityProbe: probe}
	guard, err := NewGuard(context.Background(), p, command, probe.run, dir)
	if err != nil {
		t.Fatal(err)
	}
	tools := openTestTools(t, dir, 4, guard.Check)
	planner := &heldPlanner{entered: make(chan struct{})}
	done := make(chan Outcome, 1)
	go func() {
		done <- RunPlannedFileGoals(context.Background(), tools, FileTask{Kind: "ensure_text_files", Files: []FileGoal{{Path: "result.md", Content: "approved"}}}, guard.Planner(planner), 4, guard.Check)
	}()
	select {
	case <-planner.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("planner was not reached")
	}
	p.mu.Lock()
	p.run.StopRequested = true
	p.mu.Unlock()
	select {
	case out := <-done:
		if out.Status != "blocked" || out.Reason != "stopped" || out.Used != 0 || len(out.Evidence) != 0 || planner.calls != 1 {
			t.Fatal("unsafe stop result", out, planner.calls)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("pending planner was not cancelled")
	}
}
