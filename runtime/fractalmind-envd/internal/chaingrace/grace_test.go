package chaingrace

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestTransientOnlyForReadFailures(t *testing.T) {
	for name, tc := range map[string]struct {
		err  error
		want bool
	}{
		"rpc timeout":         {status.Error(codes.DeadlineExceeded, "context deadline exceeded"), true},
		"wrapped rpc timeout": {fmt.Errorf("read membership: %w", status.Error(codes.DeadlineExceeded, "x")), true},
		"rpc unavailable":     {status.Error(codes.Unavailable, "x"), true},
		"context deadline":    {fmt.Errorf("read: %w", context.DeadlineExceeded), true},
		"snapshot changed":    {fmt.Errorf("join authority changed: %w", nodecommand.ErrChainSnapshotChanged), true},
		"object not found":    {status.Error(codes.NotFound, "membership"), false},
		"revoked":             {errors.New("chain membership no longer current"), false},
		"nil":                 {nil, false},
	} {
		if got := Transient(tc.err); got != tc.want {
			t.Errorf("%s: Transient = %v, want %v", name, got, tc.want)
		}
	}
}

func TestToleranceNeedsARecentSuccess(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	g := &Grace{Now: func() time.Time { return now }}
	timeout := status.Error(codes.DeadlineExceeded, "x")
	if g.Tolerate(timeout) {
		t.Fatal("a connection that never read its authority must fail closed")
	}
	g.Succeeded()
	now = now.Add(Window)
	if !g.Tolerate(timeout) {
		t.Fatal("a transient failure within the window should skip one frame")
	}
	if g.Tolerate(errors.New("chain membership no longer current")) {
		t.Fatal("a definitive authority answer must never be tolerated")
	}
	now = now.Add(time.Second)
	if g.Tolerate(timeout) {
		t.Fatal("past the window a transient failure must close the connection")
	}
}
