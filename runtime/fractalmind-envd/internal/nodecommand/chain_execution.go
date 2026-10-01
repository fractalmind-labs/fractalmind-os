package nodecommand

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
)

var ErrChainObjectNotFound = errors.New("chain object not found")

type moveExecutionIndex struct{ Executions moveTable }
type moveBoundBudgetClaim struct {
	Reserved, Spent uint64
	Settled         bool
}
type moveExecution struct {
	ID, Org, Capability                      moveAddress
	CapabilityVersion                        uint64
	Human, Grant                             moveAddress
	GrantVersion                             uint64
	Membership, Host                         moveAddress
	Managed                                  []moveAddress
	Delegate                                 moveAddress
	Node, Agent, Command, Nonce, Idempotency string
	IntentHash                               []byte
	Action, Scope, BudgetAsset               string
	BudgetAmount                             uint64
	Issued, Expires                          uint64
	State                                    uint8
	Cursor                                   uint64
	StopRequested                            bool
	Created, Started, Updated                uint64
	Result                                   []moveAddress
	ResultHash                               []byte
	AttemptID                                []byte
}

type ChainExecution struct {
	ID, CapabilityID, HumanID, GrantID, MembershipID, CoordinatorBindingID, ManagedAgentID string
	Signer, HostAddress, CommandID, Nonce, IdempotencyKey, Fingerprint, Action, Scope      string
	Target                                                                                 Target
	Budget                                                                                 *BudgetClaim
	BudgetSpent, BudgetReserved                                                            Uint64String
	BudgetSettled                                                                          bool
	IssuedAtMS, ExpiresAtMS                                                                int64
	CapabilityVersion, Cursor                                                              uint64
	State                                                                                  uint8
	StopRequested                                                                          bool
	ResultRecordID, ResultHash                                                             string
	AttemptID                                                                              string
}

type ChainExecutionReader interface {
	LookupExecution(context.Context, string, string) (ChainExecution, bool, error)
}

// LookupExecution queries the private capability index and current shared
// checkpoint. Not-found is distinct from a network error and is never treated
// as evidence that an unknown prior execution may safely run again.
func (s *ChainAuthorityResolver) LookupExecution(ctx context.Context, capabilityID, fingerprint string) (ChainExecution, bool, error) {
	key, err := hex.DecodeString(fingerprint)
	if err != nil || len(key) != 32 {
		return ChainExecution{}, false, fmt.Errorf("invalid execution fingerprint")
	}
	r := &chainRead{resolver: s, versions: map[string]uint64{}}
	var cap moveCapability
	if err = r.object(ctx, capabilityID, "remote_authority::RemoteCapability", &cap); err != nil {
		return ChainExecution{}, false, err
	}
	var index moveExecutionIndex
	keyType := s.packageID + "::node_execution::ExecutionIndexKey"
	err = r.field(ctx, capabilityID, structKeyTag(s.packageID, "node_execution", "ExecutionIndexKey"), []byte{0}, keyType, s.packageID+"::node_execution::ExecutionIndex", &index)
	if errors.Is(err, ErrChainObjectNotFound) {
		return ChainExecution{}, false, nil
	}
	if err != nil {
		return ChainExecution{}, false, err
	}
	var runID moveAddress
	err = r.field(ctx, index.Executions.ID.String(), []byte{6, 1}, appendBCSBytes(nil, key), "vector<u8>", "0x2::object::ID", &runID)
	if errors.Is(err, ErrChainObjectNotFound) {
		return ChainExecution{}, false, nil
	}
	if err != nil {
		return ChainExecution{}, false, err
	}
	var run moveExecution
	if err = r.object(ctx, runID.String(), "node_execution::CommandExecution", &run); err != nil {
		return ChainExecution{}, false, err
	}
	if run.Capability != cap.ID || run.Org != cap.Org || hex.EncodeToString(run.IntentHash) != fingerprint || run.Delegate != cap.Delegate || len(run.Managed) > 1 || len(run.Result) > 1 || run.State > 5 || run.Issued > math.MaxInt64 || run.Expires > math.MaxInt64 {
		return ChainExecution{}, false, fmt.Errorf("invalid chain execution binding")
	}
	var budget moveBoundBudgetClaim
	err = r.field(ctx, capabilityID, structKeyTag(s.packageID, "remote_authority", "BoundBudgetClaimKey"), appendBCSBytes(nil, key), s.packageID+"::remote_authority::BoundBudgetClaimKey", s.packageID+"::remote_authority::BoundBudgetClaim", &budget)
	if err != nil {
		return ChainExecution{}, false, fmt.Errorf("execution budget ledger: %w", err)
	}
	knownTerminal := run.State == 2 || run.State == 3 || run.State == 5
	if budget.Reserved != run.BudgetAmount || budget.Spent > budget.Reserved || (!budget.Settled && budget.Spent != 0) || budget.Settled != knownTerminal {
		return ChainExecution{}, false, fmt.Errorf("invalid execution budget settlement")
	}
	var member moveMembership
	if err = r.object(ctx, run.Membership.String(), "host::HostMembership", &member); err != nil {
		return ChainExecution{}, false, err
	}
	if member.Host != run.Host || member.Org != run.Org {
		return ChainExecution{}, false, fmt.Errorf("execution Host membership mismatch")
	}
	value := ChainExecution{ID: run.ID.String(), CapabilityID: run.Capability.String(), HumanID: run.Human.String(), GrantID: run.Grant.String(), MembershipID: run.Membership.String(), CoordinatorBindingID: member.Binding.String(), Signer: run.Delegate.String(), HostAddress: run.Host.String(), CommandID: run.Command, Nonce: run.Nonce, IdempotencyKey: run.Idempotency, Fingerprint: fingerprint, Action: run.Action, Scope: run.Scope, Target: Target{OrganizationID: run.Org.String(), NodeID: run.Node, AgentID: run.Agent}, IssuedAtMS: int64(run.Issued), ExpiresAtMS: int64(run.Expires), CapabilityVersion: run.CapabilityVersion, State: run.State, Cursor: run.Cursor, StopRequested: run.StopRequested, ResultHash: hex.EncodeToString(run.ResultHash)}
	if len(run.Managed) == 1 {
		value.ManagedAgentID = run.Managed[0].String()
	}
	value.AttemptID = hex.EncodeToString(run.AttemptID)
	value.BudgetSpent = Uint64String(budget.Spent)
	value.BudgetSettled = budget.Settled
	if !budget.Settled {
		value.BudgetReserved = Uint64String(budget.Reserved)
	}
	if len(run.Result) == 1 {
		value.ResultRecordID = run.Result[0].String()
	}
	if run.BudgetAmount > 0 {
		value.Budget = &BudgetClaim{Asset: run.BudgetAsset, Amount: Uint64String(run.BudgetAmount)}
	} else if run.BudgetAsset != "" {
		return ChainExecution{}, false, fmt.Errorf("invalid execution budget")
	}
	// A settlement mutates the capability, private claim and checkpoint in one
	// transaction. Do not return a mixed view while those writes become visible.
	for id, version := range r.versions {
		current, err := s.reader.ReadChainObject(ctx, id)
		if err != nil {
			return ChainExecution{}, false, err
		}
		if current.ID != id || current.Version != version {
			return ChainExecution{}, false, reject(CodeAuthorityStale, "chain execution changed during resolution", nil)
		}
	}
	return value, true, nil
}

func (e ChainExecution) Matches(reservation Reservation) bool {
	if e.CapabilityID != reservation.CapabilityID || e.Signer != reservation.Signer || e.CommandID != reservation.CommandID || e.Nonce != reservation.Nonce || e.IdempotencyKey != reservation.IdempotencyKey || e.Fingerprint != reservation.Fingerprint || e.Action != reservation.Action || e.Scope != reservation.CommandScope || e.Target != reservation.Target || e.IssuedAtMS != reservation.IssuedAtMS || e.ExpiresAtMS != reservation.ExpiresAtMS {
		return false
	}
	if (e.Budget == nil) != (reservation.Budget == nil) {
		return false
	}
	return e.Budget == nil || *e.Budget == *reservation.Budget
}
