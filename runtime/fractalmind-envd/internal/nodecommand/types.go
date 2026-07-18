package nodecommand

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

const (
	ProtocolVersion = "1"
	SignatureDomain = "fractalmind.node-command.v1"
)

// Target identifies the organization, node, and optional local agent that a
// command is allowed to affect.
type Target struct {
	OrganizationID string `json:"organization_id"`
	NodeID         string `json:"node_id"`
	AgentID        string `json:"agent_id,omitempty"`
}

// CapabilityRef points to the authority-plane object used for authorization.
// RevocationVersion is the latest checkpoint known when the intent was signed.
type CapabilityRef struct {
	ID                string `json:"id"`
	RevocationVersion uint64 `json:"revocation_version"`
}

// BudgetClaim declares the maximum authority-plane budget this command may
// consume, expressed in the asset's smallest integer unit.
type BudgetClaim struct {
	Asset  string `json:"asset"`
	Amount uint64 `json:"amount"`
}

// NodeCommand is the versioned privileged-command envelope transported by
// coordinators or relays and finally authorized by the target envd.
type NodeCommand struct {
	Version        string          `json:"version"`
	CommandID      string          `json:"command_id"`
	Signer         string          `json:"signer"`
	Target         Target          `json:"target"`
	Action         string          `json:"action"`
	Scope          string          `json:"scope"`
	Capability     CapabilityRef   `json:"capability"`
	Nonce          string          `json:"nonce"`
	IssuedAtMS     int64           `json:"issued_at_ms"`
	ExpiresAtMS    int64           `json:"expires_at_ms"`
	IdempotencyKey string          `json:"idempotency_key"`
	Budget         *BudgetClaim    `json:"budget,omitempty"`
	Payload        json.RawMessage `json:"payload,omitempty"`
	PayloadHash    string          `json:"payload_hash"`
	Signature      string          `json:"signature"`
}

// NodeEvent is the result/evidence envelope returned through the data plane.
type NodeEvent struct {
	Version      string `json:"version"`
	EventID      string `json:"event_id"`
	CommandID    string `json:"command_id"`
	Target       Target `json:"target"`
	Type         string `json:"type"`
	ResultCode   string `json:"result_code"`
	ResultHash   string `json:"result_hash,omitempty"`
	EvidenceHash string `json:"evidence_hash,omitempty"`
	OccurredAtMS int64  `json:"occurred_at_ms"`
}

// CanonicalBytes returns the stable JSON representation used by transports,
// result caching, and cross-repository golden vectors.
func (e NodeEvent) CanonicalBytes() ([]byte, error) {
	return json.Marshal(e)
}

type signingEnvelope struct {
	Domain         string        `json:"domain"`
	Version        string        `json:"version"`
	CommandID      string        `json:"command_id"`
	Signer         string        `json:"signer"`
	Target         Target        `json:"target"`
	Action         string        `json:"action"`
	Scope          string        `json:"scope"`
	Capability     CapabilityRef `json:"capability"`
	Nonce          string        `json:"nonce"`
	IssuedAtMS     int64         `json:"issued_at_ms"`
	ExpiresAtMS    int64         `json:"expires_at_ms"`
	IdempotencyKey string        `json:"idempotency_key"`
	Budget         *BudgetClaim  `json:"budget,omitempty"`
	PayloadHash    string        `json:"payload_hash"`
}

// SigningBytes returns the canonical JSON bytes covered by Signature. Payload
// bytes are represented only by PayloadHash to keep serialization stable.
func (c NodeCommand) SigningBytes() ([]byte, error) {
	return json.Marshal(signingEnvelope{
		Domain:         SignatureDomain,
		Version:        c.Version,
		CommandID:      c.CommandID,
		Signer:         c.Signer,
		Target:         c.Target,
		Action:         c.Action,
		Scope:          c.Scope,
		Capability:     c.Capability,
		Nonce:          c.Nonce,
		IssuedAtMS:     c.IssuedAtMS,
		ExpiresAtMS:    c.ExpiresAtMS,
		IdempotencyKey: c.IdempotencyKey,
		Budget:         c.Budget,
		PayloadHash:    c.PayloadHash,
	})
}

func HashPayload(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func hashBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
