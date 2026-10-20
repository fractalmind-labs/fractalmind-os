package channels

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"
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

func TestManagerRegistersMultipleFeishuBotsWithReplyIdentityIsolation(t *testing.T) {
	cfg := v2Config(t, "  feishu:\n    support: {appId: cli_support, appSecret: secret:feishu-support, allowedUsers: [ou_allowed]}\n    sales: {appId: cli_sales, appSecret: secret:feishu-sales, allowedUsers: [ou_allowed]}\n",
		map[string]string{"support-main": "feishu.support", "sales-main": "feishu.sales"})
	manager := NewManager(cfg, map[string]string{"feishu-support": "support-secret", "feishu-sales": "sales-secret"})

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
	if support.defaultAgent != "support-main" || sales.defaultAgent != "sales-main" || len(support.agentAllow.Names()) != 1 {
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

func TestManagerStartsAndStopsEachConfiguredFeishuBot(t *testing.T) {
	cfg := v2Config(t, "  feishu:\n    support: {appId: cli_support, appSecret: secret:feishu-support}\n    sales: {appId: cli_sales, appSecret: secret:feishu-sales}\n",
		map[string]string{"support-main": "feishu.support", "sales-main": "feishu.sales"})
	manager := NewManager(cfg, map[string]string{"feishu-support": "support-secret", "feishu-sales": "sales-secret"})
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
	cfg := v2Config(t, "  feishu:\n    support: {appId: cli_shared, appSecret: secret:feishu-support}\n    sales: {appId: cli_shared, appSecret: secret:feishu-sales}\n",
		map[string]string{"support-main": "feishu.support", "sales-main": "feishu.sales"})
	manager := NewManager(cfg, map[string]string{"feishu-support": "a", "feishu-sales": "b"})

	if err := manager.registerConfiguredChannels(); err == nil || !strings.Contains(err.Error(), "feishu app ID is configured by more than one bot") {
		t.Fatalf("expected duplicate-appID collision error, got %v", err)
	}
}

func TestManagerSkipsChannelsWithMissingSecrets(t *testing.T) {
	cfg := v2Config(t, "  feishu:\n    support: {appId: cli_support, appSecret: secret:feishu-support}\n    sales: {appId: cli_sales, appSecret: secret:feishu-sales}\n",
		map[string]string{"support-main": "feishu.support", "sales-main": "feishu.sales"})
	manager := NewManager(cfg, map[string]string{"feishu-sales": "sales-secret"})
	if err := manager.registerConfiguredChannels(); err != nil {
		t.Fatalf("registerConfiguredChannels: %v", err)
	}
	if manager.Get("feishu/sales") == nil || manager.Get("feishu/support") != nil {
		t.Fatal("only the channel with its secret should start")
	}
	if got := manager.Unavailable()["feishu.support"]; got != "secret feishu-support is not set" {
		t.Fatalf("unavailable reason: %q", got)
	}
}
