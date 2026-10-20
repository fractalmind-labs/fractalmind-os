package heartbeat

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/agentruntime"
)

type testClock struct {
	mu  sync.RWMutex
	now time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.now
}

func (c *testClock) Set(value time.Time) {
	c.mu.Lock()
	c.now = value
	c.mu.Unlock()
}

type recordingDispatcher struct {
	mu       sync.Mutex
	requests []agentruntime.DispatchRequest
	result   agentruntime.DispatchResult
	block    <-chan struct{}
	started  chan struct{}
}

func (d *recordingDispatcher) DispatchRuntime(ctx context.Context, request agentruntime.DispatchRequest) agentruntime.DispatchResult {
	d.mu.Lock()
	d.requests = append(d.requests, request)
	d.mu.Unlock()
	if d.started != nil {
		select {
		case d.started <- struct{}{}:
		default:
		}
	}
	if d.block != nil {
		select {
		case <-d.block:
		case <-ctx.Done():
			return agentruntime.DispatchResult{Status: "error", Error: ctx.Err().Error()}
		}
	}
	return d.result
}

func (d *recordingDispatcher) Requests() []agentruntime.DispatchRequest {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]agentruntime.DispatchRequest(nil), d.requests...)
}

// newTestScheduler keeps state in dir unless the config names a path.
func newTestScheduler(cfg *Config, dir string, dispatcher agentruntime.Dispatcher, now func() time.Time, tick time.Duration) (*Scheduler, error) {
	if cfg != nil && cfg.StatePath == "" && dir != "" {
		cfg.StatePath = filepath.Join(dir, "heartbeat-state.json")
	}
	return newScheduler(cfg, dispatcher, now, tick)
}

func heartbeatTestConfig(statePath string) *Config {
	return &Config{
		Enabled:       true,
		StatePath:     statePath,
		MaxConcurrent: 2,
		Jobs: []JobConfig{{
			ID:       "cloudbank-main",
			Runtime:  "codexApp",
			Agent:    "main",
			Text:     "secret operator instruction",
			Cron:     "*/10 * * * *",
			Timezone: "Asia/Shanghai",
			AgentCronProfiles: map[string]string{
				"idle": "0 * * * *",
			},
			ResetCronOnInbound: true,
		}},
	}
}

func TestSchedulerCalculatesTimezoneAndDispatchesRuntimeEnvelope(t *testing.T) {
	base := time.Date(2026, 7, 26, 1, 55, 0, 0, time.UTC)
	clock := &testClock{now: base}
	dispatcher := &recordingDispatcher{result: agentruntime.DispatchResult{
		Status:     "queued",
		EnvelopeID: "env-1",
		InboxPath:  "/tmp/inbox/heartbeat.json",
	}}
	scheduler, err := newTestScheduler(heartbeatTestConfig(""), t.TempDir(), dispatcher, clock.Now, time.Hour)
	if err != nil {
		t.Fatalf("newScheduler: %v", err)
	}

	status := scheduler.Status()
	if len(status.Jobs) != 1 || status.Jobs[0].NextRunAt != "2026-07-26T02:00:00Z" {
		t.Fatalf("unexpected next run for Asia/Shanghai cron: %#v", status)
	}

	due := time.Date(2026, 7, 26, 2, 0, 0, 0, time.UTC)
	clock.Set(due)
	scheduler.runDue(due)
	waitForScheduler(t, scheduler, func(job JobStatus) bool { return job.LastDispatchStatus == "queued" })

	requests := dispatcher.Requests()
	if len(requests) != 1 {
		t.Fatalf("dispatch count=%d want 1", len(requests))
	}
	request := requests[0]
	if request.Runtime != "codexApp" || request.Agent != "main" || request.Source != "heartbeat" {
		t.Fatalf("unexpected runtime request: %#v", request)
	}
	if request.JobID != "cloudbank-main" || request.RunID == "" || request.CoalesceKey != "heartbeat:cloudbank-main" {
		t.Fatalf("missing heartbeat envelope metadata: %#v", request)
	}
	if !request.ScheduledAt.Equal(due) || !request.ExpiresAt.Equal(due.Add(10*time.Minute)) {
		t.Fatalf("unexpected schedule window: scheduled=%s expires=%s", request.ScheduledAt, request.ExpiresAt)
	}
	if len(request.CronProfiles) != 1 || request.CronProfiles[0] != "idle" {
		t.Fatalf("cron profiles=%v", request.CronProfiles)
	}
	if request.StartIfMissing {
		t.Fatalf("default job should not set start_if_missing: %#v", request)
	}
}

func TestSchedulerRecordsAgentReportedOutcomes(t *testing.T) {
	base := time.Date(2026, 7, 26, 1, 55, 0, 0, time.UTC)
	clock := &testClock{now: base}
	dispatcher := &recordingDispatcher{result: agentruntime.DispatchResult{Status: "queued"}}
	stateDir := t.TempDir()
	cfg := heartbeatTestConfig("")
	scheduler, err := newTestScheduler(cfg, stateDir, dispatcher, clock.Now, time.Hour)
	if err != nil {
		t.Fatalf("newScheduler: %v", err)
	}
	run := func(at time.Time) string {
		clock.Set(at)
		scheduler.runDue(at)
		waitForScheduler(t, scheduler, func(job JobStatus) bool { return !job.InFlight && job.DeliveredRuns > 0 })
		requests := dispatcher.Requests()
		return requests[len(requests)-1].RunID
	}

	first := run(time.Date(2026, 7, 26, 2, 0, 0, 0, time.UTC))
	status, err := scheduler.RecordOutcome("cloudbank-main", first, OutcomeActed, "  merged   the fix\n")
	if err != nil {
		t.Fatalf("RecordOutcome: %v", err)
	}
	if status.LastOutcome != OutcomeActed || status.LastOutcomeSummary != "merged the fix" || status.OutcomeCounts[OutcomeActed] != 1 || status.UnreportedRuns != 0 {
		t.Fatalf("unexpected status after first outcome: %#v", status)
	}
	// Reporting the same run again replaces its outcome instead of counting twice.
	status, err = scheduler.RecordOutcome("cloudbank-main", first, OutcomeNotified, "told Owen")
	if err != nil {
		t.Fatalf("RecordOutcome again: %v", err)
	}
	if status.OutcomeCounts[OutcomeActed] != 0 || status.OutcomeCounts[OutcomeNotified] != 1 {
		t.Fatalf("re-report counted twice: %#v", status.OutcomeCounts)
	}

	second := run(time.Date(2026, 7, 26, 2, 10, 0, 0, time.UTC))
	// Only the latest run can report; an unknown result is rejected.
	if _, err := scheduler.RecordOutcome("cloudbank-main", first, OutcomeNoop, ""); err == nil || !strings.Contains(err.Error(), "not the latest run") {
		t.Fatalf("expected a stale-run error, got %v", err)
	}
	if _, err := scheduler.RecordOutcome("cloudbank-main", second, "done", ""); err == nil || !strings.Contains(err.Error(), "not one of") {
		t.Fatalf("expected an invalid-outcome error, got %v", err)
	}
	if _, err := scheduler.RecordOutcome("missing", second, OutcomeNoop, ""); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("expected a missing-job error, got %v", err)
	}
	status = scheduler.Status().Jobs[0]
	if status.DeliveredRuns != 2 || status.UnreportedRuns != 1 {
		t.Fatalf("expected one unreported run of two: %#v", status)
	}
	if _, err := scheduler.RecordOutcome("cloudbank-main", second, OutcomeNoop, strings.Repeat("x", 600)); err != nil {
		t.Fatalf("RecordOutcome second: %v", err)
	}

	// The record survives a restart.
	restarted, err := newTestScheduler(cfg, stateDir, dispatcher, clock.Now, time.Hour)
	if err != nil {
		t.Fatalf("restart: %v", err)
	}
	status = restarted.Status().Jobs[0]
	if status.DeliveredRuns != 2 || status.UnreportedRuns != 0 || status.OutcomeCounts[OutcomeNoop] != 1 || status.OutcomeCounts[OutcomeNotified] != 1 || len([]rune(status.LastOutcomeSummary)) != maxOutcomeSummaryRunes {
		t.Fatalf("outcomes not restored: %#v", status)
	}
}

func TestSchedulerPassesStartIfMissingToDispatchRequest(t *testing.T) {
	base := time.Date(2026, 7, 26, 1, 55, 0, 0, time.UTC)
	clock := &testClock{now: base}
	dispatcher := &recordingDispatcher{result: agentruntime.DispatchResult{Status: "assigned"}}
	cfg := heartbeatTestConfig("")
	cfg.Jobs[0].Runtime = "agentManager"
	cfg.Jobs[0].StartIfMissing = true
	scheduler, err := newTestScheduler(cfg, t.TempDir(), dispatcher, clock.Now, time.Hour)
	if err != nil {
		t.Fatalf("newScheduler: %v", err)
	}
	due := time.Date(2026, 7, 26, 2, 0, 0, 0, time.UTC)
	clock.Set(due)
	scheduler.runDue(due)
	waitForScheduler(t, scheduler, func(job JobStatus) bool { return job.LastDispatchStatus == "assigned" })
	requests := dispatcher.Requests()
	if len(requests) != 1 || !requests[0].StartIfMissing {
		t.Fatalf("expected start_if_missing dispatch, got %#v", requests)
	}
	status := scheduler.Status()
	if len(status.Jobs) != 1 || !status.Jobs[0].StartIfMissing {
		t.Fatalf("status missing start_if_missing: %#v", status)
	}
}

func TestSchedulerPassesPromptFileToDispatchRequest(t *testing.T) {
	base := time.Date(2026, 7, 26, 1, 55, 0, 0, time.UTC)
	clock := &testClock{now: base}
	dispatcher := &recordingDispatcher{result: agentruntime.DispatchResult{Status: "queued"}}
	cfg := heartbeatTestConfig("")
	cfg.Jobs[0].Text = ""
	cfg.Jobs[0].PromptFile = "/work/tasks/radar.md"
	scheduler, err := newTestScheduler(cfg, t.TempDir(), dispatcher, clock.Now, time.Hour)
	if err != nil {
		t.Fatalf("newScheduler: %v", err)
	}
	due := time.Date(2026, 7, 26, 2, 0, 0, 0, time.UTC)
	clock.Set(due)
	scheduler.runDue(due)
	waitForScheduler(t, scheduler, func(job JobStatus) bool { return job.LastDispatchStatus == "queued" })
	if requests := dispatcher.Requests(); len(requests) != 1 || requests[0].PromptFile != "/work/tasks/radar.md" {
		t.Fatalf("expected the prompt file, got %#v", requests)
	}
}

func TestSchedulerPassesCompletionAwareDispatchSettings(t *testing.T) {
	base := time.Date(2026, 7, 26, 1, 55, 0, 0, time.UTC)
	clock := &testClock{now: base}
	dispatcher := &recordingDispatcher{result: agentruntime.DispatchResult{Status: "heartbeat_terminal"}}
	cfg := heartbeatTestConfig("")
	cfg.Jobs[0].Runtime = "agentManager"
	cfg.Jobs[0].DispatchMode = agentruntime.DispatchModeHeartbeatRun
	cfg.Jobs[0].TimeoutSeconds = 480
	cfg.Jobs[0].Text = ""
	scheduler, err := newTestScheduler(cfg, t.TempDir(), dispatcher, clock.Now, time.Hour)
	if err != nil {
		t.Fatalf("newScheduler: %v", err)
	}

	status := scheduler.Status().Jobs[0]
	if status.DispatchMode != agentruntime.DispatchModeHeartbeatRun || status.TimeoutSeconds != 480 {
		t.Fatalf("missing completion-aware status: %#v", status)
	}

	due := time.Date(2026, 7, 26, 2, 0, 0, 0, time.UTC)
	clock.Set(due)
	scheduler.runDue(due)
	waitForScheduler(t, scheduler, func(job JobStatus) bool { return job.LastDispatchStatus == "heartbeat_terminal" })

	requests := dispatcher.Requests()
	if len(requests) != 1 || requests[0].DispatchMode != agentruntime.DispatchModeHeartbeatRun || requests[0].Timeout != 8*time.Minute {
		t.Fatalf("unexpected dispatch settings: %#v", requests)
	}
}

func TestSchedulerProfileIsIdempotentPersistsAndSkipsMissedRuns(t *testing.T) {
	statePath := t.TempDir() + "/heartbeat-state.json"
	base := time.Date(2026, 7, 26, 0, 5, 0, 0, time.UTC)
	clock := &testClock{now: base}
	cfg := heartbeatTestConfig(statePath)
	scheduler, err := newTestScheduler(cfg, "", &recordingDispatcher{}, clock.Now, time.Hour)
	if err != nil {
		t.Fatalf("newScheduler: %v", err)
	}

	first, err := scheduler.SetProfile("cloudbank-main", "idle", "no actionable tasks", "agent")
	if err != nil {
		t.Fatalf("SetProfile: %v", err)
	}
	if first.EffectiveCron != "0 * * * *" || first.NextRunAt != "2026-07-26T01:00:00Z" {
		t.Fatalf("unexpected profile status: %#v", first)
	}

	clock.Set(base.Add(20 * time.Minute))
	second, err := scheduler.SetProfile("cloudbank-main", "idle", "still idle", "agent")
	if err != nil {
		t.Fatalf("idempotent SetProfile: %v", err)
	}
	if second.NextRunAt != first.NextRunAt || second.LastScheduleReason != first.LastScheduleReason || second.LastScheduleUpdatedAt != first.LastScheduleUpdatedAt {
		t.Fatalf("repeated profile update was not a no-op: first=%#v second=%#v", first, second)
	}

	restartTime := time.Date(2026, 7, 26, 4, 12, 0, 0, time.UTC)
	clock.Set(restartTime)
	restarted, err := newTestScheduler(cfg, "", &recordingDispatcher{}, clock.Now, time.Hour)
	if err != nil {
		t.Fatalf("restart scheduler: %v", err)
	}
	restartedJob := restarted.Status().Jobs[0]
	if restartedJob.EffectiveProfile != "idle" {
		t.Fatalf("effective profile not restored: %#v", restartedJob)
	}
	if restartedJob.NextRunAt != "2026-07-26T05:00:00Z" {
		t.Fatalf("restart should calculate next future run, got %s", restartedJob.NextRunAt)
	}

	if _, err := restarted.SetProfile("cloudbank-main", "arbitrary", "idle", "agent"); err == nil || !strings.Contains(err.Error(), "not allowed") {
		t.Fatalf("expected profile allowlist error, got %v", err)
	}
}

func TestSchedulerInboundResetOnlyAffectsTheAgent(t *testing.T) {
	clock := &testClock{now: time.Date(2026, 7, 26, 0, 5, 0, 0, time.UTC)}
	scheduler, err := newTestScheduler(heartbeatTestConfig(""), t.TempDir(), &recordingDispatcher{}, clock.Now, time.Hour)
	if err != nil {
		t.Fatalf("newScheduler: %v", err)
	}
	if _, err := scheduler.SetProfile("cloudbank-main", "idle", "no actionable tasks", "agent"); err != nil {
		t.Fatalf("SetProfile: %v", err)
	}

	scheduler.ResetForInbound("other")
	if got := scheduler.Status().Jobs[0].EffectiveProfile; got != "idle" {
		t.Fatalf("another agent's message reset profile=%q", got)
	}

	clock.Set(time.Date(2026, 7, 26, 0, 7, 0, 0, time.UTC))
	scheduler.ResetForInbound("main")
	job := scheduler.Status().Jobs[0]
	if job.EffectiveProfile != "" || job.EffectiveCron != "*/10 * * * *" || job.NextRunAt != "2026-07-26T00:10:00Z" {
		t.Fatalf("matching inbound did not restore default cron: %#v", job)
	}
	if job.LastScheduleReason != "normal inbound activity" || job.LastScheduleUpdatedBy != "gateway" {
		t.Fatalf("missing inbound reset audit: %#v", job)
	}
}

func TestSchedulerSkipsOverlappingRun(t *testing.T) {
	base := time.Date(2026, 7, 26, 0, 0, 0, 0, time.UTC)
	clock := &testClock{now: base}
	release := make(chan struct{})
	started := make(chan struct{}, 1)
	dispatcher := &recordingDispatcher{
		result:  agentruntime.DispatchResult{Status: "delivered"},
		block:   release,
		started: started,
	}
	cfg := heartbeatTestConfig("")
	cfg.Jobs[0].Cron = "* * * * *"
	scheduler, err := newTestScheduler(cfg, t.TempDir(), dispatcher, clock.Now, time.Hour)
	if err != nil {
		t.Fatalf("newScheduler: %v", err)
	}
	firstDue := base.Add(time.Minute)
	clock.Set(firstDue)
	scheduler.runDue(firstDue)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("first dispatch did not start")
	}
	secondDue := base.Add(2 * time.Minute)
	clock.Set(secondDue)
	scheduler.runDue(secondDue)
	job := scheduler.Status().Jobs[0]
	if job.LastDispatchStatus != "skipped_overlap" || !job.InFlight {
		t.Fatalf("expected overlap skip while in flight: %#v", job)
	}
	if len(dispatcher.Requests()) != 1 {
		t.Fatalf("overlapping run dispatched more than once")
	}

	close(release)
	waitForScheduler(t, scheduler, func(job JobStatus) bool { return !job.InFlight })
}

func TestSchedulerEnforcesGlobalCapacityAndRecordsFailure(t *testing.T) {
	base := time.Date(2026, 7, 26, 0, 0, 0, 0, time.UTC)
	clock := &testClock{now: base}
	release := make(chan struct{})
	started := make(chan struct{}, 1)
	dispatcher := &recordingDispatcher{
		result:  agentruntime.DispatchResult{Status: "error", Error: "runtime unavailable"},
		block:   release,
		started: started,
	}
	cfg := heartbeatTestConfig("")
	cfg.MaxConcurrent = 1
	cfg.Jobs[0].Cron = "* * * * *"
	second := cfg.Jobs[0]
	second.ID = "cloudbank-secondary"
	cfg.Jobs = append(cfg.Jobs, second)
	scheduler, err := newTestScheduler(cfg, t.TempDir(), dispatcher, clock.Now, time.Hour)
	if err != nil {
		t.Fatalf("newScheduler: %v", err)
	}
	scheduler.retryDelay = func(int) time.Duration { return 0 }

	due := base.Add(time.Minute)
	clock.Set(due)
	scheduler.runDue(due)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("capacity-limited dispatch did not start")
	}
	statuses := scheduler.Status().Jobs
	skipped := 0
	for _, status := range statuses {
		if status.LastDispatchStatus == "skipped_capacity" {
			skipped++
		}
	}
	if skipped != 1 || len(dispatcher.Requests()) != 1 {
		t.Fatalf("capacity result statuses=%#v requests=%d", statuses, len(dispatcher.Requests()))
	}

	close(release)
	waitForScheduler(t, scheduler, func(_ JobStatus) bool {
		for _, status := range scheduler.Status().Jobs {
			if status.LastDispatchStatus == "error" && status.LastDispatchError == "runtime unavailable" {
				return true
			}
		}
		return false
	})
	if got := len(dispatcher.Requests()); got != maxDispatchAttempts {
		t.Fatalf("dispatch attempts=%d want %d", got, maxDispatchAttempts)
	}
}

func TestSchedulerDoesNotRetryTerminalHeartbeatFailure(t *testing.T) {
	base := time.Date(2026, 7, 26, 0, 0, 0, 0, time.UTC)
	clock := &testClock{now: base}
	dispatcher := &recordingDispatcher{result: agentruntime.DispatchResult{
		Status: "heartbeat_failed",
		Error:  "agent-manager heartbeat failed",
	}}
	cfg := heartbeatTestConfig("")
	cfg.Jobs[0].Cron = "* * * * *"
	scheduler, err := newTestScheduler(cfg, t.TempDir(), dispatcher, clock.Now, time.Hour)
	if err != nil {
		t.Fatalf("newScheduler: %v", err)
	}
	scheduler.retryDelay = func(int) time.Duration { return 0 }

	due := base.Add(time.Minute)
	clock.Set(due)
	scheduler.runDue(due)
	waitForScheduler(t, scheduler, func(job JobStatus) bool { return job.LastDispatchStatus == "heartbeat_failed" })

	if got := len(dispatcher.Requests()); got != 1 {
		t.Fatalf("terminal heartbeat failure attempts=%d want 1", got)
	}
}

func TestSchedulerStatusDoesNotExposeInstruction(t *testing.T) {
	clock := &testClock{now: time.Date(2026, 7, 26, 0, 0, 0, 0, time.UTC)}
	scheduler, err := newTestScheduler(heartbeatTestConfig(""), t.TempDir(), &recordingDispatcher{}, clock.Now, time.Hour)
	if err != nil {
		t.Fatalf("newScheduler: %v", err)
	}
	encoded, err := json.Marshal(scheduler.Status())
	if err != nil {
		t.Fatalf("marshal status: %v", err)
	}
	if strings.Contains(string(encoded), "secret operator instruction") || strings.Contains(string(encoded), `"text"`) {
		t.Fatalf("status leaked instruction: %s", encoded)
	}
}

func TestSchedulerStopCancelsRetryBackoff(t *testing.T) {
	base := time.Date(2026, 7, 26, 0, 0, 0, 0, time.UTC)
	clock := &testClock{now: base}
	started := make(chan struct{}, 1)
	dispatcher := &recordingDispatcher{
		result:  agentruntime.DispatchResult{Status: "error", Error: "runtime unavailable"},
		started: started,
	}
	cfg := heartbeatTestConfig("")
	cfg.Jobs[0].Cron = "* * * * *"
	scheduler, err := newTestScheduler(cfg, t.TempDir(), dispatcher, clock.Now, time.Hour)
	if err != nil {
		t.Fatalf("newScheduler: %v", err)
	}
	if err := scheduler.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	due := base.Add(time.Minute)
	clock.Set(due)
	scheduler.runDue(due)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("dispatch did not enter retry path")
	}

	stopCtx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	if err := scheduler.Stop(stopCtx); err != nil {
		t.Fatalf("Stop did not cancel retry backoff: %v", err)
	}
	job := scheduler.Status().Jobs[0]
	if job.InFlight || job.LastDispatchStatus != "error" || job.LastDispatchError != context.Canceled.Error() {
		t.Fatalf("unexpected status after canceled retry: %#v", job)
	}
}

func waitForScheduler(t *testing.T, scheduler *Scheduler, predicate func(JobStatus) bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		status := scheduler.Status()
		if status != nil && len(status.Jobs) > 0 && predicate(status.Jobs[0]) {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("scheduler condition not reached: %#v", scheduler.Status())
}
