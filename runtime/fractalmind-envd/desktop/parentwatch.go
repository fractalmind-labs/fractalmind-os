package desktop

import (
	"context"
	"time"
)

// ParentExited closes when pid no longer exists. Supervised desktop processes
// use this to avoid surviving a hard worker crash and holding the listen port.
func ParentExited(ctx context.Context, pid int, interval time.Duration) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		if interval <= 0 {
			interval = time.Second
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if !parentAlive(pid) {
					return
				}
			}
		}
	}()
	return done
}
