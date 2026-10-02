package ws

import (
	"context"
	"testing"
	"time"
)

func TestCloseCancelsChainLookupBeforeDial(t *testing.T) {
	c := NewClient("ws://must-not-dial.invalid", time.Hour)
	started := make(chan struct{})
	c.SetChainAuthority(func(ctx context.Context) (string, string, error) {
		close(started)
		<-ctx.Done()
		return "", "", ctx.Err()
	}, nil)
	finished := make(chan struct{})
	go func() { c.Connect(); close(finished) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("chain lookup did not start")
	}
	c.Close()
	c.Close()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("closed Host waited for retry instead of canceling chain lookup")
	}
}
