package nodecommand

import (
	"context"
	"sync"
)

// Reservation is the target-side atomic unit for replay protection and bounded
// capability consumption. Stores must make exact retries idempotent.
type Reservation struct {
	CapabilityID              string
	Signer                    string
	CommandID                 string
	Nonce                     string
	IdempotencyKey            string
	Fingerprint               string
	ExpectedRevocationVersion uint64
	Budget                    *BudgetClaim
}

type ReservationResult struct {
	Duplicate           bool
	AuthorityCheckpoint uint64
}

// AuthorityStore resolves authority state and atomically reserves one use plus
// any declared budget. Production implementations should persist reservations.
type AuthorityStore interface {
	Inspect(ctx context.Context, reservation Reservation) (ReservationResult, bool, error)
	Resolve(ctx context.Context, ref CapabilityRef) (CapabilityState, error)
	Reserve(ctx context.Context, reservation Reservation) (ReservationResult, error)
}

// MemoryAuthorityStore is the Phase 0 reference implementation. It proves the
// required atomic semantics but is intentionally not durable across restarts.
type MemoryAuthorityStore struct {
	mu             sync.Mutex
	states         map[string]CapabilityState
	commands       map[string]reservationRecord
	nonces         map[string]string
	idempotencyKey map[string]reservationRecord
}

type reservationRecord struct {
	Fingerprint         string
	AuthorityCheckpoint uint64
}

func NewMemoryAuthorityStore(states ...CapabilityState) *MemoryAuthorityStore {
	store := &MemoryAuthorityStore{
		states:         make(map[string]CapabilityState, len(states)),
		commands:       make(map[string]reservationRecord),
		nonces:         make(map[string]string),
		idempotencyKey: make(map[string]reservationRecord),
	}
	for _, state := range states {
		store.states[state.ID] = cloneCapabilityState(state)
	}
	return store
}

func (s *MemoryAuthorityStore) Resolve(_ context.Context, ref CapabilityRef) (CapabilityState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, ok := s.states[ref.ID]
	if !ok {
		return CapabilityState{}, reject(CodeUnauthorized, "capability was not found", nil)
	}
	return cloneCapabilityState(state), nil
}

func (s *MemoryAuthorityStore) Inspect(_ context.Context, reservation Reservation) (ReservationResult, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.inspectLocked(reservation)
}

func (s *MemoryAuthorityStore) Reserve(_ context.Context, reservation Reservation) (ReservationResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if result, found, err := s.inspectLocked(reservation); found || err != nil {
		return result, err
	}

	state, ok := s.states[reservation.CapabilityID]
	if !ok {
		return ReservationResult{}, reject(CodeUnauthorized, "capability was not found", nil)
	}
	if state.Revoked || state.RevocationVersion != reservation.ExpectedRevocationVersion {
		return ReservationResult{}, reject(CodeAuthorityStale, "capability changed before reservation", nil)
	}
	if state.RemainingUses != nil {
		if *state.RemainingUses == 0 {
			return ReservationResult{}, reject(CodeCapabilityExhausted, "capability has no remaining uses", nil)
		}
		remaining := *state.RemainingUses - 1
		state.RemainingUses = &remaining
	}
	if reservation.Budget != nil {
		if state.RemainingBudget == nil || state.RemainingBudget.Asset != reservation.Budget.Asset ||
			state.RemainingBudget.Amount < reservation.Budget.Amount {
			return ReservationResult{}, reject(CodeBudgetExceeded, "capability budget is insufficient", nil)
		}
		state.RemainingBudget.Amount -= reservation.Budget.Amount
	}

	namespace := reservation.Signer + "\x00" + reservation.CapabilityID + "\x00"
	commandKey := namespace + reservation.CommandID
	idempotencyKey := namespace + reservation.IdempotencyKey
	nonceKey := namespace + reservation.Nonce
	s.states[reservation.CapabilityID] = cloneCapabilityState(state)
	record := reservationRecord{Fingerprint: reservation.Fingerprint, AuthorityCheckpoint: state.RevocationVersion}
	s.commands[commandKey] = record
	s.nonces[nonceKey] = reservation.CommandID
	s.idempotencyKey[idempotencyKey] = record
	return ReservationResult{AuthorityCheckpoint: state.RevocationVersion}, nil
}

func (s *MemoryAuthorityStore) inspectLocked(reservation Reservation) (ReservationResult, bool, error) {
	namespace := reservation.Signer + "\x00" + reservation.CapabilityID + "\x00"
	if previous, ok := s.commands[namespace+reservation.CommandID]; ok {
		if previous.Fingerprint == reservation.Fingerprint {
			return ReservationResult{Duplicate: true, AuthorityCheckpoint: previous.AuthorityCheckpoint}, true, nil
		}
		return ReservationResult{}, false, reject(CodeReplay, "command_id was reused with different content", nil)
	}
	if previous, ok := s.idempotencyKey[namespace+reservation.IdempotencyKey]; ok {
		if previous.Fingerprint == reservation.Fingerprint {
			return ReservationResult{Duplicate: true, AuthorityCheckpoint: previous.AuthorityCheckpoint}, true, nil
		}
		return ReservationResult{}, false, reject(CodeIdempotencyConflict, "idempotency_key was reused with different content", nil)
	}
	if _, ok := s.nonces[namespace+reservation.Nonce]; ok {
		return ReservationResult{}, false, reject(CodeReplay, "nonce was already used", nil)
	}
	return ReservationResult{}, false, nil
}

func cloneCapabilityState(state CapabilityState) CapabilityState {
	state.AuthorizedSigners = append([]string(nil), state.AuthorizedSigners...)
	state.Actions = append([]string(nil), state.Actions...)
	state.Scopes = append([]string(nil), state.Scopes...)
	if state.RemainingUses != nil {
		remaining := *state.RemainingUses
		state.RemainingUses = &remaining
	}
	if state.RemainingBudget != nil {
		budget := *state.RemainingBudget
		state.RemainingBudget = &budget
	}
	return state
}
