package coordinator

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fractalmind-ai/fractalmind-envd/internal/agent"
	"github.com/fractalmind-ai/fractalmind-envd/internal/heartbeat"
	"github.com/fractalmind-ai/fractalmind-envd/internal/ws"
	"github.com/fractalmind-ai/fractalmind-envd/internal/wsauth"
	"github.com/gorilla/websocket"
)

type nodeSnapshot struct {
	ID            string                   `json:"id"`
	HostID        string                   `json:"host_id"`
	Hostname      string                   `json:"hostname"`
	Version       string                   `json:"version"`
	ConnectedAt   time.Time                `json:"connected_at"`
	LastHeartbeat *time.Time               `json:"last_heartbeat"`
	Agents        []agent.Agent            `json:"agents"`
	System        *heartbeat.SystemInfo    `json:"system"`
	UptimeSeconds int64                    `json:"uptime_seconds"`
	RelayLoad     *heartbeat.RelayLoadInfo `json:"relay_load,omitempty"`
}

type registerPayload struct {
	HostID   string `json:"host_id"`
	Hostname string `json:"hostname"`
	Version  string `json:"version"`
}

type commandResultPayload struct {
	RequestID string                 `json:"request_id"`
	Result    map[string]interface{} `json:"result"`
}

type alertPayload struct {
	Type    string `json:"type"`
	Agent   string `json:"agent"`
	Session string `json:"session"`
	Message string `json:"message"`
}

type pendingCommand struct {
	resultCh chan map[string]interface{}
}

type nodeConn struct {
	ws      *websocket.Conn
	writeMu sync.Mutex
}

func (c *nodeConn) WriteJSON(v interface{}) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.ws.WriteJSON(v)
}

func (c *nodeConn) Close() error {
	return c.ws.Close()
}

type connectedNode struct {
	nodeSnapshot
	conn *nodeConn
}

// Manager tracks connected envd workers and proxies REST commands to them.
type Manager struct {
	mu              sync.RWMutex
	nodes           map[string]*connectedNode
	pendingCommands map[string]*pendingCommand
	commandTimeout  time.Duration
	nextTempID      uint64
	nextCommandID   uint64

	// Control-channel authentication. When signer is set, every worker must
	// complete the mutual challenge-response in HandleConnection before any
	// message is processed. allowedSigners, when non-empty, restricts which
	// verified SUI identities may register (authorization); empty means any
	// authenticated identity is accepted.
	signer           wsauth.Signer
	allowedSigners   []string
	handshakeTimeout time.Duration
}

func NewManager(commandTimeout time.Duration) *Manager {
	if commandTimeout <= 0 {
		commandTimeout = 30 * time.Second
	}

	return &Manager{
		nodes:            make(map[string]*connectedNode),
		pendingCommands:  make(map[string]*pendingCommand),
		commandTimeout:   commandTimeout,
		handshakeTimeout: 15 * time.Second,
	}
}

// SetAuth enables control-channel authentication with the coordinator's SUI
// keypair and an optional worker allowlist.
func (m *Manager) SetAuth(signer wsauth.Signer, allowedSigners []string) {
	m.signer = signer
	m.allowedSigners = allowedSigners
}

func (m *Manager) tempID() string {
	return fmt.Sprintf("temp-%d", atomic.AddUint64(&m.nextTempID, 1))
}

func (m *Manager) commandID() string {
	return fmt.Sprintf("cmd-%d", atomic.AddUint64(&m.nextCommandID, 1))
}

func (m *Manager) HandleConnection(conn *websocket.Conn) {
	nodeID := m.tempID()

	if m.signer != nil {
		addr, err := m.authenticate(conn)
		if err != nil {
			log.Printf("[coordinator] worker %s auth rejected: %v", nodeID, err)
			conn.Close()
			return
		}
		log.Printf("[coordinator] worker %s authenticated as %s", nodeID, addr)
	} else {
		log.Printf("[coordinator] WARNING: worker %s connected without control-channel auth (no signer configured)", nodeID)
	}

	client := &nodeConn{ws: conn}
	log.Printf("[coordinator] new worker connection: %s", nodeID)

	for {
		var msg ws.Message
		if err := conn.ReadJSON(&msg); err != nil {
			log.Printf("[coordinator] worker %s disconnected: %v", nodeID, err)
			m.removeNode(nodeID)
			return
		}

		nextID, err := m.handleMessage(nodeID, client, msg)
		if err != nil {
			log.Printf("[coordinator] invalid message from %s: %v", nodeID, err)
			continue
		}
		nodeID = nextID
	}
}

// authenticate runs the coordinator side of the mutual challenge-response. It
// proves the coordinator's identity over the worker-issued nonce, then verifies
// the worker's proof over a coordinator-issued nonce and checks the allowlist.
// It returns the verified worker SUI address on success.
func (m *Manager) authenticate(conn *websocket.Conn) (string, error) {
	deadline := time.Now().Add(m.handshakeTimeout)
	_ = conn.SetReadDeadline(deadline)
	_ = conn.SetWriteDeadline(deadline)
	defer func() {
		_ = conn.SetReadDeadline(time.Time{})
		_ = conn.SetWriteDeadline(time.Time{})
	}()

	// Step 1: receive the worker's challenge nonce.
	var init wsauth.InitPayload
	if err := readTyped(conn, wsauth.MsgAuthInit, &init); err != nil {
		return "", fmt.Errorf("read auth_init: %w", err)
	}
	clientNonce, err := wsauth.DecodeNonce(init.ClientNonce)
	if err != nil {
		return "", fmt.Errorf("bad client nonce: %w", err)
	}

	// Step 2: prove our identity over the worker nonce and issue our own.
	serverNonce, serverNonceHex, err := wsauth.NewNonce()
	if err != nil {
		return "", err
	}
	challenge := wsauth.ChallengePayload{
		ServerNonce: serverNonceHex,
		Proof:       wsauth.Prove(m.signer, clientNonce),
	}
	if err := writeTyped(conn, wsauth.MsgAuthChallenge, challenge); err != nil {
		return "", fmt.Errorf("send auth_challenge: %w", err)
	}

	// Step 3: verify the worker's proof over our nonce.
	var resp wsauth.ResponsePayload
	if err := readTyped(conn, wsauth.MsgAuthResponse, &resp); err != nil {
		return "", fmt.Errorf("read auth_response: %w", err)
	}
	addr, err := wsauth.VerifyProof(resp.Proof, serverNonce)
	if err != nil {
		_ = writeTyped(conn, wsauth.MsgAuthError, wsauth.ErrorPayload{Reason: "invalid worker proof"})
		return "", fmt.Errorf("worker identity invalid: %w", err)
	}
	if !wsauth.AddressAllowed(addr, m.allowedSigners) {
		_ = writeTyped(conn, wsauth.MsgAuthError, wsauth.ErrorPayload{Reason: "worker not authorized"})
		return "", fmt.Errorf("worker %s not in allowed_signers", addr)
	}

	if err := writeTyped(conn, wsauth.MsgAuthOK, struct{}{}); err != nil {
		return "", fmt.Errorf("send auth_ok: %w", err)
	}
	return addr, nil
}

func writeTyped(conn *websocket.Conn, msgType string, payload interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return conn.WriteJSON(ws.Message{Type: msgType, Payload: data})
}

func readTyped(conn *websocket.Conn, wantType string, out interface{}) error {
	var raw ws.Message
	if err := conn.ReadJSON(&raw); err != nil {
		return err
	}
	if raw.Type != wantType {
		return fmt.Errorf("expected %q, got %q", wantType, raw.Type)
	}
	return json.Unmarshal(raw.Payload, out)
}

func (m *Manager) handleMessage(currentID string, conn *nodeConn, msg ws.Message) (string, error) {
	switch msg.Type {
	case "register":
		var payload registerPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			return currentID, fmt.Errorf("decode register payload: %w", err)
		}

		nodeID := payload.HostID
		if nodeID == "" {
			nodeID = payload.Hostname
		}
		if nodeID == "" {
			nodeID = currentID
		}

		now := time.Now()
		node := &connectedNode{
			nodeSnapshot: nodeSnapshot{
				ID:          nodeID,
				HostID:      payload.HostID,
				Hostname:    payload.Hostname,
				Version:     payload.Version,
				ConnectedAt: now,
				Agents:      []agent.Agent{},
			},
			conn: conn,
		}

		m.mu.Lock()
		if currentID != nodeID {
			delete(m.nodes, currentID)
		}
		m.nodes[nodeID] = node
		m.mu.Unlock()

		log.Printf("[coordinator] worker registered: %s (%s, v%s)", nodeID, payload.Hostname, payload.Version)
		return nodeID, nil

	case "heartbeat":
		var payload heartbeat.Payload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			return currentID, fmt.Errorf("decode heartbeat payload: %w", err)
		}

		now := time.Now()

		m.mu.Lock()
		if node, ok := m.nodes[currentID]; ok {
			node.LastHeartbeat = &now
			node.Agents = append([]agent.Agent(nil), payload.Agents...)
			system := payload.System
			node.System = &system
			node.UptimeSeconds = payload.Uptime
			if payload.RelayLoad != nil {
				relayLoad := *payload.RelayLoad
				node.RelayLoad = &relayLoad
			} else {
				node.RelayLoad = nil
			}
		}
		m.mu.Unlock()

		return currentID, nil

	case "command_result":
		var payload commandResultPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			return currentID, fmt.Errorf("decode command_result payload: %w", err)
		}

		m.mu.Lock()
		pending, ok := m.pendingCommands[payload.RequestID]
		if ok {
			delete(m.pendingCommands, payload.RequestID)
		}
		m.mu.Unlock()

		if ok {
			pending.resultCh <- payload.Result
		}

		return currentID, nil

	case "alert":
		var payload alertPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			return currentID, fmt.Errorf("decode alert payload: %w", err)
		}
		log.Printf("[coordinator] alert from %s: %s (%s)", currentID, payload.Type, payload.Message)
		return currentID, nil

	case "pong":
		return currentID, nil

	default:
		log.Printf("[coordinator] unknown message type from %s: %s", currentID, msg.Type)
		return currentID, nil
	}
}

func (m *Manager) PingAll() {
	nodes := m.connections()
	for _, conn := range nodes {
		if err := conn.WriteJSON(ws.Message{Type: "ping"}); err != nil {
			log.Printf("[coordinator] ping failed: %v", err)
		}
	}
}

func (m *Manager) ListNodes() []nodeSnapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()

	nodes := make([]nodeSnapshot, 0, len(m.nodes))
	for _, node := range m.nodes {
		nodes = append(nodes, cloneSnapshot(node.nodeSnapshot))
	}

	return nodes
}

func (m *Manager) FindNode(id string) (nodeSnapshot, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if node, ok := m.nodes[id]; ok {
		return cloneSnapshot(node.nodeSnapshot), true
	}

	for _, node := range m.nodes {
		if node.Hostname == id {
			return cloneSnapshot(node.nodeSnapshot), true
		}
	}

	return nodeSnapshot{}, false
}

func (m *Manager) SendCommand(nodeID, command, agentID, args string) (map[string]interface{}, error) {
	m.mu.RLock()
	node, ok := m.nodes[nodeID]
	if !ok {
		for _, candidate := range m.nodes {
			if candidate.Hostname == nodeID {
				node = candidate
				ok = true
				break
			}
		}
	}
	m.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("worker %s not found", nodeID)
	}

	requestID := m.commandID()
	pending := &pendingCommand{resultCh: make(chan map[string]interface{}, 1)}

	m.mu.Lock()
	m.pendingCommands[requestID] = pending
	m.mu.Unlock()

	envelope := ws.Message{
		Type: "command",
		Payload: mustRawJSON(ws.CommandPayload{
			Command:   command,
			AgentID:   agentID,
			Args:      args,
			RequestID: requestID,
		}),
	}

	if err := node.conn.WriteJSON(envelope); err != nil {
		m.mu.Lock()
		delete(m.pendingCommands, requestID)
		m.mu.Unlock()
		return nil, fmt.Errorf("send command: %w", err)
	}

	select {
	case result := <-pending.resultCh:
		return result, nil
	case <-time.After(m.commandTimeout):
		m.mu.Lock()
		delete(m.pendingCommands, requestID)
		m.mu.Unlock()
		return nil, fmt.Errorf("command timed out after %s", m.commandTimeout)
	}
}

func (m *Manager) Close() {
	for _, conn := range m.connections() {
		_ = conn.Close()
	}
}

func (m *Manager) connections() []*nodeConn {
	m.mu.RLock()
	defer m.mu.RUnlock()

	conns := make([]*nodeConn, 0, len(m.nodes))
	for _, node := range m.nodes {
		conns = append(conns, node.conn)
	}
	return conns
}

func (m *Manager) removeNode(nodeID string) {
	m.mu.Lock()
	delete(m.nodes, nodeID)
	m.mu.Unlock()
}

func cloneSnapshot(node nodeSnapshot) nodeSnapshot {
	cloned := node
	cloned.Agents = append([]agent.Agent(nil), node.Agents...)
	if node.System != nil {
		system := *node.System
		cloned.System = &system
	}
	if node.RelayLoad != nil {
		relayLoad := *node.RelayLoad
		cloned.RelayLoad = &relayLoad
	}
	return cloned
}

func mustRawJSON(v interface{}) json.RawMessage {
	data, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return data
}
