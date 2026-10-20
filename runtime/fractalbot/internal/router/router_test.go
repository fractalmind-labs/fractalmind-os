package router

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/agentruntime"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/internal/configv2"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/pkg/localruntime"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot/pkg/protocol"
)

type delivery struct {
	target localruntime.Target
	req    localruntime.Request
}

type fakeAdapter struct {
	name     string
	mu       sync.Mutex
	got      []delivery
	status   localruntime.Status
	presence localruntime.Presence
	started  int
}

func (f *fakeAdapter) Name() string { return f.name }
func (f *fakeAdapter) Capabilities() localruntime.Capabilities {
	return localruntime.Capabilities{Start: true}
}
func (f *fakeAdapter) Deliver(_ context.Context, t localruntime.Target, r localruntime.Request) localruntime.Result {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.got = append(f.got, delivery{t, r})
	st := f.status
	if st == "" {
		st = localruntime.Queued
	}
	return localruntime.Result{Status: st, EnvelopeID: r.Envelope.ID}
}
func (f *fakeAdapter) Presence(context.Context, localruntime.Target) localruntime.Presence {
	return f.presence
}
func (f *fakeAdapter) Start(context.Context, localruntime.Target) error { f.started++; return nil }
func (f *fakeAdapter) last(t *testing.T) delivery {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.got) == 0 {
		t.Fatal("nothing delivered")
	}
	return f.got[len(f.got)-1]
}

func setup(t *testing.T) (*Router, *fakeAdapter, *fakeAdapter) {
	t.Helper()
	home := t.TempDir()
	for _, d := range []string{"xiaoyi", "burry"} {
		os.MkdirAll(filepath.Join(home, d), 0o755)
	}
	os.WriteFile(filepath.Join(home, "burry", "radar.md"), []byte("check the radar"), 0o644)
	yaml := `version: 2
dataDir: ` + filepath.Join(home, "data") + `
channels:
  feishu:
    xiaoyi: {appId: cli_x, appSecret: secret:feishu-xiaoyi}
    burry: {appId: cli_b, appSecret: secret:feishu-burry}
  telegram:
    main:
      botToken: secret:telegram-main
      default: xiaoyi
      chats: {"-100": burry}
agents:
  xiaoyi:
    workspace: ` + filepath.Join(home, "xiaoyi") + `
    runtime: codexApp
    session: 01a15669-badd-7c31-b094-660961b49af7
    channels: [feishu.xiaoyi, telegram.main]
  burry:
    workspace: ` + filepath.Join(home, "burry") + `
    runtime: agentManager
    channels: [feishu.burry, telegram.main]
`
	p := configv2.HostPlatform()
	p.GOOS = "darwin"
	cfg, err := configv2.Parse([]byte(yaml), p)
	if err != nil {
		t.Fatal(err)
	}
	codex := &fakeAdapter{name: "codexApp"}
	am := &fakeAdapter{name: "agentManager", status: localruntime.Delivered, presence: localruntime.Offline}
	return New(cfg, map[string]localruntime.Adapter{"codexApp": codex, "agentManager": am}), codex, am
}

func msg(data map[string]interface{}) *protocol.Message { return &protocol.Message{Data: data} }

func TestDedicatedAndSharedChannelSelection(t *testing.T) {
	r, codex, am := setup(t)
	var reset []string
	r.SetInboundHook(func(a string) { reset = append(reset, a) })
	ctx := context.Background()

	// A dedicated Feishu bot reaches its agent.
	if reply, err := r.HandleIncoming(ctx, msg(map[string]interface{}{"channel": "feishu", "receiver_id": "cli_b", "chat_id": "oc1", "text": "hi", "message_id": "m1"})); err != nil || reply != "处理中…" {
		t.Fatalf("feishu.burry: %q %v", reply, err)
	}
	if d := am.last(t); d.target.Agent != "burry" || d.target.Session != "main" || !strings.Contains(d.req.Prompt, "- channel_instance: feishu.burry") {
		t.Fatalf("burry delivery: %+v", d.target)
	}
	// Redelivery of the same message is dropped.
	r.HandleIncoming(ctx, msg(map[string]interface{}{"channel": "feishu", "receiver_id": "cli_b", "chat_id": "oc1", "text": "hi", "message_id": "m1"}))
	if len(am.got) != 1 {
		t.Fatalf("duplicate delivered: %d", len(am.got))
	}

	tg := func(chat, text string, extra ...interface{}) map[string]interface{} {
		d := map[string]interface{}{"channel": "telegram", "chat_id": chat, "text": text}
		for i := 0; i+1 < len(extra); i += 2 {
			d[extra[i].(string)] = extra[i+1]
		}
		return d
	}
	// Shared Telegram: default, then pinned chat, then @mention, then /use.
	r.HandleIncoming(ctx, msg(tg("1", "default please")))
	if d := codex.last(t); d.target.Agent != "xiaoyi" || !strings.Contains(d.req.Prompt, "selected_by: default") || !strings.Contains(d.req.Prompt, "--agent xiaoyi") {
		t.Fatalf("default: %s", d.req.Prompt)
	}
	r.HandleIncoming(ctx, msg(tg("-100", "radar?")))
	if d := am.last(t); d.target.Agent != "burry" || !strings.Contains(d.req.Prompt, "selected_by: pinned") {
		t.Fatalf("pinned: %s", d.req.Prompt)
	}
	r.HandleIncoming(ctx, msg(tg("1", "@burry what about BTC")))
	if d := am.last(t); d.req.Envelope.Text != "what about BTC" || !strings.Contains(d.req.Prompt, "selected_by: mention") {
		t.Fatalf("mention: %+v", d.req.Envelope)
	}
	if reply, _ := r.HandleIncoming(ctx, msg(tg("1", "/use burry"))); !strings.Contains(reply, "now goes to burry") {
		t.Fatalf("/use: %q", reply)
	}
	r.HandleIncoming(ctx, msg(tg("1", "after use")))
	if d := am.last(t); d.req.Envelope.Text != "after use" || !strings.Contains(d.req.Prompt, "selected_by: use") {
		t.Fatalf("use: %s", d.req.Prompt)
	}
	if reply, _ := r.HandleIncoming(ctx, msg(tg("1", "/who"))); !strings.Contains(reply, "goes to burry (use)") {
		t.Fatalf("/who: %q", reply)
	}
	if reply, _ := r.HandleIncoming(ctx, msg(tg("1", "/use nobody"))); !strings.Contains(reply, "choose one of: burry, xiaoyi") {
		t.Fatalf("/use unknown: %q", reply)
	}
	// /use survives a restart.
	r2 := New(r.cfg, r.adapters)
	if got := r2.selections.get("telegram.main", "1"); got != "burry" {
		t.Fatalf("persisted selection: %q", got)
	}
	r.HandleIncoming(ctx, msg(tg("1", "/use")))
	r.HandleIncoming(ctx, msg(tg("1", "explicit", "agent", "burry", "agent_specified", true)))
	if d := am.last(t); !strings.Contains(d.req.Prompt, "selected_by: mention") {
		t.Fatalf("explicit /agent: %s", d.req.Prompt)
	}
	if len(reset) == 0 || reset[0] != "burry" {
		t.Fatalf("inbound hook: %v", reset)
	}
	if _, err := r.HandleIncoming(ctx, msg(map[string]interface{}{"channel": "slack", "text": "x"})); err == nil {
		t.Fatal("unconfigured channel accepted")
	}
}

func TestScheduleDispatch(t *testing.T) {
	r, codex, am := setup(t)
	ctx := context.Background()
	res := r.DispatchRuntime(ctx, agentruntime.DispatchRequest{Agent: "xiaoyi", Text: "read HEARTBEAT.md", Source: "heartbeat", JobID: "xiaoyi-heartbeat", RunID: "r1", CoalesceKey: "heartbeat:xiaoyi-heartbeat", CronProfiles: []string{"idle"}, ScheduledAt: time.Now()})
	if res.Status != "queued" || res.Runtime != "codexApp" {
		t.Fatalf("result: %+v", res)
	}
	d := codex.last(t)
	if !strings.Contains(d.req.Prompt, "read HEARTBEAT.md") || !strings.Contains(d.req.Prompt, "heartbeat cron reset --job xiaoyi-heartbeat") || d.req.Envelope.CoalesceKey == "" {
		t.Fatalf("prompt: %s", d.req.Prompt)
	}

	res = r.DispatchRuntime(ctx, agentruntime.DispatchRequest{Agent: "burry", PromptFile: filepath.Join(r.cfg.Agents["burry"].Workspace, "radar.md"), JobID: "radar", RunID: "r2", StartIfMissing: true})
	if res.Status != "assigned" || am.started != 1 || !strings.Contains(am.last(t).req.Prompt, "check the radar") {
		t.Fatalf("prompt file / start: %+v started=%d", res, am.started)
	}
	if res := r.DispatchRuntime(ctx, agentruntime.DispatchRequest{Agent: "nobody"}); res.Status != "error" {
		t.Fatalf("unknown agent: %+v", res)
	}
	st := r.Status(ctx)
	if len(st) != 2 || st[0].Name != "burry" || st[0].LastDelivery == nil || st[0].LastDelivery.Source != "schedule:radar" {
		t.Fatalf("status: %+v", st)
	}
}
