package channels

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fractalmind-ai/fractalbot/internal/config"
)

type fakeChannel struct {
	name     string
	started  int
	stopped  int
	running  bool
	startErr error
	stopErr  error
	lastChat string
	lastText string
}

func (f *fakeChannel) Name() string { return f.name }

func (f *fakeChannel) Start(ctx context.Context) error {
	_ = ctx
	f.started++
	if f.startErr != nil {
		return f.startErr
	}
	f.running = true
	return nil
}

func (f *fakeChannel) Stop(ctx context.Context) error {
	_ = ctx
	f.stopped++
	f.running = false
	return f.stopErr
}

func (f *fakeChannel) Send(ctx context.Context, msg OutboundMessage) (*SendResult, error) {
	_ = ctx
	f.lastChat = msg.To
	f.lastText = msg.Text
	return &SendResult{ChannelID: msg.To}, nil
}

func (f *fakeChannel) IsRunning() bool { return f.running }

func (f *fakeChannel) IsAllowed(senderID string) bool { return true }

func TestFeishuChannelAgentConfigUsesMatchedReceiverTarget(t *testing.T) {
	cfg := &config.AgentsConfig{
		Router: "ohMyCode",
		OhMyCode: &config.OhMyCodeConfig{
			Enabled:       true,
			Workspace:     "/workspace/default",
			DefaultAgent:  "legacy-main",
			AllowedAgents: []string{"legacy-main"},
			Targets: map[string]config.OhMyCodeTargetConfig{
				"support": {
					ReceiverIDs:  []string{"cli_support"},
					Workspace:    "/workspace/support",
					DefaultAgent: "support-main",
					AllowedAgents: []string{
						"support-main",
						"admin",
					},
				},
			},
		},
	}

	defaultAgent, allowedAgents, configName := feishuChannelAgentConfig(cfg, "cli_support")
	if defaultAgent != "support-main" || configName != `agents.ohMyCode.targets["support"]` {
		t.Fatalf("unexpected matched config: default=%q name=%q", defaultAgent, configName)
	}
	if len(allowedAgents) != 2 || allowedAgents[0] != "support-main" || allowedAgents[1] != "admin" {
		t.Fatalf("unexpected matched allowed agents: %#v", allowedAgents)
	}

	defaultAgent, allowedAgents, configName = feishuChannelAgentConfig(cfg, "cli_unmatched")
	if defaultAgent != "legacy-main" || configName != "agents.ohMyCode" {
		t.Fatalf("unexpected fallback config: default=%q name=%q", defaultAgent, configName)
	}
	if len(allowedAgents) != 1 || allowedAgents[0] != "legacy-main" {
		t.Fatalf("unexpected fallback allowed agents: %#v", allowedAgents)
	}
}

func TestManagerRegistersMultipleFeishuBotsWithReplyIdentityIsolation(t *testing.T) {
	manager := NewManager(&config.ChannelsConfig{Feishu: &config.FeishuConfig{
		Enabled: true,
		Bots: map[string]config.FeishuBotConfig{
			"support": {AppID: "cli_support", AppSecret: "support-secret", AllowedUsers: []string{"ou_allowed"}},
			"sales":   {AppID: "cli_sales", AppSecret: "sales-secret", AllowedUsers: []string{"ou_allowed"}},
		},
	}}, &config.AgentsConfig{Router: "ohMyCode", OhMyCode: &config.OhMyCodeConfig{
		Enabled: true,
		Targets: map[string]config.OhMyCodeTargetConfig{
			"support": {Receivers: []config.ReceiverTargetConfig{{Channel: "feishu", ReceiverID: "cli_support"}}, Workspace: "/workspace/support", DefaultAgent: "support-main", AllowedAgents: []string{"support-main"}},
			"sales":   {Receivers: []config.ReceiverTargetConfig{{Channel: "feishu", ReceiverID: "cli_sales"}}, Workspace: "/workspace/sales", DefaultAgent: "sales-main", AllowedAgents: []string{"sales-main"}},
		},
	}})

	if err := manager.registerConfiguredChannels(); err != nil {
		t.Fatalf("registerConfiguredChannels: %v", err)
	}
	support, ok := manager.Get("feishu/support").(*FeishuBot)
	if !ok {
		t.Fatalf("support bot=%T", manager.Get("feishu/support"))
	}
	sales, ok := manager.Get("feishu/sales").(*FeishuBot)
	if !ok {
		t.Fatalf("sales bot=%T", manager.Get("feishu/sales"))
	}
	if manager.Get("feishu") != nil {
		t.Fatal("unexpected legacy singleton for bots-only configuration")
	}
	if support.defaultAgent != "support-main" || sales.defaultAgent != "sales-main" {
		t.Fatalf("unexpected per-bot defaults: support=%q sales=%q", support.defaultAgent, sales.defaultAgent)
	}

	type sentReply struct{ receiveIDType, receiveID, text string }
	var supportReplies, salesReplies []sentReply
	support.sendMessageFn = func(_ context.Context, receiveIDType, receiveID, text string) error {
		supportReplies = append(supportReplies, sentReply{receiveIDType, receiveID, text})
		return nil
	}
	sales.sendMessageFn = func(_ context.Context, receiveIDType, receiveID, text string) error {
		salesReplies = append(salesReplies, sentReply{receiveIDType, receiveID, text})
		return nil
	}
	supportHandler := &fakeFeishuHandler{reply: "support reply"}
	salesHandler := &fakeFeishuHandler{reply: "sales reply"}
	support.SetHandler(supportHandler)
	sales.SetHandler(salesHandler)

	// Both inbound events intentionally use the same chat. The receiving AppID,
	// rather than chat ID, must decide which bot handles and sends the reply.
	support.handleMessageEvent(context.Background(), buildFeishuEvent("support request", "p2p", "ou_allowed", "u1", "oc_shared"))
	sales.handleMessageEvent(context.Background(), buildFeishuEvent("sales request", "p2p", "ou_allowed", "u1", "oc_shared"))

	if len(supportReplies) != 1 || supportReplies[0].text != "support reply" {
		t.Fatalf("support replies=%#v", supportReplies)
	}
	if len(salesReplies) != 1 || salesReplies[0].text != "sales reply" {
		t.Fatalf("sales replies=%#v", salesReplies)
	}
	for _, check := range []struct {
		name    string
		handler *fakeFeishuHandler
		appID   string
	}{
		{name: "support", handler: supportHandler, appID: "cli_support"},
		{name: "sales", handler: salesHandler, appID: "cli_sales"},
	} {
		data, ok := check.handler.last.Data.(map[string]interface{})
		if !ok || data["receiver_id"] != check.appID || data["chat_id"] != "oc_shared" {
			t.Fatalf("%s inbound context=%#v", check.name, data)
		}
	}

	// Agent-initiated outbound sends use receiver_id to select the same bot
	// identity, even when the target chat is identical.
	if _, err := manager.Send(context.Background(), "feishu", OutboundMessage{To: "oc_shared", Text: "follow-up", ReceiverID: "cli_support"}); err != nil {
		t.Fatalf("send via support receiver: %v", err)
	}
	if len(supportReplies) != 2 || supportReplies[1].text != "follow-up" || supportReplies[1].receiveIDType != "chat_id" {
		t.Fatalf("support outbound=%#v", supportReplies)
	}
	if len(salesReplies) != 1 {
		t.Fatalf("sales bot should not send support follow-up: %#v", salesReplies)
	}
	if _, err := manager.Send(context.Background(), "feishu", OutboundMessage{To: "oc_shared", Text: "ambiguous"}); err == nil || !strings.Contains(err.Error(), "receiver_id is required") {
		t.Fatalf("expected missing receiver_id isolation error, got %v", err)
	}
	if _, err := manager.Send(context.Background(), "feishu/support", OutboundMessage{To: "oc_shared", Text: "missing named receiver"}); err == nil || !strings.Contains(err.Error(), "receiver_id is required") {
		t.Fatalf("expected named-bot receiver_id error, got %v", err)
	}
	if _, err := manager.Send(context.Background(), "feishu/support", OutboundMessage{To: "oc_shared", Text: "wrong named receiver", ReceiverID: "cli_sales"}); err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("expected named-bot receiver mismatch error, got %v", err)
	}
	if _, err := manager.Send(context.Background(), "feishu", OutboundMessage{To: "oc_shared", Text: "unknown receiver", ReceiverID: "cli_private_unconfigured"}); err == nil || strings.Contains(err.Error(), "cli_private_unconfigured") {
		t.Fatalf("expected non-leaking unknown receiver error, got %v", err)
	}
	if len(supportReplies) != 2 || len(salesReplies) != 1 {
		t.Fatalf("invalid named sends must not reach either bot: support=%#v sales=%#v", supportReplies, salesReplies)
	}
	if _, err := manager.Send(context.Background(), "FEISHU/SUPPORT", OutboundMessage{To: "oc_shared", Text: "explicit support", ReceiverID: "cli_support"}); err != nil {
		t.Fatalf("explicit support receiver send: %v", err)
	}
	if len(supportReplies) != 3 || supportReplies[2].text != "explicit support" || len(salesReplies) != 1 {
		t.Fatalf("explicit named send identity isolation failed: support=%#v sales=%#v", supportReplies, salesReplies)
	}
}

func TestManagerPreservesLegacySingletonFeishuOutboundFallback(t *testing.T) {
	manager := NewManager(&config.ChannelsConfig{Feishu: &config.FeishuConfig{
		Enabled: true, AppID: "cli_legacy", AppSecret: "legacy-secret",
	}}, &config.AgentsConfig{})
	if err := manager.registerConfiguredChannels(); err != nil {
		t.Fatalf("registerConfiguredChannels: %v", err)
	}
	legacy, ok := manager.Get("feishu").(*FeishuBot)
	if !ok || manager.Get("feishu/legacy") != nil {
		t.Fatalf("legacy channel registration failed: %T", manager.Get("feishu"))
	}
	var sent []string
	legacy.sendMessageFn = func(_ context.Context, receiveIDType, receiveID, text string) error {
		sent = append(sent, receiveIDType+":"+receiveID+":"+text)
		return nil
	}
	if _, err := manager.Send(context.Background(), "feishu", OutboundMessage{To: "oc_legacy", Text: "legacy reply"}); err != nil {
		t.Fatalf("legacy implicit send: %v", err)
	}
	if len(sent) != 1 || sent[0] != "chat_id:oc_legacy:legacy reply" {
		t.Fatalf("legacy send=%#v", sent)
	}
	if _, err := manager.Send(context.Background(), "feishu", OutboundMessage{To: "oc_legacy", Text: "explicit legacy", ReceiverID: "cli_legacy"}); err != nil {
		t.Fatalf("legacy explicit send: %v", err)
	}
	if len(sent) != 2 || !strings.HasSuffix(sent[1], ":explicit legacy") {
		t.Fatalf("legacy explicit send=%#v", sent)
	}
}

func TestManagerRequiresReceiverWhenLegacyAndNamedFeishuBotsCoexist(t *testing.T) {
	manager := NewManager(&config.ChannelsConfig{Feishu: &config.FeishuConfig{
		Enabled: true, AppID: "cli_legacy", AppSecret: "legacy-secret",
		Bots: map[string]config.FeishuBotConfig{
			"support": {AppID: "cli_support", AppSecret: "support-secret"},
		},
	}}, nil)
	if err := manager.registerConfiguredChannels(); err != nil {
		t.Fatalf("registerConfiguredChannels: %v", err)
	}
	legacy, ok := manager.Get("feishu").(*FeishuBot)
	if !ok {
		t.Fatalf("legacy bot=%T", manager.Get("feishu"))
	}
	support, ok := manager.Get("feishu/support").(*FeishuBot)
	if !ok {
		t.Fatalf("support bot=%T", manager.Get("feishu/support"))
	}
	var legacySends, supportSends int
	legacy.sendMessageFn = func(context.Context, string, string, string) error { legacySends++; return nil }
	support.sendMessageFn = func(context.Context, string, string, string) error { supportSends++; return nil }

	if _, err := manager.Send(context.Background(), "feishu", OutboundMessage{To: "oc_shared", Text: "ambiguous"}); err == nil || !strings.Contains(err.Error(), "receiver_id is required") {
		t.Fatalf("expected mixed-config receiver_id error, got %v", err)
	}
	if legacySends != 0 || supportSends != 0 {
		t.Fatalf("ambiguous send reached a bot: legacy=%d support=%d", legacySends, supportSends)
	}
	if _, err := manager.Send(context.Background(), "feishu", OutboundMessage{To: "oc_shared", Text: "legacy", ReceiverID: "cli_legacy"}); err != nil {
		t.Fatalf("explicit legacy receiver send: %v", err)
	}
	if _, err := manager.Send(context.Background(), "feishu", OutboundMessage{To: "oc_shared", Text: "support", ReceiverID: "cli_support"}); err != nil {
		t.Fatalf("explicit named receiver send: %v", err)
	}
	if legacySends != 1 || supportSends != 1 {
		t.Fatalf("explicit receiver sends did not preserve identity: legacy=%d support=%d", legacySends, supportSends)
	}
}

func TestManagerStartsAndStopsEachConfiguredFeishuBot(t *testing.T) {
	manager := NewManager(&config.ChannelsConfig{Feishu: &config.FeishuConfig{
		Enabled: true,
		Bots: map[string]config.FeishuBotConfig{
			"support": {AppID: "cli_support", AppSecret: "support-secret"},
			"sales":   {AppID: "cli_sales", AppSecret: "sales-secret"},
		},
	}}, nil)
	if err := manager.registerConfiguredChannels(); err != nil {
		t.Fatalf("registerConfiguredChannels: %v", err)
	}
	support, ok := manager.Get("feishu/support").(*FeishuBot)
	if !ok {
		t.Fatalf("support bot=%T", manager.Get("feishu/support"))
	}
	sales, ok := manager.Get("feishu/sales").(*FeishuBot)
	if !ok {
		t.Fatalf("sales bot=%T", manager.Get("feishu/sales"))
	}

	var supportStarts, salesStarts, supportStops, salesStops atomic.Int32
	support.startFn = func(context.Context) error { supportStarts.Add(1); return nil }
	sales.startFn = func(context.Context) error { salesStarts.Add(1); return nil }
	support.stopFn = func() error { supportStops.Add(1); return nil }
	sales.stopFn = func() error { salesStops.Add(1); return nil }

	if err := manager.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	waitForCondition(t, time.Second, func() bool {
		return support.IsRunning() && sales.IsRunning() && supportStarts.Load() == 1 && salesStarts.Load() == 1
	})
	if err := manager.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if support.IsRunning() || sales.IsRunning() || supportStops.Load() != 1 || salesStops.Load() != 1 {
		t.Fatalf("both configured bots must stop independently: support running=%t starts=%d stops=%d; sales running=%t starts=%d stops=%d", support.IsRunning(), supportStarts.Load(), supportStops.Load(), sales.IsRunning(), salesStarts.Load(), salesStops.Load())
	}
}

func TestManagerStartStop(t *testing.T) {
	manager := NewManager(nil, nil)
	fake := &fakeChannel{name: "fake"}

	if err := manager.Register(fake); err != nil {
		t.Fatalf("register: %v", err)
	}

	if err := manager.Start(context.Background()); err != nil {
		t.Fatalf("start: %v", err)
	}
	waitForCondition(t, time.Second, func() bool {
		return fake.running && fake.started == 1
	})
	if !fake.running || fake.started != 1 {
		t.Fatalf("expected channel started, running=%v started=%d", fake.running, fake.started)
	}

	if err := manager.Stop(); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if fake.running || fake.stopped != 1 {
		t.Fatalf("expected channel stopped, running=%v stopped=%d", fake.running, fake.stopped)
	}
}

func TestManagerRegisterDuplicate(t *testing.T) {
	manager := NewManager(nil, nil)
	fake := &fakeChannel{name: "fake"}

	if err := manager.Register(fake); err != nil {
		t.Fatalf("register: %v", err)
	}
	if err := manager.Register(fake); err == nil {
		t.Fatalf("expected duplicate register error")
	}
}

func TestManagerStartBestEffortWhenOneChannelFails(t *testing.T) {
	manager := NewManager(nil, nil)
	good := &fakeChannel{name: "good"}
	bad := &fakeChannel{name: "bad", startErr: errors.New("boom")}

	if err := manager.Register(good); err != nil {
		t.Fatalf("register good: %v", err)
	}
	if err := manager.Register(bad); err != nil {
		t.Fatalf("register bad: %v", err)
	}

	if err := manager.Start(context.Background()); err != nil {
		t.Fatalf("start should be best-effort, got error: %v", err)
	}

	waitForCondition(t, time.Second, func() bool {
		return good.started == 1 && bad.started == 1
	})

	if !good.running {
		t.Fatalf("expected good channel to start")
	}
	if bad.running {
		t.Fatalf("expected bad channel not running")
	}
}

func TestManagerStartDoesNotBlockOnSlowChannel(t *testing.T) {
	manager := NewManager(nil, nil)
	blockCtxObserved := make(chan struct{})
	quick := &fakeChannel{name: "quick"}
	blocking := &blockingStartChannel{
		name:           "blocking",
		started:        make(chan struct{}),
		blockCtxSignal: blockCtxObserved,
	}

	if err := manager.Register(quick); err != nil {
		t.Fatalf("register quick: %v", err)
	}
	if err := manager.Register(blocking); err != nil {
		t.Fatalf("register blocking: %v", err)
	}

	startedAt := time.Now()
	if err := manager.Start(context.Background()); err != nil {
		t.Fatalf("start: %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > 200*time.Millisecond {
		t.Fatalf("manager start blocked for %s", elapsed)
	}

	waitForCondition(t, time.Second, func() bool { return quick.started == 1 })

	if err := manager.Stop(); err != nil {
		t.Fatalf("stop: %v", err)
	}

	select {
	case <-blockCtxObserved:
	case <-time.After(time.Second):
		t.Fatalf("expected blocking start context cancellation on stop")
	}
}

type blockingStartChannel struct {
	name           string
	started        chan struct{}
	blockCtxSignal chan struct{}
}

func (b *blockingStartChannel) Name() string { return b.name }

func (b *blockingStartChannel) Start(ctx context.Context) error {
	close(b.started)
	<-ctx.Done()
	close(b.blockCtxSignal)
	return ctx.Err()
}

func (b *blockingStartChannel) Stop(ctx context.Context) error { _ = ctx; return nil }

func (b *blockingStartChannel) Send(ctx context.Context, msg OutboundMessage) (*SendResult, error) {
	_ = ctx
	return nil, nil
}

func (b *blockingStartChannel) IsRunning() bool { return false }

func (b *blockingStartChannel) IsAllowed(senderID string) bool { return true }

func waitForCondition(t *testing.T, timeout time.Duration, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("condition not met before timeout (%s)", timeout)
}

func TestManagerStartUsesIndependentContexts(t *testing.T) {
	// When the parent context is canceled, channels with independent contexts
	// should NOT have their contexts canceled automatically. They should only
	// stop when Stop() is called explicitly.
	manager := NewManager(nil, nil)
	ctxObserved := make(chan struct{})
	ch := &contextObservingChannel{
		name:      "observer",
		ctxDoneCh: ctxObserved,
		startedCh: make(chan struct{}),
	}

	if err := manager.Register(ch); err != nil {
		t.Fatalf("register: %v", err)
	}

	parentCtx, parentCancel := context.WithCancel(context.Background())
	if err := manager.Start(parentCtx); err != nil {
		t.Fatalf("start: %v", err)
	}

	// Wait for the channel to start
	select {
	case <-ch.startedCh:
	case <-time.After(time.Second):
		t.Fatalf("channel did not start in time")
	}

	// Cancel the parent context — channel should NOT be affected
	parentCancel()

	// Give it a moment to propagate (if it were a child, it would be canceled)
	select {
	case <-ctxObserved:
		t.Fatalf("channel context was canceled when parent was canceled — contexts are not isolated")
	case <-time.After(100 * time.Millisecond):
		// Good — channel context was NOT canceled
	}

	// Now explicitly stop — this should cancel the channel
	if err := manager.Stop(); err != nil {
		t.Fatalf("stop: %v", err)
	}
}

func TestManagerStartChannelPanicRecovery(t *testing.T) {
	manager := NewManager(nil, nil)
	good := &fakeChannel{name: "good"}
	panicking := &panickingChannel{name: "panicky", panicDone: make(chan struct{})}

	if err := manager.Register(good); err != nil {
		t.Fatalf("register good: %v", err)
	}
	if err := manager.Register(panicking); err != nil {
		t.Fatalf("register panicky: %v", err)
	}

	if err := manager.Start(context.Background()); err != nil {
		t.Fatalf("start: %v", err)
	}

	// Wait for both channels to attempt start
	waitForCondition(t, time.Second, func() bool {
		return good.started == 1
	})

	select {
	case <-panicking.panicDone:
	case <-time.After(time.Second):
		t.Fatalf("panicking channel did not run")
	}

	// Good channel should still be running despite the other panicking
	if !good.running {
		t.Fatalf("expected good channel to be running after sibling panic")
	}

	if err := manager.Stop(); err != nil {
		t.Fatalf("stop: %v", err)
	}
}

// contextObservingChannel blocks on Start until its context is canceled,
// and signals on ctxDoneCh when that happens.
type contextObservingChannel struct {
	name      string
	ctxDoneCh chan struct{}
	startedCh chan struct{}
	running   bool
}

func (c *contextObservingChannel) Name() string { return c.name }

func (c *contextObservingChannel) Start(ctx context.Context) error {
	c.running = true
	close(c.startedCh)
	<-ctx.Done()
	close(c.ctxDoneCh)
	c.running = false
	return ctx.Err()
}

func (c *contextObservingChannel) Stop(ctx context.Context) error {
	_ = ctx
	c.running = false
	return nil
}

func (c *contextObservingChannel) Send(ctx context.Context, msg OutboundMessage) (*SendResult, error) {
	return nil, nil
}

func (c *contextObservingChannel) IsRunning() bool { return c.running }

func (c *contextObservingChannel) IsAllowed(senderID string) bool { return true }

// panickingChannel panics during Start to test panic recovery.
type panickingChannel struct {
	name      string
	panicDone chan struct{}
}

func (p *panickingChannel) Name() string { return p.name }

func (p *panickingChannel) Start(ctx context.Context) error {
	defer close(p.panicDone)
	panic("test panic in channel start")
}

func (p *panickingChannel) Stop(ctx context.Context) error { _ = ctx; return nil }
func (p *panickingChannel) IsRunning() bool                { return false }
func (p *panickingChannel) IsAllowed(senderID string) bool { return true }
func (p *panickingChannel) Send(ctx context.Context, msg OutboundMessage) (*SendResult, error) {
	return nil, nil
}

func TestManagerRejectsDuplicateFeishuAppIDAcrossBots(t *testing.T) {
	// Two named bots that declare the same Feishu App ID resolve to the same
	// inbound receiver identity. Registration must fail rather than let the
	// second bot silently claim the identity, which would defeat #387's
	// reply-isolation guarantee (the outbound reply could then route to
	// whichever bot happened to register last).
	manager := NewManager(&config.ChannelsConfig{Feishu: &config.FeishuConfig{
		Enabled: true,
		Bots: map[string]config.FeishuBotConfig{
			"support": {AppID: "cli_shared", AppSecret: "support-secret", AllowedUsers: []string{"ou_a"}},
			"sales":   {AppID: "cli_shared", AppSecret: "sales-secret", AllowedUsers: []string{"ou_b"}},
		},
	}}, &config.AgentsConfig{Router: "ohMyCode", OhMyCode: &config.OhMyCodeConfig{Enabled: true}})

	if err := manager.registerConfiguredChannels(); err == nil || !strings.Contains(err.Error(), "feishu app ID is configured by more than one bot") {
		t.Fatalf("expected duplicate-appID collision error, got %v", err)
	}
}
