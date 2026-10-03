package nodecommand

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestResolvedReservationRejectsChangesAfterPreflight(t *testing.T) {
	for _, mode := range []string{"unchanged", "grant", "membership", "managed", "capability", "expired", "unavailable", "untyped", "wrong signer", "wrong snapshot"} {
		t.Run(mode, func(t *testing.T) {
			f := newChainFixture(t)
			f.resolver.reader = &authorityBatchFixture{chainFixture: f}
			probe := &chainReservationProbe{}
			store, err := NewChainAuthorityStore(f.resolver, probe)
			if err != nil {
				t.Fatal(err)
			}
			state, err := store.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()})
			if err != nil {
				t.Fatal(err)
			}
			r := Reservation{CapabilityID: state.ID, Signer: state.AuthorizedSigners[0], Scope: state.ReservationScope, ExpectedAuthorityHash: state.SnapshotHash(), ExpectedRevocationVersion: state.RevocationVersion, AuthorityObservedAtMS: state.CheckpointObservedAtMS, ExpiresAtMS: 1700000060000}
			change := func(id string) { object := f.objects[id]; object.Version++; f.objects[id] = object }
			switch mode {
			case "grant":
				change(f.grant.ID.String())
			case "membership":
				change(f.member.ID.String())
			case "managed":
				change(f.managed.ID.String())
			case "capability":
				change(f.cap.ID.String())
			case "expired":
				f.resolver.now = func() time.Time { return time.UnixMilli(1700000060000) }
			case "unavailable":
				f.fail = true
			case "untyped":
				state.readVersions = nil
			case "wrong signer":
				r.Signer = f.member.Host.String()
			case "wrong snapshot":
				r.ExpectedAuthorityHash = "wrong"
			}
			_, _, inspected := store.InspectResolved(context.Background(), r, state)
			_, reserved := store.ReserveResolved(context.Background(), r, state)
			if mode == "unchanged" {
				if inspected != nil || reserved != nil || !probe.reserved {
					t.Fatalf("fresh unchanged dependencies rejected: %v %v", inspected, reserved)
				}
			} else if reserved == nil || probe.reserved || (mode != "wrong snapshot" && inspected == nil) {
				t.Fatalf("changed authority admitted: inspect=%v reserve=%v executed=%v", inspected, reserved, probe.reserved)
			}
		})
	}
}

func TestValidateWithPreflightChecksRevocationBeforeKeysAndNeverReservesOnFailure(t *testing.T) {
	now := fixedNow()
	state := validState(now)
	store := NewMemoryAuthorityStore(state)
	validator := newTestValidatorWithStore(now, store, state.Target)
	command := validCommand(now)
	calls := 0
	missing := errors.New("key unavailable")
	_, err := validator.ValidateWithPreflight(context.Background(), command, func(context.Context, NodeCommand) error { calls++; return missing })
	if !errors.Is(err, missing) || calls != 1 {
		t.Fatalf("preflight failure lost: %v", err)
	}
	// The failed preflight never claimed this original command.
	result, err := validator.Validate(context.Background(), command)
	if err != nil || result.Duplicate {
		t.Fatalf("failed preflight consumed authority: %+v %v", result, err)
	}
	state.Revoked = true
	store.SetState(state)
	_, err = validator.ValidateWithPreflight(context.Background(), command, func(context.Context, NodeCommand) error { calls++; return missing })
	if CodeOf(err) != CodeRevoked || calls != 1 {
		t.Fatalf("revoked duplicate accessed result keys: %v calls=%d", err, calls)
	}
}
