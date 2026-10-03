package boundedrun

import (
	"context"
	"fmt"
	"time"
)

// ExecutionWatchError distinguishes original-checkpoint loss from a provider
// failure. It is never an acknowledgement that an unknown Run has stopped.
type ExecutionWatchError struct{ Cause error }

func (e *ExecutionWatchError) Error() string { return "original execution watch: " + e.Cause.Error() }
func (e *ExecutionWatchError) Unwrap() error { return e.Cause }

// Watch interrupts a pending model request when this exact original attempt
// is stopped or becomes unavailable. Tool authority still uses Check. finish
// joins the reader, returns its cause and then releases the child context;
// callers must not use the watched context after finish.
func (g *Guard) Watch(ctx context.Context) (context.Context, func() error) {
	return g.watch(ctx, time.Second)
}

func (g *Guard) watch(ctx context.Context, interval time.Duration) (context.Context, func() error) {
	watched, cancel := context.WithCancelCause(ctx)
	polling, stop := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-polling.Done():
				return
			case <-ticker.C:
			}
			readCtx, finishRead := context.WithTimeout(polling, 2*time.Second)
			run, found, err := g.reader.LookupExecution(readCtx, g.command.Capability.ID, g.fingerprint)
			finishRead()
			if polling.Err() != nil {
				return
			}
			if err != nil {
				cancel(&ExecutionWatchError{fmt.Errorf("current checkpoint unavailable: %w", err)})
				return
			}
			if !found || run.ID != g.runID || run.AttemptID != g.attemptID || run.Fingerprint != g.fingerprint || run.CapabilityID != g.command.Capability.ID || run.CapabilityVersion != uint64(g.command.Capability.RevocationVersion) || run.Target != g.command.Target || run.HostAddress != g.command.Target.NodeID || run.Signer != g.command.Signer || run.ManagedAgentID != g.managedID || run.Action != g.command.Action || run.Scope != g.command.Scope || run.ExpiresAtMS != g.command.ExpiresAtMS {
				cancel(&ExecutionWatchError{ErrBoundary})
				return
			}
			if run.StopRequested {
				cancel(&ExecutionWatchError{ErrStopped})
				return
			}
			if run.State != 1 {
				cancel(&ExecutionWatchError{ErrBoundary})
				return
			}
		}
	}()
	return watched, func() error {
		stop()
		<-done
		cause := context.Cause(watched)
		cancel(nil)
		return cause
	}
}

type watchedPlanner struct {
	guard   *Guard
	planner Planner
}

// Planner wraps only the pending provider call, not a new execution engine.
func (g *Guard) Planner(planner Planner) Planner { return &watchedPlanner{g, planner} }

func (p *watchedPlanner) Next(ctx context.Context, input PlanningContext) (Decision, error) {
	watched, finish := p.guard.Watch(ctx)
	decision, err := p.planner.Next(watched, input)
	if cause := finish(); cause != nil {
		return Decision{}, cause
	}
	return decision, err
}
