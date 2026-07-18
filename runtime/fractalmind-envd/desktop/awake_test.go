package desktop

import (
	"context"
	"reflect"
	"testing"
)

func TestMacOSAwakeCommands(t *testing.T) {
	if got, want := macOSAwakeHoldArgs(1234), []string{"caffeinate", "-dims", "-w", "1234"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("hold args = %#v, want %#v", got, want)
	}
	if got, want := macOSUserActiveArgs(), []string{"caffeinate", "-u", "-t", "2"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("nudge args = %#v, want %#v", got, want)
	}
}

func TestNudgeUserActiveOnlyRunsOnDarwin(t *testing.T) {
	old := runContextArgv
	defer func() { runContextArgv = old }()

	var calls [][]string
	runContextArgv = func(_ context.Context, argv []string) error {
		calls = append(calls, append([]string(nil), argv...))
		return nil
	}

	if err := NudgeUserActive(context.Background(), "linux"); err != nil {
		t.Fatalf("linux nudge: %v", err)
	}
	if len(calls) != 0 {
		t.Fatalf("linux nudge should be no-op, calls=%#v", calls)
	}
	if err := NudgeUserActive(context.Background(), "darwin"); err != nil {
		t.Fatalf("darwin nudge: %v", err)
	}
	if len(calls) != 1 || !reflect.DeepEqual(calls[0], macOSUserActiveArgs()) {
		t.Fatalf("darwin nudge calls=%#v", calls)
	}
}
