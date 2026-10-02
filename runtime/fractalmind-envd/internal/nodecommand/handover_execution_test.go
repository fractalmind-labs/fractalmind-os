package nodecommand

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestCurrentReviewPolicyRequiresExactChainSourceAndCeiling(t *testing.T) {
	for _, mode := range []string{"valid", "missing", "wrong type", "wrong owner", "wrong name", "mixed version", "agreement", "managed version", "ceiling", "zero ceiling", "nonce", "hash", "approval"} {
		t.Run(mode, func(t *testing.T) {
			f, okr, _, _ := contractFixture(t)
			pkg := f.resolver.packageID
			policy := moveHandoverPolicy{Agreement: 1, ManagedVersion: 1, MaxCalls: 100, Nonce: make([]byte, 32), ProposalHash: make([]byte, 32), Approval: addressNumber(25)}
			switch mode {
			case "agreement":
				policy.Agreement++
			case "managed version":
				policy.ManagedVersion++
			case "ceiling":
				policy.MaxCalls = 99
			case "zero ceiling":
				policy.MaxCalls = 0
			case "nonce":
				policy.Nonce = policy.Nonce[:31]
			case "hash":
				policy.ProposalHash = nil
			case "approval":
				policy.Approval = moveAddress{}
			}
			id := f.saveField(t, okr.ID, structKeyTag(pkg, "okr", "HandoverPolicyKey"), []byte{0}, pkg+"::okr::HandoverPolicyKey", pkg+"::okr::HandoverPolicy", policy)
			obj := f.objects[id]
			switch mode {
			case "missing":
				delete(f.objects, id)
			case "wrong type":
				obj.Type = strings.ReplaceAll(obj.Type, pkg, "0x99")
				f.objects[id] = obj
			case "wrong owner":
				obj.OwnerID = f.org.ID.String()
				f.objects[id] = obj
			case "wrong name":
				obj.Content[32] = 1
				f.objects[id] = obj
			case "mixed version":
				f.changeOnRead = id
			}
			state, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()})
			if mode == "valid" {
				if err != nil || state.Handover == nil || state.Handover.MaxCalls != 100 || state.Handover.ApprovalID != policy.Approval.String() {
					t.Fatal(state, err)
				}
			} else if err == nil {
				t.Fatal("invalid policy accepted", state)
			}
		})
	}
}

func TestNativeAssignmentCannotUseUnboundGenericCapability(t *testing.T) {
	f := newChainFixture(t)
	f.cap.Actions = []string{"assign"}
	f.cap.Scope = "control"
	f.sync(t)
	if _, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()}); err == nil {
		t.Fatal("generic control authority allowed native assignment")
	}
}

func TestSignedContinuationCannotSubstituteCurrentReview(t *testing.T) {
	f, _, _, _ := contractFixture(t)
	state, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()})
	if err != nil {
		t.Fatal(err)
	}
	h := state.Handover
	for _, mode := range []string{"valid", "missing", "approval", "hash", "nonce", "budget", "alias", "missing authority", "missing contract"} {
		t.Run(mode, func(t *testing.T) {
			ref := HandoverContinuationRef{ApprovalID: h.ApprovalID, ProposalHash: h.ProposalHash, Nonce: h.Nonce}
			command := NodeCommand{Action: "assign", Scope: "control", Budget: &BudgetClaim{Asset: "TOOL_CALLS", Amount: 10}}
			switch mode {
			case "approval":
				ref.ApprovalID = addressNumber(99).String()
			case "hash":
				ref.ProposalHash = strings.Repeat("f", 64)
			case "nonce":
				ref.Nonce = strings.Repeat("f", 64)
			case "budget":
				command.Budget.Amount = 101
			case "alias":
				ref.ApprovalID = "0x25"
			}
			command.Payload, _ = json.Marshal(map[string]any{"handover_continue": ref})
			if mode == "missing" {
				command.Payload = json.RawMessage(`{}`)
			}
			current := state
			if mode == "missing authority" {
				current.Handover = nil
			}
			if mode == "missing contract" {
				current.Contract = nil
			}
			err := ValidateExecutionHandover(command, current)
			if mode == "valid" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil {
				t.Fatal("substituted continuation accepted")
			}
		})
	}
}
