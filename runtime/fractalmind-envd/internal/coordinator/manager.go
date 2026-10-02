package coordinator

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/agent"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/heartbeat"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/ws"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/wsauth"
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
	DesktopURL    string                   `json:"desktop_url,omitempty"`
}

type registerPayload struct {
	HostID     string `json:"host_id"`
	Hostname   string `json:"hostname"`
	Version    string `json:"version"`
	DesktopURL string `json:"desktop_url"`
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
	conn     *nodeConn
}

// desktopSignalResult mirrors ws.DesktopSignalResult for the coordinator side.
type desktopSignalResult struct {
	RequestID string          `json:"request_id"`
	Status    int             `json:"status"`
	Body      json.RawMessage `json:"body,omitempty"`
	Error     string          `json:"error,omitempty"`
}

type pendingSignal struct {
	resultCh chan desktopSignalResult
	conn     *nodeConn
}

type nodeConn struct {
	ws      *websocket.Conn
	writeMu sync.Mutex
	address string
	public  []byte
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
	pendingSignals  map[string]*pendingSignal
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
	workerAuthority  func(context.Context, string, []byte) error
}

func NewManager(commandTimeout time.Duration) *Manager {
	if commandTimeout <= 0 {
		commandTimeout = 30 * time.Second
	}

	return &Manager{
		nodes:            make(map[string]*connectedNode),
		pendingCommands:  make(map[string]*pendingCommand),
		pendingSignals:   make(map[string]*pendingSignal),
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

// SetWorkerAuthority is configured before serving. A successful signature
// authenticates a key; this reader separately proves current chain admission.
func (m *Manager) SetWorkerAuthority(authorize func(context.Context, string, []byte) error) {
	m.workerAuthority = authorize
}

func (m *Manager) authorizeWorker(conn *nodeConn) error {
	if m.workerAuthority == nil {
		return nil
	}
	if conn.address == "" || len(conn.public) != 32 {
		return fmt.Errorf("authenticated Host identity required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return m.workerAuthority(ctx, conn.address, conn.public)
}

func (m *Manager) tempID() string {
	return fmt.Sprintf("temp-%d", atomic.AddUint64(&m.nextTempID, 1))
}

func (m *Manager) commandID() string {
	return fmt.Sprintf("cmd-%d", atomic.AddUint64(&m.nextCommandID, 1))
}

func (m *Manager) HandleConnection(conn *websocket.Conn) {
	nodeID := m.tempID()
	client := &nodeConn{ws: conn}
	defer func() { m.removeConnection(nodeID, client); conn.Close() }()

	if m.signer != nil {
		addr, public, err := m.authenticate(conn)
		if err != nil {
			log.Printf("[coordinator] worker %s auth rejected: %v", nodeID, err)
			conn.Close()
			return
		}
		log.Printf("[coordinator] worker %s authenticated as %s", nodeID, addr)
		client.address, client.public = addr, public
	} else {
		if m.workerAuthority != nil {
			return
		}
		log.Printf("[coordinator] WARNING: worker %s connected without control-channel auth (no signer configured)", nodeID)
	}

	log.Printf("[coordinator] new worker connection: %s", nodeID)

	for {
		var msg ws.Message
		if err := conn.ReadJSON(&msg); err != nil {
			log.Printf("[coordinator] worker %s disconnected: %v", nodeID, err)
			return
		}

		nextID, err := m.handleMessage(nodeID, client, msg)
		if err != nil {
			log.Printf("[coordinator] invalid message from %s: %v", nodeID, err)
			if client.address != "" || m.workerAuthority != nil {
				return
			}
			continue
		}
		nodeID = nextID
	}
}

// authenticate runs the coordinator side of the mutual challenge-response. It
// proves the coordinator's identity over the worker-issued nonce, then verifies
// the worker's proof over a coordinator-issued nonce and checks the allowlist.
// It returns the verified worker SUI address on success.
func (m *Manager) authenticate(conn *websocket.Conn) (string, []byte, error) {
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
		return "", nil, fmt.Errorf("read auth_init: %w", err)
	}
	clientNonce, err := wsauth.DecodeNonce(init.ClientNonce)
	if err != nil {
		return "", nil, fmt.Errorf("bad client nonce: %w", err)
	}

	// Step 2: prove our identity over the worker nonce and issue our own.
	serverNonce, serverNonceHex, err := wsauth.NewNonce()
	if err != nil {
		return "", nil, err
	}
	challenge := wsauth.ChallengePayload{
		ServerNonce: serverNonceHex,
		Proof:       wsauth.Prove(m.signer, clientNonce),
	}
	if err := writeTyped(conn, wsauth.MsgAuthChallenge, challenge); err != nil {
		return "", nil, fmt.Errorf("send auth_challenge: %w", err)
	}

	// Step 3: verify the worker's proof over our nonce.
	var resp wsauth.ResponsePayload
	if err := readTyped(conn, wsauth.MsgAuthResponse, &resp); err != nil {
		return "", nil, fmt.Errorf("read auth_response: %w", err)
	}
	addr, err := wsauth.VerifyProof(resp.Proof, serverNonce)
	if err != nil {
		_ = writeTyped(conn, wsauth.MsgAuthError, wsauth.ErrorPayload{Reason: "invalid worker proof"})
		return "", nil, fmt.Errorf("worker identity invalid: %w", err)
	}
	if !wsauth.AddressAllowed(addr, m.allowedSigners) {
		_ = writeTyped(conn, wsauth.MsgAuthError, wsauth.ErrorPayload{Reason: "worker not authorized"})
		return "", nil, fmt.Errorf("worker %s not in allowed_signers", addr)
	}
	public, _ := hex.DecodeString(resp.Proof.PublicKey) // VerifyProof already checked length and derivation.
	if err := m.authorizeWorker(&nodeConn{address: addr, public: public}); err != nil {
		_ = writeTyped(conn, wsauth.MsgAuthError, wsauth.ErrorPayload{Reason: "Host admission unavailable"})
		return "", nil, err
	}

	if err := writeTyped(conn, wsauth.MsgAuthOK, struct{}{}); err != nil {
		return "", nil, fmt.Errorf("send auth_ok: %w", err)
	}
	return addr, public, nil
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
	if err := m.authorizeWorker(conn); err != nil {
		return currentID, err
	}
	switch msg.Type {
	case "register":
		var payload registerPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			return currentID, fmt.Errorf("decode register payload: %w", err)
		}

		nodeID := payload.HostID
		if conn.address != "" {
			if payload.HostID != conn.address {
				return currentID, fmt.Errorf("host_id differs from authenticated signing address")
			}
			nodeID = conn.address
		}
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
				DesktopURL:  payload.DesktopURL,
				ConnectedAt: now,
				Agents:      []agent.Agent{},
			},
			conn: conn,
		}

		m.mu.Lock()
		if existing, ok := m.nodes[nodeID]; ok && existing.conn != conn {
			m.mu.Unlock()
			return currentID, fmt.Errorf("Host already has an active connection")
		}
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
		if conn.address != "" && payload.HostID != conn.address {
			return currentID, fmt.Errorf("heartbeat Host identity mismatch")
		}

		now := time.Now()

		m.mu.Lock()
		if node, ok := m.nodes[currentID]; ok && node.conn == conn {
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
		if ok && pending.conn == conn {
			delete(m.pendingCommands, payload.RequestID)
		} else {
			ok = false
		}
		m.mu.Unlock()

		if ok {
			pending.resultCh <- payload.Result
		}

		return currentID, nil

	case "desktop_signal_result":
		var payload desktopSignalResult
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			return currentID, fmt.Errorf("decode desktop_signal_result payload: %w", err)
		}

		m.mu.Lock()
		pending, ok := m.pendingSignals[payload.RequestID]
		if ok && pending.conn == conn {
			delete(m.pendingSignals, payload.RequestID)
		} else {
			ok = false
		}
		m.mu.Unlock()

		if ok {
			pending.resultCh <- payload
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
		if err := m.authorizeWorker(conn); err != nil {
			conn.Close()
			continue
		}
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
	if m.workerAuthority != nil {
		return nodeSnapshot{}, false
	}

	for _, node := range m.nodes {
		if node.Hostname == id {
			return cloneSnapshot(node.nodeSnapshot), true
		}
	}

	return nodeSnapshot{}, false
}

// lookupNode finds a connected node by ID or, failing that, by hostname.
func (m *Manager) lookupNode(nodeID string) (*connectedNode, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if node, ok := m.nodes[nodeID]; ok {
		return node, true
	}
	if m.workerAuthority != nil {
		return nil, false
	}
	for _, candidate := range m.nodes {
		if candidate.Hostname == nodeID {
			return candidate, true
		}
	}
	return nil, false
}

func (m *Manager) SendCommand(nodeID, command, agentID, args string) (map[string]interface{}, error) {
	node, ok := m.lookupNode(nodeID)
	if !ok {
		return nil, fmt.Errorf("worker %s not found", nodeID)
	}
	if err := m.authorizeWorker(node.conn); err != nil {
		m.removeConnection(node.ID, node.conn)
		node.conn.Close()
		return nil, err
	}

	requestID := m.commandID()
	pending := &pendingCommand{resultCh: make(chan map[string]interface{}, 1), conn: node.conn}

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

// SendDesktopSignal relays a remote-desktop signaling request (method+path with
// an optional JSON body) to the target worker over the control channel and
// returns the envd-desktop server's status code and response body.
func (m *Manager) SendDesktopSignal(nodeID, method, path string, body []byte) (int, []byte, error) {
	node, ok := m.lookupNode(nodeID)
	if !ok {
		return 0, nil, fmt.Errorf("worker %s not found", nodeID)
	}
	if err := m.authorizeWorker(node.conn); err != nil {
		m.removeConnection(node.ID, node.conn)
		node.conn.Close()
		return 0, nil, err
	}

	requestID := m.commandID()
	pending := &pendingSignal{resultCh: make(chan desktopSignalResult, 1), conn: node.conn}

	m.mu.Lock()
	m.pendingSignals[requestID] = pending
	m.mu.Unlock()

	envelope := ws.Message{
		Type: "desktop_signal",
		Payload: mustRawJSON(map[string]interface{}{
			"request_id": requestID,
			"method":     method,
			"path":       path,
			"body":       json.RawMessage(body),
		}),
	}

	if err := node.conn.WriteJSON(envelope); err != nil {
		m.mu.Lock()
		delete(m.pendingSignals, requestID)
		m.mu.Unlock()
		return 0, nil, fmt.Errorf("send desktop signal: %w", err)
	}

	select {
	case res := <-pending.resultCh:
		if res.Error != "" {
			return res.Status, res.Body, fmt.Errorf("%s", res.Error)
		}
		return res.Status, res.Body, nil
	case <-time.After(m.commandTimeout):
		m.mu.Lock()
		delete(m.pendingSignals, requestID)
		m.mu.Unlock()
		return 0, nil, fmt.Errorf("desktop signal timed out after %s", m.commandTimeout)
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

func (m *Manager) removeConnection(nodeID string, conn *nodeConn) {
	m.mu.Lock()
	if node, ok := m.nodes[nodeID]; ok && node.conn == conn {
		delete(m.nodes, nodeID)
	}
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
