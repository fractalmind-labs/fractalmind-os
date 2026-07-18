package nodecommand

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

type signatureVerifierFunc func(context.Context, string, []byte, string) error

func (f signatureVerifierFunc) Verify(ctx context.Context, signer string, payload []byte, signature string) error {
	return f(ctx, signer, payload, signature)
}

type capabilityResolverFunc func(context.Context, CapabilityRef) (CapabilityState, error)

func (f capabilityResolverFunc) Resolve(ctx context.Context, ref CapabilityRef) (CapabilityState, error) {
	return f(ctx, ref)
}

func TestSigningBytesGoldenVector(t *testing.T) {
	command := validCommand(fixedNow())
	got, err := command.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	want := `{"version":"1","command_id":"cmd-1","signer":"0xcontroller","target":{"organization_id":"org-1","node_id":"node-1","agent_id":"agent-1"},"action":"status","scope":"lifecycle","capability":{"id":"cap-1","revocation_version":7},"nonce":"nonce-1","issued_at_ms":1784394000000,"expires_at_ms":1784394060000,"idempotency_key":"idem-1","payload_hash":"b9171daa13c67874a6500ad8e992d5d3c109d91b4dc9edc1a0a9e9209a18b44d"}`
	if string(got) != want {
		t.Fatalf("signing bytes mismatch\n got: %s\nwant: %s", got, want)
	}
}

func TestNodeEventGoldenVector(t *testing.T) {
	event := NodeEvent{
		Version:      ProtocolVersion,
		EventID:      "evt-1",
		CommandID:    "cmd-1",
		Target:       Target{OrganizationID: "org-1", NodeID: "node-1", AgentID: "agent-1"},
		Type:         "completed",
		ResultCode:   "ok",
		ResultHash:   "result-hash",
		EvidenceHash: "evidence-hash",
		OccurredAtMS: fixedNow().UnixMilli(),
	}
	got, err := event.CanonicalBytes()
	if err != nil {
		t.Fatal(err)
	}
	want := `{"version":"1","event_id":"evt-1","command_id":"cmd-1","target":{"organization_id":"org-1","node_id":"node-1","agent_id":"agent-1"},"type":"completed","result_code":"ok","result_hash":"result-hash","evidence_hash":"evidence-hash","occurred_at_ms":1784394000000}`
	if string(got) != want {
		t.Fatalf("event bytes mismatch\n got: %s\nwant: %s", got, want)
	}
}

func TestValidatorAcceptsValidAndDuplicateCommand(t *testing.T) {
	now := fixedNow()
	validator := newTestValidator(now, CapabilityState{})
	command := validCommand(now)

	result, err := validator.Validate(context.Background(), command)
	if err != nil {
		t.Fatalf("first validation failed: %v", err)
	}
	if result.Duplicate || result.AuthorityCheckpoint != 7 {
		t.Fatalf("unexpected first result: %+v", result)
	}

	result, err = validator.Validate(context.Background(), command)
	if err != nil {
		t.Fatalf("duplicate validation failed: %v", err)
	}
	if !result.Duplicate {
		t.Fatal("expected duplicate delivery to be recognized")
	}
}

func TestValidatorConcurrentDuplicateDelivery(t *testing.T) {
	const deliveries = 100
	now := fixedNow()
	validator := newTestValidator(now, CapabilityState{})
	command := validCommand(now)

	var wg sync.WaitGroup
	results := make(chan ValidationResult, deliveries)
	errs := make(chan error, deliveries)
	for range deliveries {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := validator.Validate(context.Background(), command)
			results <- result
			errs <- err
		}()
	}
	wg.Wait()
	close(results)
	close(errs)

	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent validation failed: %v", err)
		}
	}
	duplicates := 0
	for result := range results {
		if result.Duplicate {
			duplicates++
		}
	}
	if duplicates != deliveries-1 {
		t.Fatalf("duplicate results = %d, want %d", duplicates, deliveries-1)
	}
}

func TestValidatorRejectionMatrix(t *testing.T) {
	now := fixedNow()
	tests := []struct {
		name     string
		mutate   func(*NodeCommand, *CapabilityState)
		wantCode RejectionCode
		badSig   bool
	}{
		{"malformed", func(c *NodeCommand, _ *CapabilityState) { c.CommandID = "" }, CodeInvalidEnvelope, false},
		{"invalid payload json", func(c *NodeCommand, _ *CapabilityState) { c.Payload = []byte(`{"broken"`) }, CodeInvalidEnvelope, false},
		{"expired", func(c *NodeCommand, _ *CapabilityState) {
			c.IssuedAtMS = now.Add(-time.Minute).UnixMilli()
			c.ExpiresAtMS = now.Add(-time.Second).UnixMilli()
		}, CodeExpired, false},
		{"ttl exceeded", func(c *NodeCommand, s *CapabilityState) {
			c.ExpiresAtMS = now.Add(10 * time.Minute).UnixMilli()
			s.ExpiresAtMS = now.Add(20 * time.Minute).UnixMilli()
		}, CodeTTLExceeded, false},
		{"wrong target", func(c *NodeCommand, _ *CapabilityState) { c.Target.NodeID = "node-2" }, CodeWrongTarget, false},
		{"unauthorized signer", func(_ *NodeCommand, s *CapabilityState) { s.AuthorizedSigners = []string{"0xother"} }, CodeUnauthorized, false},
		{"wrong scope", func(_ *NodeCommand, s *CapabilityState) { s.Scopes = []string{"logs"} }, CodeWrongScope, false},
		{"unclassified risk", func(c *NodeCommand, s *CapabilityState) {
			c.Action = "unknown"
			s.Actions = []string{"unknown"}
		}, CodeRiskUnclassified, false},
		{"revoked", func(_ *NodeCommand, s *CapabilityState) { s.Revoked = true }, CodeRevoked, false},
		{"stale high risk", func(c *NodeCommand, s *CapabilityState) {
			c.Action = "shell"
			s.Actions = []string{"shell"}
			s.CheckpointObservedAtMS = now.Add(-3 * time.Minute).UnixMilli()
		}, CodeAuthorityStale, false},
		{"future high risk checkpoint", func(c *NodeCommand, s *CapabilityState) {
			c.Action = "shell"
			s.Actions = []string{"shell"}
			s.CheckpointObservedAtMS = now.Add(time.Minute).UnixMilli()
		}, CodeAuthorityStale, false},
		{"invalid signature", func(_ *NodeCommand, _ *CapabilityState) {}, CodeSignatureInvalid, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			command := validCommand(now)
			state := validState(now)
			tt.mutate(&command, &state)
			command.PayloadHash = HashPayload(command.Payload)
			validator := newTestValidator(now, state)
			if tt.badSig {
				validator.signatures = signatureVerifierFunc(func(context.Context, string, []byte, string) error {
					return errors.New("bad signature")
				})
			}
			_, err := validator.Validate(context.Background(), command)
			if CodeOf(err) != tt.wantCode {
				t.Fatalf("got err %v (code %q), want %q", err, CodeOf(err), tt.wantCode)
			}
		})
	}
}

func TestValidatorAllowsNodeScopedCapabilityForAgentTarget(t *testing.T) {
	now := fixedNow()
	state := validState(now)
	state.Target.AgentID = ""
	validator := newTestValidator(now, state)
	if _, err := validator.Validate(context.Background(), validCommand(now)); err != nil {
		t.Fatalf("node-scoped capability rejected agent target: %v", err)
	}
}

func TestValidatorRejectsUnconfiguredLocalTarget(t *testing.T) {
	now := fixedNow()
	validator := newTestValidator(now, CapabilityState{})
	validator.options.LocalTarget = Target{}
	if _, err := validator.Validate(context.Background(), validCommand(now)); CodeOf(err) != CodeWrongTarget {
		t.Fatalf("code = %q, err=%v", CodeOf(err), err)
	}
}

func TestCodeOfWrappedRejection(t *testing.T) {
	err := fmt.Errorf("adapter: %w", reject(CodeReplay, "duplicate", nil))
	if got := CodeOf(err); got != CodeReplay {
		t.Fatalf("code = %q, want %q", got, CodeReplay)
	}
}

func TestValidatorRejectsReplayAndIdempotencyConflict(t *testing.T) {
	now := fixedNow()
	validator := newTestValidator(now, CapabilityState{})
	first := validCommand(now)
	if _, err := validator.Validate(context.Background(), first); err != nil {
		t.Fatal(err)
	}

	replay := validCommand(now)
	replay.CommandID = "cmd-2"
	replay.IdempotencyKey = "idem-2"
	if _, err := validator.Validate(context.Background(), replay); CodeOf(err) != CodeReplay {
		t.Fatalf("replay code = %q, err=%v", CodeOf(err), err)
	}

	conflict := validCommand(now)
	conflict.CommandID = "cmd-3"
	conflict.Nonce = "nonce-3"
	conflict.Action = "logs"
	conflict.PayloadHash = HashPayload(conflict.Payload)
	if _, err := validator.Validate(context.Background(), conflict); CodeOf(err) != CodeIdempotencyConflict {
		t.Fatalf("idempotency code = %q, err=%v", CodeOf(err), err)
	}
}

func TestValidatorAllowsStaleCheckpointForLowRiskCommand(t *testing.T) {
	now := fixedNow()
	state := validState(now)
	state.CheckpointObservedAtMS = now.Add(-time.Hour).UnixMilli()
	validator := newTestValidator(now, state)
	if _, err := validator.Validate(context.Background(), validCommand(now)); err != nil {
		t.Fatalf("low-risk cached command rejected: %v", err)
	}
}

func TestValidatorRejectsCheckpointBeyondLowRiskContinuityWindow(t *testing.T) {
	now := fixedNow()
	state := validState(now)
	state.CheckpointObservedAtMS = now.Add(-25 * time.Hour).UnixMilli()
	validator := newTestValidator(now, state)
	if _, err := validator.Validate(context.Background(), validCommand(now)); CodeOf(err) != CodeAuthorityStale {
		t.Fatalf("code = %q, err=%v", CodeOf(err), err)
	}
}

func newTestValidator(now time.Time, override CapabilityState) *Validator {
	state := override
	if state.ID == "" {
		state = validState(now)
	}
	return NewValidator(
		signatureVerifierFunc(func(_ context.Context, signer string, payload []byte, signature string) error {
			if signer != "0xcontroller" || len(payload) == 0 || signature != "signature-1" {
				return errors.New("signature mismatch")
			}
			return nil
		}),
		capabilityResolverFunc(func(_ context.Context, ref CapabilityRef) (CapabilityState, error) {
			if ref.ID != "cap-1" {
				return CapabilityState{}, errors.New("unknown capability")
			}
			return state, nil
		}),
		NewMemoryReplayGuard(),
		ValidatorOptions{
			Now:                      func() time.Time { return now },
			LocalTarget:              Target{OrganizationID: "org-1", NodeID: "node-1"},
			MaxCommandTTL:            5 * time.Minute,
			MaxLowRiskCheckpointAge:  24 * time.Hour,
			MaxHighRiskCheckpointAge: 2 * time.Minute,
			LowRiskActions:           map[string]struct{}{"status": {}, "logs": {}},
			HighRiskActions:          map[string]struct{}{"shell": {}, "deploy": {}},
		},
	)
}

func validCommand(now time.Time) NodeCommand {
	payload := []byte(`{"agent_id":"agent-1"}`)
	return NodeCommand{
		Version:        ProtocolVersion,
		CommandID:      "cmd-1",
		Signer:         "0xcontroller",
		Target:         Target{OrganizationID: "org-1", NodeID: "node-1", AgentID: "agent-1"},
		Action:         "status",
		Scope:          "lifecycle",
		Capability:     CapabilityRef{ID: "cap-1", RevocationVersion: 7},
		Nonce:          "nonce-1",
		IssuedAtMS:     now.UnixMilli(),
		ExpiresAtMS:    now.Add(time.Minute).UnixMilli(),
		IdempotencyKey: "idem-1",
		Payload:        payload,
		PayloadHash:    HashPayload(payload),
		Signature:      "signature-1",
	}
}

func validState(now time.Time) CapabilityState {
	return CapabilityState{
		ID:                     "cap-1",
		Target:                 Target{OrganizationID: "org-1", NodeID: "node-1", AgentID: "agent-1"},
		AuthorizedSigners:      []string{"0xcontroller"},
		Actions:                []string{"status", "logs"},
		Scopes:                 []string{"lifecycle"},
		ExpiresAtMS:            now.Add(5 * time.Minute).UnixMilli(),
		RevocationVersion:      7,
		CheckpointObservedAtMS: now.UnixMilli(),
	}
}

func fixedNow() time.Time {
	return time.UnixMilli(1784394000000).UTC()
}
