package coordinator

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/wsauth"
	"golang.org/x/crypto/blake2b"
)

var readID = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
var readNonce = regexp.MustCompile(`^[0-9a-f]{32}$`)

type DeviceReadRequest struct {
	HumanID        string `json:"human_id"`
	GrantID        string `json:"grant_id"`
	DeviceAddress  string `json:"device_address"`
	OrganizationID string `json:"organization_id"`
	BindingID      string `json:"binding_id"`
	Method         string `json:"method"`
	Path           string `json:"path"`
	CommandHash    string `json:"command_hash,omitempty"`
	CommandScope   string `json:"command_scope,omitempty"`
}
type DeviceReadChallenge struct {
	DeviceReadRequest
	ChainIdentifier      string `json:"chain_identifier"`
	Nonce                string `json:"nonce"`
	ExpiresAtMS          int64  `json:"expires_at_ms"`
	CoordinatorPublicKey string `json:"coordinator_public_key"`
	Signature            string `json:"signature"`
}
type readPending struct {
	challenge DeviceReadChallenge
	pin       string
}
type DeviceReadAuth struct {
	chain, org, binding string
	signer              wsauth.Signer
	verify              func(context.Context, DeviceReadRequest) (string, error)
	mu                  sync.Mutex
	pending             map[string]readPending
	now                 func() time.Time
}

func NewDeviceReadAuth(chain, org, binding string, signer wsauth.Signer, verify func(context.Context, DeviceReadRequest) (string, error)) (*DeviceReadAuth, error) {
	if chain == "" || strings.Contains(chain, ":") || !readID.MatchString(org) || !readID.MatchString(binding) || signer == nil || len(signer.PublicKeyBytes()) != 32 || wsauth.DeriveAddress(signer.PublicKeyBytes()) != signer.Address() || verify == nil {
		return nil, fmt.Errorf("pinned Coordinator and device authority reader required")
	}
	return &DeviceReadAuth{chain: chain, org: org, binding: binding, signer: signer, verify: verify, pending: map[string]readPending{}, now: time.Now}, nil
}

func allowedReadPath(path string) bool {
	if path == "/api/sentinels" || path == "/api/health" {
		return true
	}
	parts := strings.Split(path, "/")
	return (len(parts) == 4 || len(parts) == 5 && parts[4] == "agents") && parts[0] == "" && parts[1] == "api" && parts[2] == "sentinels" && readID.MatchString(parts[3])
}
func (a *DeviceReadAuth) valid(r DeviceReadRequest) bool {
	base := readID.MatchString(r.HumanID) && readID.MatchString(r.GrantID) && readID.MatchString(r.DeviceAddress) && r.OrganizationID == a.org && r.BindingID == a.binding
	read := r.Method == http.MethodGet && allowedReadPath(r.Path) && r.CommandHash == "" && r.CommandScope == ""
	command := r.Method == http.MethodPost && allowedCommandPath(r.Path) && canonicalCommandHash(r.CommandHash) && (r.CommandScope == "observation" || r.CommandScope == "control")
	return base && (read || command)
}
func allowedCommandPath(path string) bool {
	parts := strings.Split(path, "/")
	return len(parts) == 5 && parts[0] == "" && parts[1] == "api" && parts[2] == "sentinels" && readID.MatchString(parts[3]) && parts[4] == "command"
}
func canonicalCommandHash(hash string) bool {
	raw, err := hex.DecodeString(hash)
	return err == nil && len(raw) == 32 && hex.EncodeToString(raw) == hash
}

// The read grant alone never admits a control request. Host execution also
// independently checks capability, target, budgets and the prepared Run.
func (r DeviceReadRequest) RequiredDeviceAction() byte {
	if r.Method == http.MethodPost && r.CommandScope == "control" {
		return 2
	}
	return 1
}
func readChallengeText(c DeviceReadChallenge) string {
	if c.Method == http.MethodPost {
		return strings.Join([]string{"FM-COORDINATOR-COMMAND", "1", c.ChainIdentifier, c.OrganizationID, c.BindingID, c.HumanID, c.GrantID, c.DeviceAddress, c.Method, c.Path, c.CommandScope, c.CommandHash, c.Nonce, strconv.FormatInt(c.ExpiresAtMS, 10)}, ":")
	}
	return strings.Join([]string{"FM-COORDINATOR-READ", "1", c.ChainIdentifier, c.OrganizationID, c.BindingID, c.HumanID, c.GrantID, c.DeviceAddress, c.Method, c.Path, c.Nonce, strconv.FormatInt(c.ExpiresAtMS, 10)}, ":")
}
func deviceProofText(c DeviceReadChallenge) string {
	return strings.Join([]string{"FM-DEVICE-PROOF", "1", c.ChainIdentifier, c.HumanID, c.GrantID, c.Nonce, strconv.FormatInt(c.ExpiresAtMS, 10)}, ":")
}

func (a *DeviceReadAuth) check(ctx context.Context, r DeviceReadRequest) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return a.verify(ctx, r)
}
func (a *DeviceReadAuth) issue(w http.ResponseWriter, r *http.Request) {
	var request DeviceReadRequest
	body, err := io.ReadAll(io.LimitReader(r.Body, 2049))
	if err != nil || len(body) > 2048 {
		writeJSON(w, 400, map[string]string{"error": "invalid_read_request"})
		return
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&request) != nil || decoder.Decode(new(any)) != io.EOF || !a.valid(request) {
		writeJSON(w, 400, map[string]string{"error": "invalid_read_request"})
		return
	}
	pin, err := a.check(r.Context(), request)
	if err != nil || pin == "" {
		writeJSON(w, 403, map[string]string{"error": "device_authority_unavailable"})
		return
	}
	nonce := make([]byte, 16)
	if _, err = rand.Read(nonce); err != nil {
		writeJSON(w, 503, map[string]string{"error": "challenge_unavailable"})
		return
	}
	c := DeviceReadChallenge{DeviceReadRequest: request, ChainIdentifier: a.chain, Nonce: hex.EncodeToString(nonce), ExpiresAtMS: a.now().Add(time.Minute).UnixMilli(), CoordinatorPublicKey: hex.EncodeToString(a.signer.PublicKeyBytes())}
	c.Signature = hex.EncodeToString(a.signer.Sign([]byte(readChallengeText(c))))
	a.mu.Lock()
	for key, entry := range a.pending {
		if entry.challenge.ExpiresAtMS <= a.now().UnixMilli() {
			delete(a.pending, key)
		}
	}
	if len(a.pending) >= 256 {
		a.mu.Unlock()
		writeJSON(w, 429, map[string]string{"error": "challenge_capacity"})
		return
	}
	a.pending[c.Nonce] = readPending{c, pin}
	a.mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, c)
}

func verifyPersonalRead(signature string, c DeviceReadChallenge) bool {
	if len(signature) != 132 {
		return false
	}
	raw, err := base64.StdEncoding.DecodeString(signature)
	if err != nil || len(raw) != 97 || raw[0] != 0 || base64.StdEncoding.EncodeToString(raw) != signature || wsauth.DeriveAddress(raw[65:]) != c.DeviceAddress {
		return false
	}
	message := []byte(deviceProofText(c))
	intent := []byte{3, 0, 0}
	length := uint32(len(message))
	for length >= 128 {
		intent = append(intent, byte(length)|128)
		length >>= 7
	}
	intent = append(intent, byte(length))
	intent = append(intent, message...)
	hash := blake2b.Sum256(intent)
	return ed25519.Verify(raw[65:], hash[:], raw[1:65])
}

type readProof struct {
	Nonce     string `json:"nonce"`
	Signature string `json:"signature"`
}

func (a *DeviceReadAuth) authorize(r *http.Request) (readPending, error) {
	const prefix = "FractalMind "
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, prefix) || len(header) > 512 {
		return readPending{}, fmt.Errorf("proof required")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(header, prefix))
	if err != nil {
		return readPending{}, err
	}
	var proof readProof
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&proof) != nil || decoder.Decode(new(any)) != io.EOF || !readNonce.MatchString(proof.Nonce) {
		return readPending{}, fmt.Errorf("invalid proof")
	}
	a.mu.Lock()
	entry, ok := a.pending[proof.Nonce]
	a.mu.Unlock()
	if !ok || entry.challenge.ExpiresAtMS <= a.now().UnixMilli() || r.Method != entry.challenge.Method || r.URL.Path != entry.challenge.Path || r.URL.RawQuery != "" || r.URL.RawPath != "" || !verifyPersonalRead(proof.Signature, entry.challenge) {
		return readPending{}, fmt.Errorf("proof does not match this read")
	}
	if entry.challenge.Method == http.MethodPost {
		if err := validateCommandRequest(r, entry.challenge, a.now().UnixMilli()); err != nil {
			return readPending{}, err
		}
	}
	// A valid proof is consumed once, before network reads or directory output.
	a.mu.Lock()
	_, ok = a.pending[proof.Nonce]
	if ok {
		delete(a.pending, proof.Nonce)
	}
	a.mu.Unlock()
	if !ok {
		return readPending{}, fmt.Errorf("read already consumed")
	}
	pin, err := a.check(r.Context(), entry.challenge.DeviceReadRequest)
	if err != nil || pin != entry.pin || entry.challenge.ExpiresAtMS <= a.now().UnixMilli() {
		return readPending{}, fmt.Errorf("device authority changed")
	}
	return entry, nil
}

func validateCommandRequest(r *http.Request, c DeviceReadChallenge, now int64) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, (1<<20)+1))
	if err != nil || len(body) > 1<<20 {
		return fmt.Errorf("invalid command size")
	}
	hash := sha256.Sum256(body)
	if hex.EncodeToString(hash[:]) != c.CommandHash {
		return fmt.Errorf("command body changed")
	}
	var packet struct {
		Command nodecommand.NodeCommand `json:"node_command"`
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&packet) != nil || decoder.Decode(new(any)) != io.EOF {
		return fmt.Errorf("invalid signed command")
	}
	command := packet.Command
	parts := strings.Split(c.Path, "/")
	read := command.Action == "inventory" || command.Action == "status" || command.Action == "monitor" || command.Action == "logs" || command.Action == "health" || command.Action == "availability"
	control := command.Action == "start" || command.Action == "stop" || command.Action == "assign" || command.Action == "direct.message"
	if command.Version != "1" || command.IssuedAtMS <= 0 || command.IssuedAtMS > now+30_000 || command.ExpiresAtMS <= now || command.ExpiresAtMS <= command.IssuedAtMS || command.ExpiresAtMS-command.IssuedAtMS > 300_000 || command.Signer != c.DeviceAddress || command.Target.OrganizationID != c.OrganizationID || command.Target.NodeID != parts[3] || command.Scope != c.CommandScope || !(read && command.Scope == "observation" || control && command.Scope == "control") || control && command.Target.AgentID == "" || nodecommand.HashPayload(command.Payload) != command.PayloadHash {
		return fmt.Errorf("signed command scope mismatch")
	}
	signing, err := command.SigningBytes()
	if err != nil {
		return err
	}
	if err := (nodecommand.Ed25519Verifier{}).Verify(r.Context(), command.Signer, signing, command.Signature); err != nil {
		return err
	}
	// Preserve the exact hashed bytes for the existing handler. This is a relay
	// check, never permission to execute without envd's current chain checks.
	r.Body = io.NopCloser(bytes.NewReader(body))
	return nil
}

type bufferedRead struct {
	header   http.Header
	status   int
	body     bytes.Buffer
	overflow bool
}

func (w *bufferedRead) Header() http.Header { return w.header }
func (w *bufferedRead) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}
func (w *bufferedRead) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	if w.body.Len()+len(data) > 512<<10 {
		w.overflow = true
		return len(data), nil
	}
	return w.body.Write(data)
}

func (a *DeviceReadAuth) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		// No cookies or origin-based authority. Any origin can attempt a proof;
		// only a native-held key with a fresh chain grant can read the data.
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		if r.URL.Path == "/api/device-challenge" && r.Method == http.MethodPost && r.URL.RawQuery == "" && r.URL.RawPath == "" {
			a.issue(w, r)
			return
		}
		entry, err := a.authorize(r)
		if err != nil {
			writeJSON(w, 403, map[string]string{"error": "device_read_rejected"})
			return
		}
		buffer := &bufferedRead{header: http.Header{}}
		next.ServeHTTP(buffer, r)
		pin, err := a.check(r.Context(), entry.challenge.DeviceReadRequest)
		if err != nil || pin != entry.pin || entry.challenge.ExpiresAtMS <= a.now().UnixMilli() || buffer.overflow {
			writeJSON(w, 403, map[string]string{"error": "device_read_changed"})
			return
		}
		if buffer.status == 0 {
			buffer.status = 200
		}
		body := buffer.body.Bytes()
		hash := sha256.Sum256(body)
		text := strings.Join([]string{"FM-COORDINATOR-RESPONSE", "1", a.chain, a.org, a.binding, entry.challenge.Nonce, entry.challenge.Method, entry.challenge.Path, strconv.Itoa(buffer.status), hex.EncodeToString(hash[:])}, ":")
		writeJSON(w, buffer.status, map[string]any{"nonce": entry.challenge.Nonce, "body": base64.StdEncoding.EncodeToString(body), "signature": hex.EncodeToString(a.signer.Sign([]byte(text)))})
	})
}
