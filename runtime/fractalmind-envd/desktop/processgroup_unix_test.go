//go:build !windows

package desktop

import (
	"os"
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

func TestExitProcessGroupRestoresSignalBeforeExit(t *testing.T) {
	type signalCall struct {
		pid    int
		signal syscall.Signal
	}
	var restored bool
	var calls []signalCall
	var sleeps []time.Duration
	var exitCode *int

	exitProcessGroup(
		func() int { return 42 },
		func() int { return 42 },
		func(sig os.Signal) func() {
			if sig != syscall.SIGTERM {
				t.Fatalf("shield signal = %v, want SIGTERM", sig)
			}
			return func() { restored = true }
		},
		func(pid int, signal syscall.Signal) error {
			if restored {
				t.Fatal("signal restored before group kill sequence completed")
			}
			calls = append(calls, signalCall{pid: pid, signal: signal})
			return nil
		},
		func(duration time.Duration) {
			if restored {
				t.Fatal("signal restored before grace sleep completed")
			}
			sleeps = append(sleeps, duration)
		},
		func(code int) {
			if !restored {
				t.Fatal("exit called before signal restoration")
			}
			exitCode = &code
		},
	)

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
	if exitCode == nil || *exitCode != 0 {
		t.Fatalf("exit code = %v, want 0", exitCode)
	}
}

func TestExitProcessGroupSkipsShieldOutsideOwnGroup(t *testing.T) {
	var shielded bool
	var killed bool
	var exitCode *int

	exitProcessGroup(
		func() int { return 24 },
		func() int { return 42 },
		func(sig os.Signal) func() {
			shielded = true
			return func() {}
		},
		func(pid int, signal syscall.Signal) error {
			killed = true
			return nil
		},
		func(duration time.Duration) {},
		func(code int) { exitCode = &code },
	)

	if shielded {
		t.Fatal("shield called outside own process group")
	}
	if killed {
		t.Fatal("kill called outside own process group")
	}
	if exitCode == nil || *exitCode != 0 {
		t.Fatalf("exit code = %v, want 0", exitCode)
	}
}

func TestExitProcessGroupUsesSIGTERMShield(t *testing.T) {
	exitProcessGroup(
		func() int { return 42 },
		func() int { return 42 },
		func(sig os.Signal) func() {
			if sig != syscall.SIGTERM {
				t.Fatalf("shield signal = %v, want SIGTERM", sig)
			}
			return func() {}
		},
		func(pid int, signal syscall.Signal) error { return nil },
		func(duration time.Duration) {},
		func(code int) {},
	)
}
