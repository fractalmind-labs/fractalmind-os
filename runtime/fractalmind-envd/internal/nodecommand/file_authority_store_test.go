package nodecommand

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFileAuthorityStorePersistsDuplicateReservation(t *testing.T) {
	state := fileStoreState(t)
	store := newTestFileAuthorityStore(t, state)
	reservation := fileStoreReservation(t, state)

	result, err := store.Reserve(context.Background(), reservation)
	if err != nil {
		t.Fatalf("first reservation failed: %v", err)
	}
	if result.Duplicate || result.AuthorityCheckpoint != 7 {
		t.Fatalf("first result = %+v, want non-duplicate checkpoint 7", result)
	}

	restarted := openTestFileAuthorityStore(t, store)
	result, found, err := restarted.Inspect(context.Background(), reservation)
	if err != nil {
		t.Fatalf("inspect duplicate failed: %v", err)
	}
	if !found || !result.Duplicate || result.AuthorityCheckpoint != 7 {
		t.Fatalf("duplicate inspect = %+v found=%v, want duplicate checkpoint 7", result, found)
	}
	result, err = restarted.Reserve(context.Background(), reservation)
	if err != nil {
		t.Fatalf("duplicate reservation failed: %v", err)
	}
	if !result.Duplicate {
		t.Fatalf("duplicate reserve = %+v, want duplicate", result)
	}
}

func TestFileAuthorityStoreEnforcesUseBoundAcrossRestart(t *testing.T) {
	state := fileStoreState(t)
	store := newTestFileAuthorityStore(t, state)
	first := fileStoreReservation(t, state)
	if _, err := store.Reserve(context.Background(), first); err != nil {
		t.Fatalf("first reservation failed: %v", err)
	}

	second := fileStoreReservation(t, state)
	second.CommandID = "cmd-2"
	second.Nonce = "nonce-2"
	second.IdempotencyKey = "idem-2"
	second.Fingerprint = "fingerprint-2"
	restarted := openTestFileAuthorityStore(t, store)
	if _, err := restarted.Reserve(context.Background(), second); CodeOf(err) != CodeCapabilityExhausted {
		t.Fatalf("second reservation code=%q err=%v, want %s", CodeOf(err), err, CodeCapabilityExhausted)
	}
}

func TestFileAuthorityStoreRejectsIdempotencyConflict(t *testing.T) {
	state := fileStoreState(t)
	store := newTestFileAuthorityStore(t, state)
	first := fileStoreReservation(t, state)
	if _, err := store.Reserve(context.Background(), first); err != nil {
		t.Fatalf("first reservation failed: %v", err)
	}

	conflict := first
	conflict.CommandID = "cmd-conflict"
	conflict.Nonce = "nonce-conflict"
	conflict.Fingerprint = "fingerprint-conflict"
	if _, err := store.Reserve(context.Background(), conflict); CodeOf(err) != CodeIdempotencyConflict {
		t.Fatalf("conflict code=%q err=%v, want %s", CodeOf(err), err, CodeIdempotencyConflict)
	}
}

func TestFileAuthorityStoreIsNodeScopedOnly(t *testing.T) {
	if newTestFileAuthorityStore(t, fileStoreState(t)).Supports(ReservationScopeAuthority) {
		t.Fatal("file authority store must not support authority-wide reservations")
	}
}

func newTestFileAuthorityStore(t *testing.T, state CapabilityState) *FileAuthorityStore {
	t.Helper()
	dir := t.TempDir()
	statePath := filepath.Join(dir, "authority.json")
	writeAuthorityProjection(t, statePath, state)
	store, err := NewFileAuthorityStore(statePath, filepath.Join(dir, "reservations"))
	if err != nil {
		t.Fatalf("NewFileAuthorityStore: %v", err)
	}
	return store
}

func openTestFileAuthorityStore(t *testing.T, previous *FileAuthorityStore) *FileAuthorityStore {
	t.Helper()
	store, err := NewFileAuthorityStore(previous.statePath, previous.reservationDir)
	if err != nil {
		t.Fatalf("NewFileAuthorityStore restart: %v", err)
	}
	return store
}

func writeAuthorityProjection(t *testing.T, path string, state CapabilityState) {
	t.Helper()
	raw, err := json.Marshal(authorityProjectionFile{Capabilities: []CapabilityState{state}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func fileStoreState(t *testing.T) CapabilityState {
	t.Helper()
	remainingUses := uint64(1)
	now := time.Now().UTC()
	return CapabilityState{
		ID:                     "cap-1",
		Target:                 Target{OrganizationID: "org-1", NodeID: "node-1", AgentID: "agent-1"},
		AuthorizedSigners:      []string{"0xcontroller"},
		Actions:                []string{"status"},
		Scopes:                 []string{"lifecycle"},
		ExpiresAtMS:            now.Add(5 * time.Minute).UnixMilli(),
		RevocationVersion:      7,
		CheckpointObservedAtMS: now.UnixMilli(),
		ReservationScope:       ReservationScopeNode,
		RemainingUses:          &remainingUses,
	}
}

func fileStoreReservation(t *testing.T, state CapabilityState) Reservation {
	t.Helper()
	return Reservation{
		CapabilityID:              state.ID,
		Signer:                    "0xcontroller",
		CommandID:                 "cmd-1",
		Nonce:                     "nonce-1",
		IdempotencyKey:            "idem-1",
		Fingerprint:               "fingerprint-1",
		ExpectedAuthorityHash:     state.SnapshotHash(),
		ExpectedRevocationVersion: state.RevocationVersion,
		Scope:                     ReservationScopeNode,
	}
}
