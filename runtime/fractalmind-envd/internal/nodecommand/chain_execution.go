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
	// Typed dependencies of this read only; never serialized as permission.
	readVersions                                                                           map[string]uint64
	ID, CapabilityID, HumanID, GrantID, MembershipID, CoordinatorBindingID, ManagedAgentID string
	Signer, HostAddress, CommandID, Nonce, IdempotencyKey, Fingerprint, Action, Scope      string
	Target                                                                                 Target
	Budget                                                                                 *BudgetClaim
	BudgetSpent, BudgetReserved                                                            Uint64String
	BudgetSettled                                                                          bool
	IssuedAtMS, ExpiresAtMS                                                                int64
	CapabilityVersion, Cursor                                                              uint64
	GrantVersion                                                                           uint64
	UpdatedAtMS                                                                            int64
	State                                                                                  uint8
	StopRequested                                                                          bool
	ResultRecordID, ResultHash                                                             string
	AttemptID                                                                              string
	Contract                                                                               *ExecutionContractAuthority
	Direct                                                                                 *DirectExecutionAuthority
}

type ChainExecutionReader interface {
	LookupExecution(context.Context, string, string) (ChainExecution, bool, error)
}

// LookupExecution queries the private capability index and current shared
// checkpoint. Not-found is distinct from a network error and is never treated
// as evidence that an unknown prior execution may safely run again.
func (s *ChainAuthorityResolver) LookupExecution(ctx context.Context, capabilityID, fingerprint string) (ChainExecution, bool, error) {
	return s.lookupExecution(ctx, capabilityID, fingerprint, "")
}

// RecheckExecution reads a previously typed checkpoint directly, along with
// its capability. The private read provenance cannot be reconstructed from
// JSON. Both objects, all bindings, budget and dependency versions are still
// checked freshly; this read never grants ownership of a new attempt.
func (s *ChainAuthorityResolver) RecheckExecution(ctx context.Context, known ChainExecution) (ChainExecution, bool, error) {
	if known.readVersions[known.ID] == 0 || known.readVersions[known.CapabilityID] == 0 {
		return ChainExecution{}, false, fmt.Errorf("typed original checkpoint is required")
	}
	current, found, err := s.lookupExecution(ctx, known.CapabilityID, known.Fingerprint, known.ID)
	if err != nil || !found {
		return current, found, err
	}
	r := Reservation{CapabilityID: known.CapabilityID, Signer: known.Signer, CommandID: known.CommandID, Nonce: known.Nonce, IdempotencyKey: known.IdempotencyKey, Fingerprint: known.Fingerprint, Budget: known.Budget, Target: known.Target, Action: known.Action, CommandScope: known.Scope, IssuedAtMS: known.IssuedAtMS, ExpiresAtMS: known.ExpiresAtMS}
	if !current.Matches(r) || current.ID != known.ID || current.CapabilityVersion != known.CapabilityVersion || current.GrantVersion != known.GrantVersion || current.HumanID != known.HumanID || current.GrantID != known.GrantID || current.MembershipID != known.MembershipID || current.ManagedAgentID != known.ManagedAgentID || current.CoordinatorBindingID != known.CoordinatorBindingID || current.HostAddress != known.HostAddress {
		return ChainExecution{}, false, fmt.Errorf("original execution binding changed")
	}
	return current, true, nil
}

func (s *ChainAuthorityResolver) lookupExecution(ctx context.Context, capabilityID, fingerprint, knownID string) (ChainExecution, bool, error) {
	key, err := hex.DecodeString(fingerprint)
	if err != nil || len(key) != 32 {
		return ChainExecution{}, false, fmt.Errorf("invalid execution fingerprint")
	}
	r := &chainRead{resolver: s, versions: map[string]uint64{}}
	if knownID != "" {
		if err := r.prefetchObjects(ctx, []string{capabilityID, knownID}); err != nil {
			return ChainExecution{}, false, err
		}
	}
	var cap moveCapability
	if err = r.object(ctx, capabilityID, "remote_authority::RemoteCapability", &cap); err != nil {
		return ChainExecution{}, false, err
	}
	var runID moveAddress
	if knownID != "" {
		runID, err = chainAddress(knownID)
		if err != nil || runID.String() != knownID {
			return ChainExecution{}, false, fmt.Errorf("invalid original execution ID")
		}
	} else {
		var index moveExecutionIndex
		keyType := s.packageID + "::node_execution::ExecutionIndexKey"
		err = r.field(ctx, capabilityID, structKeyTag(s.packageID, "node_execution", "ExecutionIndexKey"), []byte{0}, keyType, s.packageID+"::node_execution::ExecutionIndex", &index)
		if errors.Is(err, ErrChainObjectNotFound) {
			return ChainExecution{}, false, nil
		}
		if err != nil {
			return ChainExecution{}, false, err
		}
		err = r.field(ctx, index.Executions.ID.String(), []byte{6, 1}, appendBCSBytes(nil, key), "vector<u8>", "0x2::object::ID", &runID)
		if errors.Is(err, ErrChainObjectNotFound) {
			return ChainExecution{}, false, nil
		}
		if err != nil {
			return ChainExecution{}, false, err
		}
	}
	var run moveExecution
	if err = r.object(ctx, runID.String(), "node_execution::CommandExecution", &run); err != nil {
		return ChainExecution{}, false, err
	}
	if run.Capability != cap.ID || run.Org != cap.Org || hex.EncodeToString(run.IntentHash) != fingerprint || run.Delegate != cap.Delegate || len(run.Managed) > 1 || len(run.Result) > 1 || run.State > 5 || run.Issued > math.MaxInt64 || run.Expires > math.MaxInt64 || run.Updated > math.MaxInt64 {
		return ChainExecution{}, false, fmt.Errorf("invalid chain execution binding")
	}
	if run.Action == "direct.message" {
		// These exact mandatory fields are independent once the original Run
		// is known. Keep all typed decoders and the final full version pin.
		core := s.packageID
		fields := r.directPermissionFields(cap)
		fields = append(fields,
			chainFieldRef{capabilityID, structKeyTag(core, "remote_authority", "BoundBudgetClaimKey"), appendBCSBytes(nil, key)},
			chainFieldRef{capabilityID, extensionFieldTag(core, s.directPackageID), appendBCSBytes(nil, run.IntentHash)},
			chainFieldRef{capabilityID, structKeyTag(core, "remote_authority", "CommandContractKey"), appendBCSBytes(nil, run.IntentHash)},
		)
		if err := r.prefetchDependencies(ctx, []string{run.Membership.String()}, fields...); err != nil {
			return ChainExecution{}, false, err
		}
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
	var contract *ExecutionContractAuthority
	var direct *DirectExecutionAuthority
	if run.Action == "direct.message" {
		direct, err = r.directExecution(ctx, cap, run, budget)
	} else {
		contract, err = r.executionContract(ctx, cap, run, budget)
	}
	if err != nil {
		return ChainExecution{}, false, err
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
	value.Contract = contract
	value.Direct = direct
	value.AttemptID = hex.EncodeToString(run.AttemptID)
	value.GrantVersion = run.GrantVersion
	value.UpdatedAtMS = int64(run.Updated)
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
	if _, err := r.versionPin(ctx, reject(CodeAuthorityStale, "chain execution changed during resolution", nil)); err != nil {
		return ChainExecution{}, false, err
	}
	value.readVersions = r.versions
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
