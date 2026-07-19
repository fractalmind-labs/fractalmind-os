package nodecommand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

const reservationRecordVersion = "1"

// FileAuthorityStore uses a local authority projection plus durable reservation
// records. It is the target-local production store for node-scoped capabilities;
// authority-wide capabilities must be backed by a shared authority store.
type FileAuthorityStore struct {
	statePath      string
	reservationDir string
	mu             sync.Mutex
}

type authorityProjectionFile struct {
	Capabilities []CapabilityState `json:"capabilities"`
}

type fileReservationRecord struct {
	Version             string      `json:"version"`
	Kind                recordKind  `json:"kind"`
	CapabilityID        string      `json:"capability_id"`
	Signer              string      `json:"signer"`
	Fingerprint         string      `json:"fingerprint"`
	AuthorityCheckpoint uint64      `json:"authority_checkpoint"`
	Nonce               string      `json:"nonce"`
	IdempotencyKey      string      `json:"idempotency_key"`
	Budget              BudgetClaim `json:"budget,omitempty"`
	HasBudget           bool        `json:"has_budget,omitempty"`
}

func NewFileAuthorityStore(statePath, reservationDir string) (*FileAuthorityStore, error) {
	if statePath == "" {
		return nil, fmt.Errorf("authority state file is required")
	}
	if reservationDir == "" {
		return nil, fmt.Errorf("authority reservation directory is required")
	}
	if err := os.MkdirAll(reservationDir, 0o700); err != nil {
		return nil, fmt.Errorf("create authority reservation directory: %w", err)
	}
	if _, err := os.Stat(statePath); err != nil {
		return nil, fmt.Errorf("read authority state file: %w", err)
	}
	return &FileAuthorityStore{statePath: statePath, reservationDir: reservationDir}, nil
}

func (s *FileAuthorityStore) Supports(scope ReservationScope) bool {
	return scope == ReservationScopeNode
}

func (s *FileAuthorityStore) Inspect(ctx context.Context, reservation Reservation) (ReservationResult, bool, error) {
	if err := contextError(ctx); err != nil {
		return ReservationResult{}, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.inspectLocked(reservation)
}

func (s *FileAuthorityStore) Resolve(ctx context.Context, ref CapabilityRef) (CapabilityState, error) {
	if err := contextError(ctx); err != nil {
		return CapabilityState{}, err
	}
	states, err := s.loadStates()
	if err != nil {
		return CapabilityState{}, err
	}
	state, ok := states[ref.ID]
	if !ok {
		return CapabilityState{}, reject(CodeUnauthorized, "capability was not found", nil)
	}
	return cloneCapabilityState(state), nil
}

func (s *FileAuthorityStore) Reserve(ctx context.Context, reservation Reservation) (ReservationResult, error) {
	if err := contextError(ctx); err != nil {
		return ReservationResult{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	if result, found, err := s.inspectLocked(reservation); found || err != nil {
		return result, err
	}

	states, err := s.loadStates()
	if err != nil {
		return ReservationResult{}, err
	}
	state, ok := states[reservation.CapabilityID]
	if !ok {
		return ReservationResult{}, reject(CodeUnauthorized, "capability was not found", nil)
	}
	if state.Revoked || state.RevocationVersion != reservation.ExpectedRevocationVersion {
		return ReservationResult{}, reject(CodeAuthorityStale, "capability changed before reservation", nil)
	}
	if state.ReservationScope != reservation.Scope || state.SnapshotHash() != reservation.ExpectedAuthorityHash {
		return ReservationResult{}, reject(CodeAuthorityStale, "authority snapshot changed before reservation", nil)
	}
	if !s.Supports(reservation.Scope) {
		return ReservationResult{}, reject(CodeUnauthorized, "authority store does not support capability reservation scope", nil)
	}
	if state.RemainingUses == nil && reservation.Budget == nil {
		return ReservationResult{}, reject(CodeUnauthorized, "capability has no reservable use or budget bound", nil)
	}
	used, spent, err := s.usageLocked(reservation.CapabilityID)
	if err != nil {
		return ReservationResult{}, err
	}
	if state.RemainingUses != nil && used >= *state.RemainingUses {
		return ReservationResult{}, reject(CodeCapabilityExhausted, "capability has no remaining uses", nil)
	}
	if reservation.Budget != nil {
		if state.RemainingBudget == nil || state.RemainingBudget.Asset != reservation.Budget.Asset ||
			uint64(reservation.Budget.Amount) > uint64(state.RemainingBudget.Amount) ||
			spent > uint64(state.RemainingBudget.Amount)-uint64(reservation.Budget.Amount) {
			return ReservationResult{}, reject(CodeBudgetExceeded, "capability budget is insufficient", nil)
		}
	}
	record := fileReservationRecord{
		Version:             reservationRecordVersion,
		CapabilityID:        reservation.CapabilityID,
		Signer:              reservation.Signer,
		Fingerprint:         reservation.Fingerprint,
		AuthorityCheckpoint: state.RevocationVersion,
		Nonce:               reservation.Nonce,
		IdempotencyKey:      reservation.IdempotencyKey,
	}
	if reservation.Budget != nil {
		record.Budget = *reservation.Budget
		record.HasBudget = true
	}

	record.Kind = commandRecordKind
	if err := s.writeRecord(s.recordPath(commandRecordKind, reservation), record); err != nil {
		return ReservationResult{}, err
	}
	record.Kind = nonceRecordKind
	if err := s.writeRecord(s.recordPath(nonceRecordKind, reservation), record); err != nil {
		return ReservationResult{}, err
	}
	record.Kind = idempotencyRecordKind
	if err := s.writeRecord(s.recordPath(idempotencyRecordKind, reservation), record); err != nil {
		return ReservationResult{}, err
	}
	return ReservationResult{AuthorityCheckpoint: state.RevocationVersion}, nil
}

func (s *FileAuthorityStore) loadStates() (map[string]CapabilityState, error) {
	raw, err := os.ReadFile(s.statePath)
	if err != nil {
		return nil, fmt.Errorf("read authority state file: %w", err)
	}
	var projection authorityProjectionFile
	if err := json.Unmarshal(raw, &projection); err != nil {
		return nil, fmt.Errorf("decode authority state file: %w", err)
	}
	states := make(map[string]CapabilityState, len(projection.Capabilities))
	for _, state := range projection.Capabilities {
		if state.ID == "" {
			return nil, fmt.Errorf("authority state has empty capability id")
		}
		if _, exists := states[state.ID]; exists {
			return nil, fmt.Errorf("duplicate authority capability id %q", state.ID)
		}
		states[state.ID] = cloneCapabilityState(state)
	}
	return states, nil
}

func (s *FileAuthorityStore) usageLocked(capabilityID string) (uint64, uint64, error) {
	entries, err := os.ReadDir(s.reservationDir)
	if err != nil {
		return 0, 0, fmt.Errorf("read authority reservation directory: %w", err)
	}
	var used uint64
	var spent uint64
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(s.reservationDir, entry.Name()))
		if err != nil {
			return 0, 0, fmt.Errorf("read authority reservation record: %w", err)
		}
		var record fileReservationRecord
		if err := json.Unmarshal(raw, &record); err != nil {
			return 0, 0, fmt.Errorf("decode authority reservation record: %w", err)
		}
		if record.Version != reservationRecordVersion || record.Kind != commandRecordKind || record.CapabilityID != capabilityID {
			continue
		}
		used++
		if record.HasBudget {
			spent += uint64(record.Budget.Amount)
		}
	}
	return used, spent, nil
}

func (s *FileAuthorityStore) inspectLocked(reservation Reservation) (ReservationResult, bool, error) {
	if result, found, err := s.inspectRecord(commandRecordKind, reservation, reservation.CommandID); found || err != nil {
		return result, found, err
	}
	if result, found, err := s.inspectRecord(idempotencyRecordKind, reservation, reservation.IdempotencyKey); found || err != nil {
		return result, found, err
	}
	if _, found, err := s.inspectRecord(nonceRecordKind, reservation, reservation.Nonce); found || err != nil {
		if err != nil {
			return ReservationResult{}, false, err
		}
		return ReservationResult{}, false, reject(CodeReplay, "nonce was already used", nil)
	}
	return ReservationResult{}, false, nil
}

func (s *FileAuthorityStore) inspectRecord(kind recordKind, reservation Reservation, value string) (ReservationResult, bool, error) {
	raw, err := os.ReadFile(s.recordPath(kind, reservation))
	if errors.Is(err, os.ErrNotExist) {
		return ReservationResult{}, false, nil
	}
	if err != nil {
		return ReservationResult{}, false, fmt.Errorf("read authority reservation record: %w", err)
	}
	var record fileReservationRecord
	if err := json.Unmarshal(raw, &record); err != nil {
		return ReservationResult{}, false, fmt.Errorf("decode authority reservation record: %w", err)
	}
	if record.Version != reservationRecordVersion {
		return ReservationResult{}, false, fmt.Errorf("unsupported authority reservation record version %q", record.Version)
	}
	switch kind {
	case commandRecordKind, idempotencyRecordKind:
		if record.Fingerprint == reservation.Fingerprint {
			return ReservationResult{Duplicate: true, AuthorityCheckpoint: record.AuthorityCheckpoint}, true, nil
		}
		if kind == commandRecordKind {
			return ReservationResult{}, false, reject(CodeReplay, "command_id was reused with different content", nil)
		}
		return ReservationResult{}, false, reject(CodeIdempotencyConflict, "idempotency_key was reused with different content", nil)
	case nonceRecordKind:
		return ReservationResult{Duplicate: record.Fingerprint == reservation.Fingerprint, AuthorityCheckpoint: record.AuthorityCheckpoint}, true, nil
	default:
		return ReservationResult{}, false, fmt.Errorf("unsupported authority reservation record kind %q for %q", kind, value)
	}
}

func (s *FileAuthorityStore) writeRecord(path string, record fileReservationRecord) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("stat authority reservation record: %w", err)
	}
	data, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("encode authority reservation record: %w", err)
	}
	tmp, err := os.CreateTemp(s.reservationDir, ".reservation-*")
	if err != nil {
		return fmt.Errorf("create temporary authority reservation record: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("chmod temporary authority reservation record: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("write temporary authority reservation record: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("sync temporary authority reservation record: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temporary authority reservation record: %w", err)
	}
	if err := os.Link(tmpName, path); err != nil {
		if errors.Is(err, os.ErrExist) {
			return nil
		}
		return fmt.Errorf("persist authority reservation record: %w", err)
	}
	return nil
}

type recordKind string

const (
	commandRecordKind     recordKind = "command"
	idempotencyRecordKind recordKind = "idempotency"
	nonceRecordKind       recordKind = "nonce"
)

func (s *FileAuthorityStore) recordPath(kind recordKind, reservation Reservation) string {
	return filepath.Join(s.reservationDir, hashBytes([]byte(string(kind)+"\x00"+reservation.Signer+"\x00"+reservation.CapabilityID+"\x00"+recordValue(kind, reservation)))+".json")
}

func recordValue(kind recordKind, reservation Reservation) string {
	switch kind {
	case commandRecordKind:
		return reservation.CommandID
	case idempotencyRecordKind:
		return reservation.IdempotencyKey
	case nonceRecordKind:
		return reservation.Nonce
	default:
		return ""
	}
}

func contextError(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}
