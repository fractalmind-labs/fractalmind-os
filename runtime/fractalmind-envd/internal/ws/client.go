package ws

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/heartbeat"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/wsauth"
	"github.com/gorilla/websocket"
)

// Message is the envelope for all WebSocket messages.
type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// CommandPayload is a command from Gateway.
type CommandPayload struct {
	Command   string `json:"command"`    // status, restart, kill, logs
	AgentID   string `json:"agent_id"`   // target agent (optional)
	Args      string `json:"args"`       // additional arguments
	RequestID string `json:"request_id"` // for response correlation
}

// DesktopSignalPayload is a remote-desktop signaling request relayed from the
// coordinator (originating in a console). The worker forwards it to its local
// envd-desktop server and returns the response, so the desktop signaling reuses
// the authenticated control channel instead of a public tunnel.
type DesktopSignalPayload struct {
	RequestID string          `json:"request_id"`
	Method    string          `json:"method"` // GET or POST
	Path      string          `json:"path"`   // /offer or /ice
	Body      json.RawMessage `json:"body,omitempty"`
}

// DesktopSignalResult is the worker's reply for a DesktopSignalPayload.
type DesktopSignalResult struct {
	RequestID string          `json:"request_id"`
	Status    int             `json:"status"`
	Body      json.RawMessage `json:"body,omitempty"`
	Error     string          `json:"error,omitempty"`
}

// Client manages the WebSocket connection to Gateway.
type Client struct {
	url             string
	reconnectWait   time.Duration
	conn            *websocket.Conn
	mu              sync.Mutex
	done            chan struct{}
	ctx             context.Context
	cancel          context.CancelFunc
	closeOnce       sync.Once
	onCommand       func(CommandPayload)
	onConnect       func()
	onDesktopSignal func(DesktopSignalPayload)

	// Control-channel authentication. signer proves this worker's SUI
	// identity to the coordinator; expectedCoordAddr, when non-empty, pins the
	// coordinator's SUI address so a spoofed gateway cannot drive this worker.
	signer              wsauth.Signer
	expectedCoordAddr   string
	handshakeTimeout    time.Duration
	resolveEndpoint     func(context.Context) (string, string, error)
	validateConnection  func(context.Context) error
	observationScope    func(context.Context) (heartbeat.Scope, uint64, error)
	sessionNonce        string
	observationSequence uint64
}

// SetHostObservation is configured before Connect; only current admitted Host
// keys can produce a signed heartbeat. No legacy unsigned fallback is permitted.
func (c *Client) SetHostObservation(read func(context.Context) (heartbeat.Scope, uint64, error)) {
	c.observationScope = read
}

// SetChainAuthority is configured before Connect. Resolve reads current chain
// admission on every dial; validate rechecks it before observed/protected traffic.
func (c *Client) SetChainAuthority(resolve func(context.Context) (string, string, error), validate func(context.Context) error) {
	c.resolveEndpoint, c.validateConnection = resolve, validate
}

func (c *Client) validate() error {
	if c.validateConnection == nil {
		return nil
	}
	if c.signer == nil {
		return fmt.Errorf("Host signing identity required")
	}
	ctx, cancel := context.WithTimeout(c.ctx, 10*time.Second)
	defer cancel()
	return c.validateConnection(ctx)
}

// NewClient creates a WebSocket client.
func NewClient(url string, reconnectWait time.Duration) *Client {
	ctx, cancel := context.WithCancel(context.Background())
	return &Client{
		ctx: ctx, cancel: cancel,
		url:              url,
		reconnectWait:    reconnectWait,
		done:             make(chan struct{}),
		handshakeTimeout: 15 * time.Second,
	}
}

func (c *Client) waitReconnect() {
	timer := time.NewTimer(c.reconnectWait)
	defer timer.Stop()
	select {
	case <-c.done:
	case <-timer.C:
	}
}

// SetAuth enables control-channel authentication. signer is this worker's SUI
// keypair. expectedCoordAddr, if non-empty, is the coordinator SUI address this
// worker will accept; an empty value authenticates the coordinator's identity
// but does not pin it (a WARNING is logged, since that leaves the MITM path
// open).
func (c *Client) SetAuth(signer wsauth.Signer, expectedCoordAddr string) {
	c.signer = signer
	c.expectedCoordAddr = expectedCoordAddr
}

// OnCommand sets the handler for incoming commands.
func (c *Client) OnCommand(handler func(CommandPayload)) {
	c.onCommand = handler
}

// OnDesktopSignal sets the handler for relayed remote-desktop signaling.
func (c *Client) OnDesktopSignal(handler func(DesktopSignalPayload)) {
	c.onDesktopSignal = handler
}

// OnConnect sets a handler invoked after every successful connection, once the
// control-channel handshake (when enabled) has completed and Send is usable.
// Registration must happen here rather than on a timer: over high-latency
// links the handshake can outlast any fixed delay, and reconnects need to
// re-register or the coordinator ignores subsequent heartbeats.
func (c *Client) OnConnect(handler func()) {
	c.onConnect = handler
}

// Connect establishes and maintains the WebSocket connection.
// It blocks until the done channel is closed.
func (c *Client) Connect() {
	for {
		select {
		case <-c.done:
			return
		default:
		}
		if c.resolveEndpoint != nil {
			ctx, cancel := context.WithTimeout(c.ctx, 15*time.Second)
			url, address, err := c.resolveEndpoint(ctx)
			cancel()
			if err != nil || url == "" || address == "" || c.signer == nil {
				log.Printf("[ws] current chain admission unavailable; retrying in %s", c.reconnectWait)
				c.waitReconnect()
				continue
			}
			c.url, c.expectedCoordAddr = url, address
		}

		log.Printf("[ws] connecting to %s ...", c.url)

		conn, _, err := websocket.DefaultDialer.DialContext(c.ctx, c.url, nil)
		if err != nil {
			log.Printf("[ws] connect failed: %v, retrying in %s", err, c.reconnectWait)
			c.waitReconnect()
			continue
		}

		log.Printf("[ws] connected to %s", c.url)
		stopClose := context.AfterFunc(c.ctx, func() { conn.Close() })

		if c.signer != nil {
			if err := c.authenticate(conn); err != nil {
				log.Printf("[ws] control-channel auth failed: %v, retrying in %s", err, c.reconnectWait)
				conn.Close()
				stopClose()
				c.waitReconnect()
				continue
			}
			log.Printf("[ws] control-channel authenticated (coordinator verified)")
		} else {
			log.Printf("[ws] WARNING: control-channel auth disabled (no signer) — commands are unauthenticated")
		}

		c.mu.Lock()
		c.conn = conn
		c.mu.Unlock()

		if c.onConnect != nil {
			c.onConnect()
		}

		c.readLoop(conn)
		conn.Close()
		stopClose()

		c.mu.Lock()
		c.conn = nil
		c.mu.Unlock()

		log.Printf("[ws] disconnected, reconnecting in %s", c.reconnectWait)
		c.waitReconnect()
	}
}

// authenticate runs the mutual challenge-response handshake before any command
// traffic. It verifies the coordinator's identity (and pins it when configured)
// and proves this worker's identity to the coordinator.
func (c *Client) authenticate(conn *websocket.Conn) error {
	deadline := time.Now().Add(c.handshakeTimeout)
	_ = conn.SetReadDeadline(deadline)
	_ = conn.SetWriteDeadline(deadline)
	defer func() {
		_ = conn.SetReadDeadline(time.Time{})
		_ = conn.SetWriteDeadline(time.Time{})
	}()

	// Step 1: send our challenge nonce.
	clientNonce, clientNonceHex, err := wsauth.NewNonce()
	if err != nil {
		return err
	}
	if err := writeMsg(conn, wsauth.MsgAuthInit, wsauth.InitPayload{ClientNonce: clientNonceHex}); err != nil {
		return fmt.Errorf("send auth_init: %w", err)
	}

	// Step 2: receive the coordinator's proof (over our nonce) and its nonce.
	var challenge wsauth.ChallengePayload
	if err := readMsg(conn, wsauth.MsgAuthChallenge, &challenge); err != nil {
		return fmt.Errorf("read auth_challenge: %w", err)
	}
	coordAddr, err := wsauth.VerifyProof(challenge.Proof, clientNonce)
	if err != nil {
		return fmt.Errorf("coordinator identity invalid: %w", err)
	}
	if c.expectedCoordAddr != "" {
		if coordAddr != c.expectedCoordAddr {
			return fmt.Errorf("coordinator address %s does not match pinned %s", coordAddr, c.expectedCoordAddr)
		}
	} else {
		log.Printf("[ws] WARNING: coordinator_address not pinned; accepting coordinator %s on first sight (MITM not fully closed)", coordAddr)
	}

	// Step 3: prove our identity over the coordinator's nonce.
	serverNonce, err := wsauth.DecodeNonce(challenge.ServerNonce)
	if err != nil {
		return fmt.Errorf("bad server nonce: %w", err)
	}
	if err := writeMsg(conn, wsauth.MsgAuthResponse, wsauth.ResponsePayload{Proof: wsauth.Prove(c.signer, serverNonce)}); err != nil {
		return fmt.Errorf("send auth_response: %w", err)
	}

	// Step 4: await acceptance.
	var raw Message
	if err := conn.ReadJSON(&raw); err != nil {
		return fmt.Errorf("read auth result: %w", err)
	}
	switch raw.Type {
	case wsauth.MsgAuthOK:
		c.mu.Lock()
		c.sessionNonce, c.observationSequence = challenge.ServerNonce, 0
		c.mu.Unlock()
		return nil
	case wsauth.MsgAuthError:
		var ep wsauth.ErrorPayload
		_ = json.Unmarshal(raw.Payload, &ep)
		return fmt.Errorf("coordinator rejected auth: %s", ep.Reason)
	default:
		return fmt.Errorf("unexpected auth result type %q", raw.Type)
	}
}

func writeMsg(conn *websocket.Conn, msgType string, payload interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return conn.WriteJSON(Message{Type: msgType, Payload: data})
}

func readMsg(conn *websocket.Conn, wantType string, out interface{}) error {
	var raw Message
	if err := conn.ReadJSON(&raw); err != nil {
		return err
	}
	if raw.Type != wantType {
		return fmt.Errorf("expected %q, got %q", wantType, raw.Type)
	}
	return json.Unmarshal(raw.Payload, out)
}

// Send sends a message to Gateway.
func (c *Client) Send(msgType string, payload interface{}) error {
	if err := c.validate(); err != nil {
		// A concurrent product-record transaction can change the organization
		// version during a heartbeat read without revoking this Host. Drop this
		// unverified frame and recheck on the next send; keep the socket so an
		// unrelated in-flight command is not lost. All other failures close it.
		if errors.Is(err, nodecommand.ErrChainSnapshotChanged) {
			return err
		}
		c.mu.Lock()
		if c.conn != nil {
			c.conn.Close()
		}
		c.mu.Unlock()
		return err
	}
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()

	if conn == nil {
		return fmt.Errorf("not connected")
	}
	var scope heartbeat.Scope
	var expiry uint64
	if msgType == "heartbeat" && c.observationScope != nil {
		ctx, cancel := context.WithTimeout(c.ctx, 10*time.Second)
		var err error
		scope, expiry, err = c.observationScope(ctx)
		cancel()
		if err != nil {
			return err
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if conn != c.conn {
		return fmt.Errorf("Host connection changed before send")
	}
	if msgType == "heartbeat" && c.observationScope != nil {
		observed, ok := payload.(*heartbeat.Payload)
		if !ok {
			return fmt.Errorf("typed Host heartbeat required")
		}
		signed, err := heartbeat.Sign(c.signer, scope, c.sessionNonce, c.observationSequence+1, heartbeat.Expiry(observed.Timestamp, expiry), observed)
		if err != nil {
			return err
		}
		c.observationSequence++
		msgType, payload = "host_observation", signed
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	msg := Message{
		Type:    msgType,
		Payload: data,
	}

	return conn.WriteJSON(msg)
}

// Close shuts down the client.
func (c *Client) Close() {
	c.closeOnce.Do(func() { close(c.done); c.cancel() })
	c.mu.Lock()
	if c.conn != nil {
		c.conn.Close()
	}
	c.mu.Unlock()
}

func (c *Client) readLoop(conn *websocket.Conn) {
	for {
		var msg Message
		if err := conn.ReadJSON(&msg); err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[ws] read error: %v", err)
			}
			return
		}
		if err := c.validate(); err != nil {
			// Re-read authority for this already received message once if a chain
			// write raced with the snapshot. This is not another delivery and it
			// never refreshes the command's signed expiry or grants permission.
			if !errors.Is(err, nodecommand.ErrChainSnapshotChanged) || c.validate() != nil {
				return
			}
		}

		switch msg.Type {
		case "command":
			if c.onCommand != nil {
				var cmd CommandPayload
				if err := json.Unmarshal(msg.Payload, &cmd); err != nil {
					log.Printf("[ws] invalid command payload: %v", err)
					continue
				}
				c.onCommand(cmd)
			}
		case "desktop_signal":
			if c.onDesktopSignal != nil {
				var sig DesktopSignalPayload
				if err := json.Unmarshal(msg.Payload, &sig); err != nil {
					log.Printf("[ws] invalid desktop_signal payload: %v", err)
					continue
				}
				c.onDesktopSignal(sig)
			}
		case "ping":
			c.Send("pong", nil)
		default:
			log.Printf("[ws] unknown message type: %s", msg.Type)
		}
	}
}
