package desktop

import (
	"context"
	"os"
	"runtime"
	"testing"
	"time"
)

func TestParentExitedStopsWithContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	done := ParentExited(ctx, os.Getpid(), time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("parent watcher did not stop after context cancellation")
	}
}

func TestParentExitedDetectsMissingProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("hard-parent-exit detection is Unix-only")
	}
	done := ParentExited(context.Background(), 1<<30, time.Millisecond)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("missing parent was not detected")
	}
}
