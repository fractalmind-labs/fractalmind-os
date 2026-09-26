package channels

import (
	"context"

	"github.com/fractalmind-ai/fractalbot/pkg/protocol"
)

// IncomingMessageHandler handles inbound channel messages and returns an optional reply.
// Channel implementations are responsible for delivering the reply back to the user.
type IncomingMessageHandler interface {
	HandleIncoming(ctx context.Context, msg *protocol.Message) (string, error)
}

// ReplySink delivers an acknowledgment and milestone progress updates back
// through the inbound channel during asynchronous processing. The MessageBus
// provides a concrete implementation to a StreamingHandler; each send is
// best-effort, and a send failure is logged but never aborts processing.
type ReplySink interface {
	// Ack sends the initial "received, processing" acknowledgment. An empty or
	// whitespace-only string suppresses the ack entirely.
	Ack(text string)
	// Progress delivers a milestone progress update through the inbound
	// channel. An empty or whitespace-only string is ignored.
	Progress(text string)
}

// StreamingHandler is an optional IncomingMessageHandler extension. When the
// registered handler implements it, the MessageBus passes a ReplySink so the
// handler can acknowledge an inbound message immediately and milestone progress
// updates through the inbound channel before returning the final reply.
// Handlers that do not implement it keep using the single-reply HandleIncoming
// contract unchanged.
type StreamingHandler interface {
	HandleIncomingStream(ctx context.Context, msg *protocol.Message, sink ReplySink) (string, error)
}

// AgentLifecycle enables channel commands to manage agent-manager processes.
type AgentLifecycle interface {
	MonitorAgent(ctx context.Context, agentName string, lines int) (string, error)
	StartAgent(ctx context.Context, agentName string) (string, error)
	StopAgent(ctx context.Context, agentName string) (string, error)
	Doctor(ctx context.Context) (string, error)
}
