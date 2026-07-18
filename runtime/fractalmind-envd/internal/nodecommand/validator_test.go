package nodecommand

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"
)

type signatureVerifierFunc func(context.Context, string, []byte, string) error

func (f signatureVerifierFunc) Verify(ctx context.Context, signer string, payload []byte, signature string) error {
	return f(ctx, signer, payload, signature)
}

func TestSigningBytesGoldenVector(t *testing.T) {
	fixture := loadGoldenFixture(t)
	payload, err := hex.DecodeString(fixture.PayloadHex)
	if err != nil {
		t.Fatal(err)
	}
	fixture.Command.Payload = payload
	got, err := fixture.Command.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	want, err := hex.DecodeString(fixture.SigningBytesHex)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatalf("signing bytes mismatch\n got: %s\nwant: %s", got, want)
	}
	if HashPayload(payload) != fixture.Command.PayloadHash {
		t.Fatal("fixture payload hash does not match payload bytes")
	}
}

func TestSigningBytesPreserveUint64AboveJavaScriptSafeInteger(t *testing.T) {
	command := validCommand(fixedNow())
	command.Capability.RevocationVersion = Uint64String(^uint64(0))
	command.Budget = &BudgetClaim{Asset: "MIST", Amount: Uint64String(^uint64(0))}
	got, err := command.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range [][]byte{
		[]byte(`"revocation_version":"18446744073709551615"`),
		[]byte(`"amount":"18446744073709551615"`),
	} {
		if !bytes.Contains(got, want) {
			t.Fatalf("signing bytes %s do not contain %s", got, want)
		}
	}

	var ref CapabilityRef
	if err := json.Unmarshal([]byte(`{"id":"cap-1","revocation_version":7}`), &ref); err == nil {
		t.Fatal("numeric uint64 JSON must be rejected")
	}
}

func TestNodeEventGoldenVector(t *testing.T) {
	fixture := loadGoldenFixture(t)
	got, err := fixture.Event.CanonicalBytes()
	if err != nil {
		t.Fatal(err)
	}
	want, err := hex.DecodeString(fixture.EventBytesHex)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatalf("event bytes mismatch\n got: %s\nwant: %s", got, want)
	}
}

type goldenFixture struct {
	Command         NodeCommand `json:"command"`
	PayloadHex      string      `json:"payload_hex"`
	SigningBytesHex string      `json:"signing_bytes_hex"`
	Event           NodeEvent   `json:"event"`
	EventBytesHex   string      `json:"event_bytes_hex"`
}

func loadGoldenFixture(t *testing.T) goldenFixture {
	t.Helper()
	data, err := os.ReadFile("testdata/v1-golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture goldenFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func TestValidatorAcceptsValidAndDuplicateCommand(t *testing.T) {
	now := fixedNow()
	state := validState(now)
	state.RemainingUses = uint64Pointer(1)
	validator := newTestValidator(now, state)
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
		{"non canonical token", func(c *NodeCommand, _ *CapabilityState) { c.CommandID = "cmd 1" }, CodeInvalidEnvelope, false},
		{"invalid capability hierarchy", func(_ *NodeCommand, s *CapabilityState) { s.Target.NodeID = "" }, CodeUnauthorized, false},
		{"unbounded capability", func(_ *NodeCommand, s *CapabilityState) { s.RemainingUses = nil }, CodeUnauthorized, false},
		{"exhausted capability", func(_ *NodeCommand, s *CapabilityState) { s.RemainingUses = uint64Pointer(0) }, CodeCapabilityExhausted, false},
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
		{"missing required budget", func(c *NodeCommand, s *CapabilityState) {
			c.Action = "deploy"
			s.Actions = []string{"deploy"}
			s.RemainingBudget = &BudgetClaim{Asset: "MIST", Amount: 100}
		}, CodeBudgetExceeded, false},
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

func TestValidatorAllowsOrganizationScopedCapabilityForNodeTarget(t *testing.T) {
	now := fixedNow()
	state := validState(now)
	state.Target.NodeID = ""
	state.Target.AgentID = ""
	state.ReservationScope = ReservationScopeAuthority
	validator := newTestValidator(now, state)
	if _, err := validator.Validate(context.Background(), validCommand(now)); err != nil {
		t.Fatalf("organization-scoped capability rejected node target: %v", err)
	}
}

func TestOrganizationScopedCapabilityUsesAuthorityWideReservation(t *testing.T) {
	now := fixedNow()
	state := validState(now)
	state.Target = Target{OrganizationID: "org-1"}
	state.ReservationScope = ReservationScopeAuthority
	state.RemainingUses = uint64Pointer(1)
	store := NewMemoryAuthorityStore(state)
	validators := []*Validator{
		newTestValidatorWithStore(now, store, Target{OrganizationID: "org-1", NodeID: "node-1"}),
		newTestValidatorWithStore(now, store, Target{OrganizationID: "org-1", NodeID: "node-2"}),
	}
	commands := []NodeCommand{validCommand(now), validCommand(now)}
	commands[1].CommandID = "cmd-2"
	commands[1].Nonce = "nonce-2"
	commands[1].IdempotencyKey = "idem-2"
	commands[1].Target.NodeID = "node-2"

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := range validators {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := validators[i].Validate(context.Background(), commands[i])
			errs <- err
		}(i)
	}
	wg.Wait()
	close(errs)

	successes := 0
	exhausted := 0
	for err := range errs {
		if err == nil {
			successes++
		} else if CodeOf(err) == CodeCapabilityExhausted {
			exhausted++
		} else {
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if successes != 1 || exhausted != 1 {
		t.Fatalf("successes=%d exhausted=%d, want 1/1", successes, exhausted)
	}
}

type mutateOnReserveStore struct {
	*MemoryAuthorityStore
	mutated CapabilityState
}

func (s *mutateOnReserveStore) Reserve(ctx context.Context, reservation Reservation) (ReservationResult, error) {
	s.SetState(s.mutated)
	return s.MemoryAuthorityStore.Reserve(ctx, reservation)
}

func TestValidatorRejectsAuthoritySnapshotRace(t *testing.T) {
	now := fixedNow()
	state := validState(now)
	mutated := validState(now)
	mutated.Actions = []string{"logs"}
	store := &mutateOnReserveStore{MemoryAuthorityStore: NewMemoryAuthorityStore(state), mutated: mutated}
	validator := newTestValidatorWithStore(now, store, Target{OrganizationID: "org-1", NodeID: "node-1"})
	if _, err := validator.Validate(context.Background(), validCommand(now)); CodeOf(err) != CodeAuthorityStale {
		t.Fatalf("code = %q, err=%v", CodeOf(err), err)
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

func TestValidatorAtomicallyEnforcesRemainingUses(t *testing.T) {
	now := fixedNow()
	state := validState(now)
	state.RemainingUses = uint64Pointer(1)
	validator := newTestValidator(now, state)

	commands := []NodeCommand{validCommand(now), validCommand(now)}
	commands[1].CommandID = "cmd-2"
	commands[1].Nonce = "nonce-2"
	commands[1].IdempotencyKey = "idem-2"

	var wg sync.WaitGroup
	errs := make(chan error, len(commands))
	for _, command := range commands {
		wg.Add(1)
		go func(command NodeCommand) {
			defer wg.Done()
			_, err := validator.Validate(context.Background(), command)
			errs <- err
		}(command)
	}
	wg.Wait()
	close(errs)

	successes := 0
	exhausted := 0
	for err := range errs {
		switch CodeOf(err) {
		case "":
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			successes++
		case CodeCapabilityExhausted:
			exhausted++
		default:
			t.Fatalf("unexpected rejection: %v", err)
		}
	}
	if successes != 1 || exhausted != 1 {
		t.Fatalf("successes=%d exhausted=%d, want 1/1", successes, exhausted)
	}
}

func TestValidatorAtomicallyEnforcesBudget(t *testing.T) {
	now := fixedNow()
	state := validState(now)
	state.Actions = append(state.Actions, "deploy")
	state.RemainingUses = nil
	state.RemainingBudget = &BudgetClaim{Asset: "MIST", Amount: 100}
	validator := newTestValidator(now, state)

	first := validCommand(now)
	first.Action = "deploy"
	first.Budget = &BudgetClaim{Asset: "MIST", Amount: 60}
	if _, err := validator.Validate(context.Background(), first); err != nil {
		t.Fatalf("first budget reservation failed: %v", err)
	}

	second := validCommand(now)
	second.CommandID = "cmd-2"
	second.Nonce = "nonce-2"
	second.IdempotencyKey = "idem-2"
	second.Action = "deploy"
	second.Budget = &BudgetClaim{Asset: "MIST", Amount: 50}
	if _, err := validator.Validate(context.Background(), second); CodeOf(err) != CodeBudgetExceeded {
		t.Fatalf("code = %q, err=%v", CodeOf(err), err)
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
	return newTestValidatorWithStore(now, NewMemoryAuthorityStore(state), Target{OrganizationID: "org-1", NodeID: "node-1"})
}

func newTestValidatorWithStore(now time.Time, store AuthorityStore, localTarget Target) *Validator {
	return NewValidator(
		signatureVerifierFunc(func(_ context.Context, signer string, payload []byte, signature string) error {
			if signer != "0xcontroller" || len(payload) == 0 || signature != "signature-1" {
				return errors.New("signature mismatch")
			}
			return nil
		}),
		store,
		ValidatorOptions{
			Now:                      func() time.Time { return now },
			LocalTarget:              localTarget,
			MaxCommandTTL:            5 * time.Minute,
			MaxLowRiskCheckpointAge:  24 * time.Hour,
			MaxHighRiskCheckpointAge: 2 * time.Minute,
			LowRiskActions:           map[string]struct{}{"status": {}, "logs": {}},
			HighRiskActions:          map[string]struct{}{"shell": {}, "deploy": {}},
			BudgetedActions:          map[string]struct{}{"deploy": {}},
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
		ReservationScope:       ReservationScopeNode,
		RemainingUses:          uint64Pointer(10),
	}
}

func uint64Pointer(value uint64) *uint64 { return &value }

func fixedNow() time.Time {
	return time.UnixMilli(1784394000000).UTC()
}
