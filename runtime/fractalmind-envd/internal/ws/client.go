package ws

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/fractalmind-ai/fractalmind-envd/internal/wsauth"
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
	onCommand       func(CommandPayload)
	onConnect       func()
	onDesktopSignal func(DesktopSignalPayload)

	// Control-channel authentication. signer proves this worker's SUI
	// identity to the coordinator; expectedCoordAddr, when non-empty, pins the
	// coordinator's SUI address so a spoofed gateway cannot drive this worker.
	signer            wsauth.Signer
	expectedCoordAddr string
	handshakeTimeout  time.Duration
}

// NewClient creates a WebSocket client.
func NewClient(url string, reconnectWait time.Duration) *Client {
	return &Client{
		url:              url,
		reconnectWait:    reconnectWait,
		done:             make(chan struct{}),
		handshakeTimeout: 15 * time.Second,
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

		log.Printf("[ws] connecting to %s ...", c.url)

		conn, _, err := websocket.DefaultDialer.Dial(c.url, nil)
		if err != nil {
			log.Printf("[ws] connect failed: %v, retrying in %s", err, c.reconnectWait)
			time.Sleep(c.reconnectWait)
			continue
		}

		log.Printf("[ws] connected to %s", c.url)

		if c.signer != nil {
			if err := c.authenticate(conn); err != nil {
				log.Printf("[ws] control-channel auth failed: %v, retrying in %s", err, c.reconnectWait)
				conn.Close()
				time.Sleep(c.reconnectWait)
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

		c.mu.Lock()
		c.conn = nil
		c.mu.Unlock()

		log.Printf("[ws] disconnected, reconnecting in %s", c.reconnectWait)
		time.Sleep(c.reconnectWait)
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
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()

	if conn == nil {
		return fmt.Errorf("not connected")
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	msg := Message{
		Type:    msgType,
		Payload: data,
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	return conn.WriteJSON(msg)
}

// Close shuts down the client.
func (c *Client) Close() {
	close(c.done)
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
