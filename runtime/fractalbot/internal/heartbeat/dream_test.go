package heartbeat

import (
	"testing"
	"time"

	"github.com/fractalmind-ai/fractalbot/internal/config"
)

func TestDecideDreamUsesHeartbeatWhenDisabled(t *testing.T) {
	job := config.HeartbeatJobConfig{Text: "heartbeat text", Timezone: "Asia/Shanghai"}
	now := time.Date(2026, 8, 24, 5, 10, 0, 0, time.UTC) // 13:10 CST
	got := decideDream(job, now, time.Time{}, time.Time{}, false)
	if got.Kind != dispatchKindHeartbeat || got.Text != "heartbeat text" || got.WindowID != "" {
		t.Fatalf("disabled dream: %#v", got)
	}

	job.Dream = &config.HeartbeatDreamConfig{Enabled: false, FixedWindows: []config.HeartbeatDreamWindow{{
		Start: "13:00", End: "13:30",
	}}}
	got = decideDream(job, now, time.Time{}, time.Time{}, false)
	if got.Kind != dispatchKindHeartbeat {
		t.Fatalf("explicitly disabled dream: %#v", got)
	}
}

func TestDecideDreamMatchesFixedWindowsAndOvernight(t *testing.T) {
	job := config.HeartbeatJobConfig{
		Text:     "heartbeat text",
		Timezone: "Asia/Shanghai",
		Dream: &config.HeartbeatDreamConfig{
			Enabled: true,
			Text:    "dream text",
			FixedWindows: []config.HeartbeatDreamWindow{
				{Start: "13:00", End: "13:30"},
				{Start: "02:00", End: "04:00"},
				{Start: "23:00", End: "01:00"},
			},
		},
	}
	shanghai := time.FixedZone("CST", 8*3600)
	tests := []struct {
		name     string
		now      time.Time
		wantKind string
		wantID   string
	}{
		{name: "before noon window", now: time.Date(2026, 8, 24, 12, 59, 0, 0, shanghai), wantKind: dispatchKindHeartbeat},
		{name: "start inclusive", now: time.Date(2026, 8, 24, 13, 0, 0, 0, shanghai), wantKind: dispatchKindDream, wantID: "13:00-13:30"},
		{name: "inside noon window", now: time.Date(2026, 8, 24, 13, 15, 0, 0, shanghai), wantKind: dispatchKindDream, wantID: "13:00-13:30"},
		{name: "end exclusive", now: time.Date(2026, 8, 24, 13, 30, 0, 0, shanghai), wantKind: dispatchKindHeartbeat},
		{name: "night window", now: time.Date(2026, 8, 24, 3, 0, 0, 0, shanghai), wantKind: dispatchKindDream, wantID: "02:00-04:00"},
		{name: "overnight before midnight", now: time.Date(2026, 8, 24, 23, 30, 0, 0, shanghai), wantKind: dispatchKindDream, wantID: "23:00-01:00"},
		{name: "overnight after midnight", now: time.Date(2026, 8, 24, 0, 30, 0, 0, shanghai), wantKind: dispatchKindDream, wantID: "23:00-01:00"},
		{name: "overnight end exclusive", now: time.Date(2026, 8, 24, 1, 0, 0, 0, shanghai), wantKind: dispatchKindHeartbeat},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := decideDream(job, test.now.UTC(), time.Time{}, time.Time{}, false)
			if got.Kind != test.wantKind || got.WindowID != test.wantID {
				t.Fatalf("got kind=%s window=%s want kind=%s window=%s", got.Kind, got.WindowID, test.wantKind, test.wantID)
			}
			if test.wantKind == dispatchKindDream && got.Text != "dream text" {
				t.Fatalf("dream text=%q", got.Text)
			}
		})
	}
}

func TestDecideDreamFirstMatchingWindowWinsAndDefaultText(t *testing.T) {
	job := config.HeartbeatJobConfig{
		Text:     "heartbeat text",
		Timezone: "UTC",
		Dream: &config.HeartbeatDreamConfig{
			Enabled: true,
			FixedWindows: []config.HeartbeatDreamWindow{
				{Start: "10:00", End: "12:00"},
				{Start: "11:00", End: "13:00"},
			},
		},
	}
	now := time.Date(2026, 8, 24, 11, 30, 0, 0, time.UTC)
	got := decideDream(job, now, time.Time{}, time.Time{}, false)
	if got.Kind != dispatchKindDream || got.WindowID != "10:00-12:00" || got.Text != defaultDreamInstruction {
		t.Fatalf("first-match/default text: %#v", got)
	}
}

func TestDecideDreamIdleAfter(t *testing.T) {
	job := config.HeartbeatJobConfig{
		Text:     "heartbeat text",
		Timezone: "UTC",
		Dream: &config.HeartbeatDreamConfig{
			Enabled:    true,
			IdleAfter:  "1h",
			MaxRuntime: "30m",
		},
	}
	now := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)
	got := decideDream(job, now, time.Time{}, time.Time{}, false)
	if got.Kind != dispatchKindHeartbeat {
		t.Fatalf("no activity should not idle-dream: %#v", got)
	}

	lastInbound := now.Add(-30 * time.Minute)
	got = decideDream(job, now, lastInbound, time.Time{}, false)
	if got.Kind != dispatchKindHeartbeat {
		t.Fatalf("idleAfter not elapsed: %#v", got)
	}

	lastInbound = now.Add(-time.Hour)
	got = decideDream(job, now, lastInbound, time.Time{}, false)
	if got.Kind != dispatchKindDream || got.WindowID != dreamWindowIdleAfter || got.Timeout != 30*time.Minute {
		t.Fatalf("idleAfter elapsed: %#v", got)
	}

	got = decideDream(job, now, lastInbound, time.Time{}, true)
	if got.Kind != dispatchKindHeartbeat {
		t.Fatalf("busy skip idleAfter: %#v", got)
	}

	got = decideDream(job, now, time.Time{}, now.Add(-2*time.Hour), false)
	if got.Kind != dispatchKindDream || got.WindowID != dreamWindowIdleAfter {
		t.Fatalf("idleAfter from last dispatch: %#v", got)
	}
}

func TestClockInWindowEqualBoundsNeverMatch(t *testing.T) {
	now := time.Date(2026, 8, 24, 10, 0, 0, 0, time.UTC)
	if clockInWindow(now, 10, 0, 0, 10, 0, 0) {
		t.Fatal("equal start/end should not match")
	}
}
