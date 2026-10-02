package nodecommand

import (
	"context"
	"fmt"
)

// ChainReservationBackend checks or atomically creates the exact command claim
// and execution checkpoint on Sui. A claim must include the target, action,
// fingerprint and budget, and check current authorization again in its PTB.
// Local replay files are not implementations of this interface.
type ChainReservationBackend interface {
	Supports(ReservationScope) bool
	Inspect(context.Context, Reservation) (ReservationResult, bool, error)
	Reserve(context.Context, Reservation, CapabilityState) (ReservationResult, error)
}

type ChainAuthorityStore struct {
	resolver     *ChainAuthorityResolver
	reservations ChainReservationBackend
}

func NewChainAuthorityStore(resolver *ChainAuthorityResolver, reservations ChainReservationBackend) (*ChainAuthorityStore, error) {
	if resolver == nil || reservations == nil {
		return nil, fmt.Errorf("chain authorization and chain reservation backend are required")
	}
	return &ChainAuthorityStore{resolver: resolver, reservations: reservations}, nil
}
func (s *ChainAuthorityStore) Supports(scope ReservationScope) bool {
	return scope == ReservationScopeNode && s.reservations.Supports(scope)
}
func (s *ChainAuthorityStore) Resolve(ctx context.Context, ref CapabilityRef) (CapabilityState, error) {
	return s.resolver.Resolve(ctx, ref)
}
func (s *ChainAuthorityStore) ValidateDirectCommand(ctx context.Context, command NodeCommand, state CapabilityState) error {
	return s.resolver.ValidateDirectCommand(ctx, command, state)
}
func (s *ChainAuthorityStore) Inspect(ctx context.Context, reservation Reservation) (ReservationResult, bool, error) {
	// Even a cached duplicate must not reveal protected results to a device
	// whose grant or membership has since been revoked.
	state, err := s.resolver.Resolve(ctx, CapabilityRef{ID: reservation.CapabilityID})
	if err != nil {
		return ReservationResult{}, false, err
	}
	if !contains(state.AuthorizedSigners, reservation.Signer) {
		return ReservationResult{}, false, reject(CodeUnauthorized, "reservation signer mismatch", nil)
	}
	return s.reservations.Inspect(ctx, reservation)
}
func (s *ChainAuthorityStore) Reserve(ctx context.Context, reservation Reservation) (ReservationResult, error) {
	state, err := s.resolver.Resolve(ctx, CapabilityRef{ID: reservation.CapabilityID})
	if err != nil {
		return ReservationResult{}, err
	}
	if !s.Supports(reservation.Scope) || state.ReservationScope != reservation.Scope || !contains(state.AuthorizedSigners, reservation.Signer) {
		return ReservationResult{}, reject(CodeUnauthorized, "unsupported reservation or signer", nil)
	}
	// The observation timestamp changes on a fresh read. Compare the actual
	// dependency versions against the previously validated snapshot instead.
	state.CheckpointObservedAtMS = reservation.AuthorityObservedAtMS
	if state.RevocationVersion != reservation.ExpectedRevocationVersion || state.SnapshotHash() != reservation.ExpectedAuthorityHash {
		return ReservationResult{}, reject(CodeAuthorityStale, "chain authority changed before reservation", nil)
	}
	return s.reservations.Reserve(ctx, reservation, state)
}
