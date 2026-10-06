package nodecommand

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

type directValidatorStore struct {
	*MemoryAuthorityStore
	calls int
	err   error
}

func (s *directValidatorStore) ValidateDirectCommand(context.Context, NodeCommand, CapabilityState) error {
	s.calls++
	return s.err
}
func TestDirectValidatorRequiresBindingBeforeReserveAndAllowsZeroToolStatus(t *testing.T) {
	for _, mode := range []string{"write", "zero-tool status", "missing chain binding", "binding rejected", "bad budget", "bad signature"} {
		t.Run(mode, func(t *testing.T) {
			now := fixedNow()
			c, s := validCommand(now), validState(now)
			c.Action, c.Scope = "direct.message", "direct"
			s.Actions, s.Scopes = []string{c.Action}, []string{c.Scope}
			paths := map[string][]string{"file.read": {"."}, "file.write": {"."}}
			boundary, _ := ExecutionBoundaryHash(paths)
			s.Direct = &DirectPermissionAuthority{ID: "0x" + strings.Repeat("a", 64), Version: 1, BoundaryHash: boundary, MaxCalls: 3, Actions: []string{"status", "file.write"}}
			action, task, calls := "file.write", "explicit task", Uint64String(3)
			c.Budget = &BudgetClaim{Asset: "TOOL_CALLS", Amount: calls}
			s.RemainingBudget = &BudgetClaim{Asset: "TOOL_CALLS", Amount: 12}
			if mode == "zero-tool status" {
				action, task, calls = "status", "", 0
				c.Budget = nil
			}
			c.Payload, _ = json.Marshal(map[string]any{"message": "exact message", "task": task, "bounds": map[string]any{"paths": paths, "max_calls": calls}, "direct": DirectMessageRef{Version: "1", PermissionID: s.Direct.ID, PermissionVersion: 1, MessageID: "0x" + strings.Repeat("b", 64), MessageRecordID: "0x" + strings.Repeat("c", 64), ConversationID: "conversation", MessageToken: "token", Action: action}})
			c.PayloadHash = HashPayload(c.Payload)
			if mode == "bad budget" {
				c.Budget.Amount = 4
			}
			if mode == "bad signature" {
				c.Signature = "invalid"
			}
			base := NewMemoryAuthorityStore(s)
			store := &directValidatorStore{MemoryAuthorityStore: base}
			if mode == "binding rejected" {
				store.err = errors.New("original message mismatch")
			}
			var authority AuthorityStore = store
			if mode == "missing chain binding" {
				authority = base
			}
			v := newTestValidatorWithStore(now, authority, c.Target)
			v.options.HighRiskActions["direct.message"] = struct{}{}
			v.options.BudgetedActions["direct.message"] = struct{}{}
			_, err := v.Validate(context.Background(), c)
			wantOK := mode == "write" || mode == "zero-tool status"
			if (err == nil) != wantOK {
				t.Fatalf("wrong admission %s: %v", mode, err)
			}
			after, readErr := base.Resolve(context.Background(), c.Capability)
			if readErr != nil {
				t.Fatal(readErr)
			}
			wantUses := uint64(10)
			if wantOK {
				wantUses--
			}
			if *after.RemainingUses != wantUses {
				t.Fatal("rejection consumed authority")
			}
			wantChecks := 0
			if wantOK || mode == "binding rejected" {
				wantChecks = 1
			}
			if store.calls != wantChecks {
				t.Fatalf("binding hook calls %d want %d", store.calls, wantChecks)
			}
		})
	}
}
