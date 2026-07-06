package desktop

import (
	"context"
	"sync"
	"testing"

	"github.com/pion/webrtc/v4"
)

// TestConcurrentCloseNoPanic exercises the teardown path that is reachable from
// several goroutines at once (HTTP session-replace, ICE state callback, and the
// streaming goroutine). Before the sync.Once guard this panicked with
// "close of closed channel".
func TestConcurrentCloseNoPanic(t *testing.T) {
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	_, cancel := context.WithCancel(context.Background())
	s := &Session{
		pc:       pc,
		injector: NewInjector(100, 100),
		cancel:   cancel,
		closed:   make(chan struct{}),
	}

	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); s.Close() }()
	}
	wg.Wait()

	// Done channel must be closed exactly once and observable.
	select {
	case <-s.Done():
	default:
		t.Fatal("Done() channel not closed after Close()")
	}
	// A further Close must remain a no-op (no panic).
	s.Close()
}
