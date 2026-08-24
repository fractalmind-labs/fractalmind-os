package agent

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fractalmind-ai/fractalbot/internal/agentruntime"
	"github.com/fractalmind-ai/fractalbot/internal/config"
)

func TestDispatchRuntimeSupportsOhMyCode(t *testing.T) {
	workspace := t.TempDir()
	script := filepath.Join(workspace, "agent_manager.py")
	scriptBody := `import sys
prompt = sys.stdin.read()
if "# FractalBot Heartbeat" not in prompt or "job_id: job-1" not in prompt:
    raise SystemExit("missing heartbeat context")
print("assigned")
`
	if err := os.WriteFile(script, []byte(scriptBody), 0700); err != nil {
		t.Fatalf("write agent manager: %v", err)
	}
	manager := NewManager(&config.AgentsConfig{OhMyCode: &config.OhMyCodeConfig{
		Enabled:            true,
		Workspace:          workspace,
		AgentManagerScript: script,
		DefaultAgent:       "main",
		AllowedAgents:      []string{"main"},
	}})
	result := manager.DispatchRuntime(context.Background(), runtimeTestRequest(agentruntime.OhMyCode, "run-1"))
	if result.Status != "assigned" || result.Error != "" || result.Agent != "main" {
		t.Fatalf("unexpected ohMyCode result: %#v", result)
	}
}

func writeOhMyCodeLifecycleScript(t *testing.T, workspace string) string {
	t.Helper()
	script := filepath.Join(workspace, "agent_manager.py")
	scriptBody := `import pathlib, sys
log = pathlib.Path("commands.log")
with log.open("a", encoding="utf-8") as handle:
    handle.write(" ".join(sys.argv[1:]) + "\n")
args = sys.argv[1:]
state = pathlib.Path("running.flag")
fail = pathlib.Path("fail_start.flag")
if args and args[0] == "status":
    print("   Running: yes" if state.exists() else "   Running: no")
    raise SystemExit(0)
if args and args[0] == "start":
    if fail.exists():
        raise SystemExit("start failed")
    state.write_text("1", encoding="utf-8")
    print("started")
    raise SystemExit(0)
prompt = sys.stdin.read()
if "# FractalBot Heartbeat" not in prompt or "job_id: job-1" not in prompt:
    raise SystemExit("missing heartbeat context")
print("assigned")
`
	if err := os.WriteFile(script, []byte(scriptBody), 0700); err != nil {
		t.Fatalf("write lifecycle agent manager: %v", err)
	}
	return script
}

func newOhMyCodeTestManager(workspace, script string) *Manager {
	return NewManager(&config.AgentsConfig{OhMyCode: &config.OhMyCodeConfig{
		Enabled:            true,
		Workspace:          workspace,
		AgentManagerScript: script,
		DefaultAgent:       "main",
		AllowedAgents:      []string{"main"},
	}})
}

func TestDispatchRuntimeStartIfMissingStartsStoppedOhMyCodeAgent(t *testing.T) {
	workspace := t.TempDir()
	script := writeOhMyCodeLifecycleScript(t, workspace)
	manager := newOhMyCodeTestManager(workspace, script)
	request := runtimeTestRequest(agentruntime.OhMyCode, "run-1")
	request.StartIfMissing = true
	result := manager.DispatchRuntime(context.Background(), request)
	if result.Status != "assigned" || result.Error != "" {
		t.Fatalf("unexpected result: %#v", result)
	}
	got := strings.TrimSpace(string(mustReadFile(t, filepath.Join(workspace, "commands.log"))))
	if !strings.Contains(got, "status main") || !strings.Contains(got, "start main") || !strings.Contains(got, "assign main") {
		t.Fatalf("expected status/start/assign, got %q", got)
	}
}

func TestDispatchRuntimeStartIfMissingSkipsStartWhenAlreadyRunning(t *testing.T) {
	workspace := t.TempDir()
	script := writeOhMyCodeLifecycleScript(t, workspace)
	if err := os.WriteFile(filepath.Join(workspace, "running.flag"), []byte("1"), 0644); err != nil {
		t.Fatal(err)
	}
	manager := newOhMyCodeTestManager(workspace, script)
	request := runtimeTestRequest(agentruntime.OhMyCode, "run-1")
	request.StartIfMissing = true
	result := manager.DispatchRuntime(context.Background(), request)
	if result.Status != "assigned" || result.Error != "" {
		t.Fatalf("unexpected result: %#v", result)
	}
	got := strings.TrimSpace(string(mustReadFile(t, filepath.Join(workspace, "commands.log"))))
	if strings.Contains(got, "start main") {
		t.Fatalf("started a running agent: %q", got)
	}
	if !strings.Contains(got, "status main") || !strings.Contains(got, "assign main") {
		t.Fatalf("expected status then assign, got %q", got)
	}
}

func TestDispatchRuntimeStartIfMissingCooldownAfterFailedStart(t *testing.T) {
	workspace := t.TempDir()
	script := writeOhMyCodeLifecycleScript(t, workspace)
	if err := os.WriteFile(filepath.Join(workspace, "fail_start.flag"), []byte("1"), 0644); err != nil {
		t.Fatal(err)
	}
	manager := newOhMyCodeTestManager(workspace, script)
	request := runtimeTestRequest(agentruntime.OhMyCode, "run-1")
	request.StartIfMissing = true
	first := manager.DispatchRuntime(context.Background(), request)
	if first.Status != "error" || !strings.Contains(first.Error, "start_if_missing") {
		t.Fatalf("unexpected first result: %#v", first)
	}
	second := manager.DispatchRuntime(context.Background(), request)
	if second.Status != "error" || !strings.Contains(second.Error, "cooldown") {
		t.Fatalf("unexpected second result: %#v", second)
	}
	got := strings.TrimSpace(string(mustReadFile(t, filepath.Join(workspace, "commands.log"))))
	if strings.Count(got, "start main") != 1 {
		t.Fatalf("cooldown should prevent a second start, got %q", got)
	}
}

func TestOhMyCodeStatusRunning(t *testing.T) {
	if !ohMyCodeStatusRunning("📌 Status: main\n   Running: yes\n") {
		t.Fatal("expected running yes")
	}
	if ohMyCodeStatusRunning("   Running: no\n") {
		t.Fatal("did not expect running no")
	}
}

func mustReadFile(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return data
}

func TestDispatchRuntimeCoalescesCodexAppHeartbeatInbox(t *testing.T) {
	inbox := filepath.Join(t.TempDir(), "codex-inbox")
	manager := NewManager(&config.AgentsConfig{CodexAppCDP: &config.CodexAppCDPConfig{
		Enabled:       true,
		InboxPath:     inbox,
		DefaultAgent:  "main",
		AllowedAgents: []string{"main"},
	}})

	first := manager.DispatchRuntime(context.Background(), runtimeTestRequest(agentruntime.CodexAppCDP, "run-1"))
	secondRequest := runtimeTestRequest(agentruntime.CodexAppCDP, "run-2")
	secondRequest.Text = "newest instruction"
	second := manager.DispatchRuntime(context.Background(), secondRequest)
	if first.Status != "queued" || second.Status != "queued" || first.InboxPath != second.InboxPath {
		t.Fatalf("heartbeat deliveries were not coalesced: first=%#v second=%#v", first, second)
	}
	entries, err := os.ReadDir(inbox)
	if err != nil {
		t.Fatalf("read inbox: %v", err)
	}
	if len(entries) != 1 || !strings.HasPrefix(entries[0].Name(), "heartbeat-") {
		t.Fatalf("expected one stable heartbeat file, got %#v", entries)
	}
	data, err := os.ReadFile(second.InboxPath)
	if err != nil {
		t.Fatalf("read heartbeat envelope: %v", err)
	}
	var envelope CodexAppEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		t.Fatalf("decode heartbeat envelope: %v", err)
	}
	assertRuntimeEnvelope(t, envelope, "run-2", "newest instruction")
}

func TestDispatchRuntimeCoalescesClaudeDesktopHeartbeatInbox(t *testing.T) {
	inbox := filepath.Join(t.TempDir(), "claude-inbox")
	manager := NewManager(&config.AgentsConfig{ClaudeDesktop: &config.ClaudeDesktopConfig{
		Enabled:       true,
		InboxPath:     inbox,
		DefaultAgent:  "main",
		AllowedAgents: []string{"main"},
	}})

	first := manager.DispatchRuntime(context.Background(), runtimeTestRequest(agentruntime.ClaudeDesktop, "run-1"))
	secondRequest := runtimeTestRequest(agentruntime.ClaudeDesktop, "run-2")
	secondRequest.Text = "newest instruction"
	second := manager.DispatchRuntime(context.Background(), secondRequest)
	if first.Status != "queued" || second.Status != "queued" || first.InboxPath != second.InboxPath {
		t.Fatalf("heartbeat deliveries were not coalesced: first=%#v second=%#v", first, second)
	}
	entries, err := os.ReadDir(inbox)
	if err != nil {
		t.Fatalf("read inbox: %v", err)
	}
	if len(entries) != 1 || !strings.HasPrefix(entries[0].Name(), "heartbeat-") {
		t.Fatalf("expected one stable heartbeat file, got %#v", entries)
	}
	data, err := os.ReadFile(second.InboxPath)
	if err != nil {
		t.Fatalf("read heartbeat envelope: %v", err)
	}
	var queued claudeDesktopInboxEnvelope
	if err := json.Unmarshal(data, &queued); err != nil {
		t.Fatalf("decode heartbeat envelope: %v", err)
	}
	assertRuntimeEnvelope(t, queued.Envelope, "run-2", "newest instruction")
	if !strings.Contains(queued.Prompt, "This is an autonomous wakeup, not a chat message") {
		t.Fatalf("heartbeat prompt missing autonomous context: %q", queued.Prompt)
	}
	if strings.Contains(queued.Prompt, "channel:") || strings.Contains(queued.Prompt, "chat_id:") {
		t.Fatalf("heartbeat prompt contains synthetic channel identity: %q", queued.Prompt)
	}
}

func TestDispatchRuntimeRejectsInvalidTargetAndText(t *testing.T) {
	manager := NewManager(&config.AgentsConfig{})
	request := runtimeTestRequest("unknown", "run-1")
	result := manager.DispatchRuntime(context.Background(), request)
	if result.Status != "error" || !strings.Contains(result.Error, "unsupported Agent Runtime") {
		t.Fatalf("unexpected unsupported runtime result: %#v", result)
	}
	request.Text = " "
	result = manager.DispatchRuntime(context.Background(), request)
	if result.Status != "error" || !strings.Contains(result.Error, "text is required") {
		t.Fatalf("unexpected empty text result: %#v", result)
	}
}

func TestBuildRuntimePromptOnlyOffersConfiguredProfiles(t *testing.T) {
	request := runtimeTestRequest(agentruntime.CodexAppCDP, "run-1")
	request.CronProfiles = []string{"deep-idle", "idle"}
	prompt := buildRuntimePrompt(request)
	for _, expected := range []string{
		"fractalbot heartbeat cron set --job job-1 --profile <profile>",
		"Allowed profiles: deep-idle, idle",
		"If and only if there is no actionable work",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("prompt missing %q: %s", expected, prompt)
		}
	}
	if strings.Contains(prompt, "channel:") || strings.Contains(prompt, "chat_id:") {
		t.Fatalf("runtime prompt contains channel identity: %s", prompt)
	}
}

func runtimeTestRequest(runtimeName, runID string) agentruntime.DispatchRequest {
	scheduledAt := time.Date(2026, 7, 26, 2, 0, 0, 0, time.UTC)
	return agentruntime.DispatchRequest{
		Runtime:      runtimeName,
		Agent:        "main",
		Text:         "inspect actionable work",
		Source:       "heartbeat",
		JobID:        "job-1",
		RunID:        runID,
		ScheduledAt:  scheduledAt,
		ExpiresAt:    scheduledAt.Add(10 * time.Minute),
		CoalesceKey:  "heartbeat:job-1",
		CronProfiles: []string{"idle"},
	}
}

func assertRuntimeEnvelope(t *testing.T, envelope InboundAppEnvelope, runID, text string) {
	t.Helper()
	if envelope.Source != "heartbeat" || envelope.JobID != "job-1" || envelope.RunID != runID || envelope.CoalesceKey != "heartbeat:job-1" {
		t.Fatalf("unexpected heartbeat metadata: %#v", envelope)
	}
	if envelope.SelectedAgent != "main" || envelope.Text != text || envelope.ScheduledAt == "" || envelope.ExpiresAt == "" {
		t.Fatalf("unexpected heartbeat envelope: %#v", envelope)
	}
	if envelope.Channel != "" || envelope.ChatID != "" || envelope.UserID != "" || envelope.Username != "" {
		t.Fatalf("heartbeat envelope contains synthetic channel identity: %#v", envelope)
	}
}
