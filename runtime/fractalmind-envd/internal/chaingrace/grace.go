// Package chaingrace lets a live, already-authorized connection ride out a
// short chain-read outage. Ordinary traffic (heartbeats, observations, status)
// skips one frame instead of closing the connection when the current authority
// cannot be read for a moment. A definitive answer, such as a revoked
// membership or a changed binding, still closes it, and nothing here ever
// grants authority that the last successful read did not.
package chaingrace

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Window is how long after the last successful authority read a transient
// read failure is tolerated. Past it, the connection fails closed.
const Window = 2 * time.Minute

// Transient reports chain-read failures that say nothing about authority: an
// RPC timeout or outage, or a snapshot that changed while it was being read.
func Transient(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, nodecommand.ErrChainSnapshotChanged) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	if s, ok := status.FromError(err); ok {
		switch s.Code() {
		case codes.DeadlineExceeded, codes.Unavailable, codes.ResourceExhausted, codes.Aborted:
			return true
		}
	}
	return false
}

// Grace remembers the last successful authority read of one connection.
type Grace struct {
	mu   sync.Mutex
	last time.Time
	// Now is for tests; nil means time.Now.
	Now func() time.Time
}

func (g *Grace) now() time.Time {
	if g.Now != nil {
		return g.Now()
	}
	return time.Now()
}

// Succeeded records a successful authority read.
func (g *Grace) Succeeded() {
	g.mu.Lock()
	g.last = g.now()
	g.mu.Unlock()
}

// Tolerate reports whether err is transient and the last successful read is
// recent enough to skip only the current frame.
func (g *Grace) Tolerate(err error) bool {
	if !Transient(err) {
		return false
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	return !g.last.IsZero() && g.now().Sub(g.last) <= Window
}
