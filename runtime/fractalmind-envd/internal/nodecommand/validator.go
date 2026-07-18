package nodecommand

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type SignatureVerifier interface {
	Verify(ctx context.Context, signer string, payload []byte, signature string) error
}

type CapabilityResolver interface {
	Resolve(ctx context.Context, ref CapabilityRef) (CapabilityState, error)
}

// CapabilityState is an authority-plane projection. Implementations may load
// it from SUI RPC, an indexer, or a bounded local cache.
type CapabilityState struct {
	ID                     string
	Target                 Target
	AuthorizedSigners      []string
	Actions                []string
	Scopes                 []string
	ExpiresAtMS            int64
	Revoked                bool
	RevocationVersion      uint64
	CheckpointObservedAtMS int64
}

type ValidatorOptions struct {
	Now                      func() time.Time
	LocalTarget              Target
	MaxClockSkew             time.Duration
	MaxCommandTTL            time.Duration
	MaxLowRiskCheckpointAge  time.Duration
	MaxHighRiskCheckpointAge time.Duration
	LowRiskActions           map[string]struct{}
	HighRiskActions          map[string]struct{}
}

type ValidationResult struct {
	Duplicate           bool
	AuthorityCheckpoint uint64
}

type Validator struct {
	signatures SignatureVerifier
	authority  CapabilityResolver
	replay     ReplayGuard
	options    ValidatorOptions
}

func NewValidator(signatures SignatureVerifier, authority CapabilityResolver, replay ReplayGuard, options ValidatorOptions) *Validator {
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.MaxClockSkew <= 0 {
		options.MaxClockSkew = 30 * time.Second
	}
	if options.MaxCommandTTL <= 0 {
		options.MaxCommandTTL = 5 * time.Minute
	}
	if options.MaxLowRiskCheckpointAge <= 0 {
		options.MaxLowRiskCheckpointAge = 24 * time.Hour
	}
	if options.MaxHighRiskCheckpointAge <= 0 {
		options.MaxHighRiskCheckpointAge = 2 * time.Minute
	}
	if replay == nil {
		replay = NewMemoryReplayGuard()
	}
	return &Validator{signatures: signatures, authority: authority, replay: replay, options: options}
}

func (v *Validator) Validate(ctx context.Context, command NodeCommand) (ValidationResult, error) {
	if err := v.validateEnvelope(command); err != nil {
		return ValidationResult{}, err
	}

	signingBytes, err := command.SigningBytes()
	if err != nil {
		return ValidationResult{}, reject(CodeInvalidEnvelope, "canonicalize signing payload", err)
	}
	if v.signatures == nil {
		return ValidationResult{}, reject(CodeSignatureInvalid, "signature verifier is not configured", nil)
	}
	if err := v.signatures.Verify(ctx, command.Signer, signingBytes, command.Signature); err != nil {
		return ValidationResult{}, reject(CodeSignatureInvalid, "signature verification failed", err)
	}

	if v.authority == nil {
		return ValidationResult{}, reject(CodeUnauthorized, "capability resolver is not configured", nil)
	}
	state, err := v.authority.Resolve(ctx, command.Capability)
	if err != nil {
		return ValidationResult{}, reject(CodeUnauthorized, "resolve capability", err)
	}
	if err := v.validateAuthority(command, state); err != nil {
		return ValidationResult{}, err
	}

	fingerprint := hashBytes(signingBytes)
	duplicate, err := v.replay.CheckAndRecord(command.CommandID, command.Nonce, command.IdempotencyKey, fingerprint)
	if err != nil {
		return ValidationResult{}, err
	}
	return ValidationResult{Duplicate: duplicate, AuthorityCheckpoint: state.RevocationVersion}, nil
}

func (v *Validator) validateEnvelope(command NodeCommand) error {
	if command.Version != ProtocolVersion {
		return reject(CodeInvalidVersion, fmt.Sprintf("got %q, want %q", command.Version, ProtocolVersion), nil)
	}
	if strings.TrimSpace(command.CommandID) == "" || strings.TrimSpace(command.Signer) == "" ||
		strings.TrimSpace(command.Target.OrganizationID) == "" || strings.TrimSpace(command.Target.NodeID) == "" ||
		strings.TrimSpace(command.Action) == "" || strings.TrimSpace(command.Scope) == "" ||
		strings.TrimSpace(command.Capability.ID) == "" || strings.TrimSpace(command.Nonce) == "" ||
		strings.TrimSpace(command.IdempotencyKey) == "" || strings.TrimSpace(command.Signature) == "" {
		return reject(CodeInvalidEnvelope, "required field is empty", nil)
	}
	if !validHash(command.PayloadHash) {
		return reject(CodeInvalidEnvelope, "payload_hash must be a lowercase SHA-256 hex string", nil)
	}
	if HashPayload(command.Payload) != command.PayloadHash {
		return reject(CodePayloadHashMismatch, "payload does not match payload_hash", nil)
	}
	if len(command.Payload) > 0 && !json.Valid(command.Payload) {
		return reject(CodeInvalidEnvelope, "payload must be valid JSON", nil)
	}

	nowMS := v.options.Now().UnixMilli()
	skewMS := v.options.MaxClockSkew.Milliseconds()
	if command.IssuedAtMS <= 0 || command.ExpiresAtMS <= command.IssuedAtMS {
		return reject(CodeInvalidEnvelope, "issued_at_ms and expires_at_ms are invalid", nil)
	}
	if command.IssuedAtMS > nowMS+skewMS {
		return reject(CodeNotYetValid, "issued_at_ms is beyond allowed clock skew", nil)
	}
	if command.ExpiresAtMS <= nowMS {
		return reject(CodeExpired, "command intent expired", nil)
	}
	if command.ExpiresAtMS-command.IssuedAtMS > v.options.MaxCommandTTL.Milliseconds() {
		return reject(CodeTTLExceeded, "command intent exceeds maximum TTL", nil)
	}
	if strings.TrimSpace(v.options.LocalTarget.OrganizationID) == "" || strings.TrimSpace(v.options.LocalTarget.NodeID) == "" {
		return reject(CodeWrongTarget, "local envd target is not configured", nil)
	}
	if !targetContains(v.options.LocalTarget, command.Target) {
		return reject(CodeWrongTarget, "command target does not match this envd", nil)
	}
	return nil
}

func (v *Validator) validateAuthority(command NodeCommand, state CapabilityState) error {
	nowMS := v.options.Now().UnixMilli()
	if state.ID != command.Capability.ID {
		return reject(CodeUnauthorized, "resolved capability id mismatch", nil)
	}
	if state.Revoked {
		return reject(CodeRevoked, "capability is revoked", nil)
	}
	if !contains(state.AuthorizedSigners, command.Signer) {
		return reject(CodeUnauthorized, "signer is not authorized by capability", nil)
	}
	if state.ExpiresAtMS > 0 && (state.ExpiresAtMS <= nowMS || command.ExpiresAtMS > state.ExpiresAtMS) {
		return reject(CodeExpired, "command exceeds capability expiry", nil)
	}
	if strings.TrimSpace(state.Target.OrganizationID) == "" || strings.TrimSpace(state.Target.NodeID) == "" {
		return reject(CodeUnauthorized, "capability target is incomplete", nil)
	}
	if !targetContains(state.Target, command.Target) {
		return reject(CodeWrongTarget, "capability target does not match command target", nil)
	}
	if !contains(state.Actions, command.Action) {
		return reject(CodeUnauthorized, "action is not allowed by capability", nil)
	}
	if !contains(state.Scopes, command.Scope) {
		return reject(CodeWrongScope, "scope is not allowed by capability", nil)
	}
	if state.RevocationVersion < command.Capability.RevocationVersion {
		return reject(CodeAuthorityStale, "resolved revocation version is older than the signed reference", nil)
	}
	maxCheckpointAge := v.options.MaxLowRiskCheckpointAge
	if _, highRisk := v.options.HighRiskActions[command.Action]; highRisk {
		maxCheckpointAge = v.options.MaxHighRiskCheckpointAge
	} else if _, lowRisk := v.options.LowRiskActions[command.Action]; !lowRisk {
		return reject(CodeRiskUnclassified, "action has no explicit risk classification", nil)
	}
	if state.CheckpointObservedAtMS <= 0 || state.CheckpointObservedAtMS > nowMS+v.options.MaxClockSkew.Milliseconds() ||
		nowMS-state.CheckpointObservedAtMS > maxCheckpointAge.Milliseconds() {
		return reject(CodeAuthorityStale, "capability revocation checkpoint is outside the action freshness window", nil)
	}
	return nil
}

func validHash(value string) bool {
	if len(value) != sha256HexLength || strings.ToLower(value) != value {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == 32
}

const sha256HexLength = 64

func targetContains(local, requested Target) bool {
	if local.OrganizationID != "" && local.OrganizationID != requested.OrganizationID {
		return false
	}
	if local.NodeID != "" && local.NodeID != requested.NodeID {
		return false
	}
	if local.AgentID != "" && local.AgentID != requested.AgentID {
		return false
	}
	return true
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
