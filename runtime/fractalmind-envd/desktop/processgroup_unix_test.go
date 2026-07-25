//go:build !windows

package desktop

import (
	"reflect"
	"syscall"
	"testing"
	"time"
)

func TestTerminateProcessGroupEscalatesAfterGracePeriod(t *testing.T) {
	type signalCall struct {
		pid    int
		signal syscall.Signal
	}

	var calls []signalCall
	var sleeps []time.Duration
	terminateProcessGroup(42, func(pid int, signal syscall.Signal) error {
		calls = append(calls, signalCall{pid: pid, signal: signal})
		return nil
	}, func(duration time.Duration) {
		sleeps = append(sleeps, duration)
	})

	wantCalls := []signalCall{
		{pid: -42, signal: syscall.SIGTERM},
		{pid: -42, signal: syscall.SIGKILL},
	}
	if !reflect.DeepEqual(calls, wantCalls) {
		t.Fatalf("signal calls = %#v, want %#v", calls, wantCalls)
	}
	if !reflect.DeepEqual(sleeps, []time.Duration{processGroupStopGrace}) {
		t.Fatalf("sleeps = %#v, want [%s]", sleeps, processGroupStopGrace)
	}
}
