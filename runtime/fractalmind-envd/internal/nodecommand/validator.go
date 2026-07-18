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
	RemainingUses          *uint64
	RemainingBudget        *BudgetClaim
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
	BudgetedActions          map[string]struct{}
}

type ValidationResult struct {
	Duplicate           bool
	AuthorityCheckpoint uint64
}

type Validator struct {
	signatures SignatureVerifier
	authority  AuthorityStore
	options    ValidatorOptions
}

func NewValidator(signatures SignatureVerifier, authority AuthorityStore, options ValidatorOptions) *Validator {
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
	return &Validator{signatures: signatures, authority: authority, options: options}
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
	fingerprint := hashBytes(signingBytes)
	reservation := Reservation{
		CapabilityID:   command.Capability.ID,
		Signer:         command.Signer,
		CommandID:      command.CommandID,
		Nonce:          command.Nonce,
		IdempotencyKey: command.IdempotencyKey,
		Fingerprint:    fingerprint,
		Budget:         command.Budget,
	}

	if v.authority == nil {
		return ValidationResult{}, reject(CodeUnauthorized, "capability resolver is not configured", nil)
	}
	if result, found, err := v.authority.Inspect(ctx, reservation); err != nil {
		return ValidationResult{}, err
	} else if found {
		return ValidationResult{Duplicate: true, AuthorityCheckpoint: result.AuthorityCheckpoint}, nil
	}
	state, err := v.authority.Resolve(ctx, command.Capability)
	if err != nil {
		return ValidationResult{}, reject(CodeUnauthorized, "resolve capability", err)
	}
	if err := v.validateAuthority(command, state); err != nil {
		return ValidationResult{}, err
	}

	reservation.ExpectedRevocationVersion = state.RevocationVersion
	result, err := v.authority.Reserve(ctx, reservation)
	if err != nil {
		if CodeOf(err) != "" {
			return ValidationResult{}, err
		}
		return ValidationResult{}, reject(CodeUnauthorized, "reserve capability", err)
	}
	return ValidationResult{Duplicate: result.Duplicate, AuthorityCheckpoint: result.AuthorityCheckpoint}, nil
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
	if err := validateSigningTokens(command); err != nil {
		return err
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
	if state.ExpiresAtMS <= nowMS || command.ExpiresAtMS > state.ExpiresAtMS {
		return reject(CodeExpired, "command exceeds capability expiry", nil)
	}
	if strings.TrimSpace(state.Target.OrganizationID) == "" {
		return reject(CodeUnauthorized, "capability target is incomplete", nil)
	}
	if state.Target.NodeID == "" && state.Target.AgentID != "" {
		return reject(CodeUnauthorized, "agent-scoped capability must include a node target", nil)
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
	_, budgeted := v.options.BudgetedActions[command.Action]
	if budgeted && command.Budget == nil {
		return reject(CodeBudgetExceeded, "action requires an explicit budget claim", nil)
	}
	if !budgeted && command.Budget != nil {
		return reject(CodeInvalidEnvelope, "action does not consume authority budget", nil)
	}
	if command.Budget != nil {
		if state.RemainingBudget == nil || state.RemainingBudget.Asset != command.Budget.Asset ||
			state.RemainingBudget.Amount < command.Budget.Amount {
			return reject(CodeBudgetExceeded, "capability budget is insufficient", nil)
		}
	}
	if state.RemainingUses == nil && command.Budget == nil {
		return reject(CodeUnauthorized, "capability has no use or budget bound", nil)
	}
	if state.RemainingUses != nil && *state.RemainingUses == 0 {
		return reject(CodeCapabilityExhausted, "capability has no remaining uses", nil)
	}
	if state.CheckpointObservedAtMS <= 0 || state.CheckpointObservedAtMS > nowMS+v.options.MaxClockSkew.Milliseconds() ||
		nowMS-state.CheckpointObservedAtMS > maxCheckpointAge.Milliseconds() {
		return reject(CodeAuthorityStale, "capability revocation checkpoint is outside the action freshness window", nil)
	}
	return nil
}

func validateSigningTokens(command NodeCommand) error {
	values := []string{
		command.CommandID,
		command.Signer,
		command.Target.OrganizationID,
		command.Target.NodeID,
		command.Target.AgentID,
		command.Action,
		command.Scope,
		command.Capability.ID,
		command.Nonce,
		command.IdempotencyKey,
	}
	for _, value := range values {
		if value != "" && !validSigningToken(value) {
			return reject(CodeInvalidEnvelope, "signed identifiers must use the canonical ASCII token alphabet", nil)
		}
	}
	if command.Budget != nil {
		if !validSigningToken(command.Budget.Asset) || command.Budget.Amount == 0 {
			return reject(CodeInvalidEnvelope, "budget asset or amount is invalid", nil)
		}
	}
	return nil
}

func validSigningToken(value string) bool {
	for i := 0; i < len(value); i++ {
		c := value[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			strings.ContainsRune("-._:/@+", rune(c)) {
			continue
		}
		return false
	}
	return value != ""
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
