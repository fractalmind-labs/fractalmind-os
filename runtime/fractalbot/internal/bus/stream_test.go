package bus

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/fractalmind-ai/fractalbot/internal/channels"
	"github.com/fractalmind-ai/fractalbot/pkg/protocol"
)

// recordingSender captures the ordered sequence of sent messages so tests can
// assert ack/progress ordering and recipient metadata.
type recordingSender struct {
	mu    sync.Mutex
	records []struct {
		channel string
		text    string
		to      string
		receiverID string
		threadTS string
	}
	err error
}

func (s *recordingSender) Send(ctx context.Context, channelName string, msg channels.OutboundMessage) (*channels.SendResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return nil, s.err
	}
	s.records = append(s.records, struct {
		channel    string
		text       string
		to         string
		receiverID string
		threadTS   string
	}{channelName, msg.Text, msg.To, msg.ReceiverID, msg.ThreadTS})
	return &channels.SendResult{ChannelID: msg.To}, nil
}

func (s *recordingSender) texts() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, 0, len(s.records))
	for _, r := range s.records {
		out = append(out, r.text)
	}
	return out
}

func (s *recordingSender) at(i int) struct {
	channel    string
	text       string
	to         string
	receiverID string
	threadTS   string
} {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.records[i]
}

// callCount returns how many times the sender has been invoked.
func (s *recordingSender) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.records)
}

// fakeStreamingHandler implements channels.StreamingHandler. Its streamFn is
// responsible for calling sink.Ack / sink.Progress and returning the final
// reply.
type fakeStreamingHandler struct {
	mu       sync.Mutex
	streamFn func(ctx context.Context, msg *protocol.Message, sink channels.ReplySink) (string, error)
	calls    int
}

func (h *fakeStreamingHandler) HandleIncomingStream(ctx context.Context, msg *protocol.Message, sink channels.ReplySink) (string, error) {
	h.mu.Lock()
	h.calls++
	fn := h.streamFn
	h.mu.Unlock()
	if fn == nil {
		return "final", nil
	}
	return fn(ctx, msg, sink)
}

// HandleIncoming implements channels.IncomingMessageHandler so that
// *fakeStreamingHandler satisfies the MessageBus handler parameter. The MessageBus
// dispatches to the streaming path (HandleIncomingStream) whenever the handler also
// implements channels.StreamingHandler, which this type does; HandleIncoming is
// retained for the non-streaming branch and simply runs the streamFn against a
// discard sink.
func (h *fakeStreamingHandler) HandleIncoming(ctx context.Context, msg *protocol.Message) (string, error) {
	return h.HandleIncomingStream(ctx, msg, discardSink{})
}

// discardSink is a no-op channels.ReplySink used when the non-streaming
// HandleIncoming branch is exercised.
type discardSink struct{}

func (discardSink) Ack(string)      {}
func (discardSink) Progress(string) {}

func (h *fakeStreamingHandler) callCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.calls
}

func feishuInbound(chatID, receiverID, threadTS string) *protocol.Message {
	return &protocol.Message{
		Kind:   protocol.MessageKindChannel,
		Action: protocol.ActionCreate,
		Data: map[string]interface{}{
			"channel":     "feishu",
			"text":        "hello",
			"chat_id":     chatID,
			"receiver_id": receiverID,
			"thread_ts":   threadTS,
		},
	}
}

func TestStreamingSendsAckThenProgressInOrder(t *testing.T) {
	sender := &recordingSender{}
	handler := &fakeStreamingHandler{streamFn: func(ctx context.Context, msg *protocol.Message, sink channels.ReplySink) (string, error) {
		sink.Ack("收到")
		sink.Progress("进度 1")
		sink.Progress("进度 2")
		return "完成", nil
	}}
	b := New(handler, sender, 8, 8)
	b.Start()
	defer func() { b.Close(); b.Wait() }()

	reply, err := b.HandleIncoming(context.Background(), feishuInbound("oc_abc", "cli_x", "1690000000.456"))
	if err != nil {
		t.Fatalf("HandleIncoming: %v", err)
	}
	if reply != "完成" {
		t.Fatalf("expected final reply '完成', got %q", reply)
	}
	if handler.callCount() != 1 {
		t.Fatalf("expected 1 streaming handler call, got %d", handler.callCount())
	}

	got := sender.texts()
	want := []string{"收到", "进度 1", "进度 2"}
	if len(got) != len(want) {
		t.Fatalf("expected %d sent messages, got %d: %v", len(want), len(got), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("sent[%d] = %q, want %q (full: %v)", i, got[i], want[i], got)
		}
	}

	// The acknowledgment must carry the inbound recipient metadata so it exits
	// through the same channel/it arrived on.
	first := sender.at(0)
	if first.channel != "feishu" {
		t.Errorf("ack channel = %q, want %q", first.channel, "feishu")
	}
	if first.to != "oc_abc" {
		t.Errorf("ack to = %q, want %q", first.to, "oc_abc")
	}
	if first.receiverID != "cli_x" {
		t.Errorf("ack receiverID = %q, want %q", first.receiverID, "cli_x")
	}
	if first.threadTS != "1690000000.456" {
		t.Errorf("ack threadTS = %q, want %q", first.threadTS, "1690000000.456")
	}
}

func TestStreamingEmptyAckIsSuppressed(t *testing.T) {
	sender := &recordingSender{}
	handler := &fakeStreamingHandler{streamFn: func(ctx context.Context, msg *protocol.Message, sink channels.ReplySink) (string, error) {
		sink.Ack("   ") // whitespace-only ack must be suppressed
		sink.Progress("done step")
		return "final", nil
	}}
	b := New(handler, sender, 8, 8)
	b.Start()
	defer func() { b.Close(); b.Wait() }()

	if _, err := b.HandleIncoming(context.Background(), feishuInbound("oc_abc", "cli_x", "")); err != nil {
		t.Fatalf("HandleIncoming: %v", err)
	}
	got := sender.texts()
	if len(got) != 1 || got[0] != "done step" {
		t.Fatalf("expected only the progress message, got %v", got)
	}
}

func TestStreamingSenderErrorIsNonFatal(t *testing.T) {
	sender := &recordingSender{err: context.Canceled}
	handler := &fakeStreamingHandler{streamFn: func(ctx context.Context, msg *protocol.Message, sink channels.ReplySink) (string, error) {
		sink.Ack("收到")
		sink.Progress("step")
		return "final", nil
	}}
	b := New(handler, sender, 8, 8)
	b.Start()
	defer func() { b.Close(); b.Wait() }()

	// A sink send failure must not abort processing: the final reply is still
	// returned.
	reply, err := b.HandleIncoming(context.Background(), feishuInbound("oc_abc", "cli_x", ""))
	if err != nil {
		t.Fatalf("HandleIncoming should not fail when sink sends fail: %v", err)
	}
	if reply != "final" {
		t.Fatalf("expected final reply 'final', got %q", reply)
	}
}

// TestNonStreamingHandlerKeepsSingleReplyContract verifies that a handler which
// only implements the single-reply HandleIncoming keeps working unchanged: no
// sink is involved and the returned reply is delivered as before.
func TestNonStreamingHandlerKeepsSingleReplyContract(t *testing.T) {
	sender := &recordingSender{}
	handler := &fakeHandler{} // implements only HandleIncoming
	b := New(handler, sender, 8, 8)
	b.Start()
	defer func() { b.Close(); b.Wait() }()

	reply, err := b.HandleIncoming(context.Background(), makeProtocolMsg("telegram", "hi"))
	if err != nil {
		t.Fatalf("HandleIncoming: %v", err)
	}
	if reply != "ack" {
		t.Fatalf("expected reply 'ack', got %q", reply)
	}
	// The non-streaming path never routes through the sink, so the sender is
	// never invoked by the bus for ack/progress.
	if sender.callCount() != 0 {
		t.Fatalf("expected sender to be unused for a non-streaming handler, got %d calls", sender.callCount())
	}
}

var _ = strings.TrimSpace
